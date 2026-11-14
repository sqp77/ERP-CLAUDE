# Deployment notes (written, not run — DECISIONS §1)

Nothing is deployed yet. This file records how the stack in `serverless.yml` is meant to run once the
owner clears **DECISIONS §1 "Pending before staging"**. Never deploy to `prod` from a laptop.

## Topology

```
browser ── https ──► CloudFront distribution (WebDistribution)
                        │  default behaviour  → private S3 bucket (web build, OAC)
                        │                        + CloudFront Function "spa-rewrite" (viewer-request)
                        └─ /api/*             → HTTP API (API Gateway) → Lambda (Express)
                                                 origin header x-origin-secret, origin request policy
                                                 forwards all viewer headers + CloudFront-Viewer-Address
```

Web and API share one origin, so the `SameSite=Lax` session cookie and relative `/api/v1` calls work.

## SPA routing (go-live follow-up 1)

Unknown web paths must serve `index.html` with **200**, but a CloudFront `CustomErrorResponses` rule applies
to the whole distribution, including `/api/*`: every API 403/404 would reach the browser as HTML with status
200 and the error code would be lost. So there are **no CustomErrorResponses**. Instead a CloudFront Function
(`WebSpaRewriteFunction`, runtime `cloudfront-js-2.0`) is attached to the **default behaviour only** as a
`viewer-request` handler: a path whose last segment has no file extension is rewritten to `/index.html`;
files (`/assets/app-1a2b.js`) and `/api/*` pass through unchanged. A test parses `serverless.yml` and runs the
function body (`apps/api/src/core/golive-followup.test.ts`, item 1).

## Only CloudFront may call the API (go-live follow-up 2)

The API Gateway URL is public. Reached directly, `X-Forwarded-For` is whatever the caller sends, so hop
counting (`TRUST_PROXY_HOPS`) cannot be trusted. Therefore:

1. **Origin secret.** CloudFront adds `x-origin-secret: <value>` to every `/api/*` request
   (`OriginCustomHeaders` on the `api` origin). The value comes from SSM `/eayni/<stage>/origin-secret`
   and is also given to the Lambda as `ORIGIN_SECRET`. The API (`core/http/origin.ts`) refuses any request
   without a matching header with **403 `forbidden_origin`**, using a constant-time compare. `GET /api/health`
   is exempt so uptime monitors can hit the gateway. `ORIGIN_SECRET` is **required in production**: the
   process refuses to start without it.
2. **Client IP.** Once the request is known to come from CloudFront, the client address is read from the
   `CloudFront-Viewer-Address` header (`ip:port`; IPv6 keeps its colons, the port is the last segment).
   The `/api/*` behaviour uses the **managed origin request policy `AllViewerExceptHostHeader`**
   (`b689b0a8-53d0-40ab-baf2-68738e2966ac`): it is the policy AWS built for API Gateway origins (the viewer
   `Host` must not be forwarded or API Gateway answers 403) and it forwards the CloudFront viewer headers,
   including `CloudFront-Viewer-Address`. `TRUST_PROXY_HOPS` is `0` in deployed stages; locally it stays `1`
   for the Vite proxy and no origin secret is set.
3. **Safe fallback.** If the viewer header does not arrive, the API marks the client IP as *unknown*: login
   logs and sessions carry no IP, the per-IP limits are skipped (never one shared bucket for everyone), the
   per-email login limit and the per-user lock still apply, and one warning
   (`CloudFront-Viewer-Address missing`) is logged per container. Smoke check (d) below detects this.

Login rate limits, the login log, sessions and audit rows all use this address.

### Origin secret: create and rotate

Generate the secret once per stage (at least 32 random characters) and store it before the first deploy:

```bash
aws ssm put-parameter --name /eayni/staging/origin-secret --type SecureString --value "$(openssl rand -base64 48)"
aws ssm put-parameter --name /eayni/staging/origin-secret-previous --type SecureString --value ""   # empty = none
```

The API accepts `ORIGIN_SECRET` **and** `ORIGIN_SECRET_PREVIOUS`, so a rotation never produces 403s while
CloudFront propagates the new header:

1. `origin-secret-previous` ← current value; `origin-secret` ← new value.
2. `npx serverless deploy --stage staging` (Lambda now accepts both; CloudFront starts sending the new one;
   propagation takes several minutes).
3. Wait until `aws cloudfront get-distribution --id <id>` shows `Status: Deployed`, then run the smoke check.
4. `origin-secret-previous` ← `""` and deploy again. Old value is now refused.

## Web upload: cache headers (follow-up 3)

`scripts/deploy-web.sh <stage>` builds and uploads: hashed assets with `Cache-Control: public,max-age=31536000,immutable`
(uploaded first, `--delete`), then `index.html` with `Cache-Control: no-cache` and a `/index.html` invalidation. Browsers
therefore always fetch a fresh `index.html` and never ask for a chunk that the sync deleted.

## Smoke check after a staging deploy (follow-up 2)

```bash
scripts/smoke-staging.sh https://<distribution>.cloudfront.net https://<id>.execute-api.<region>.amazonaws.com you@eayni.local
```

Check (d) prints the session IP next to your public IP; an IPv6 session address with an IPv4 `checkip` answer is reported as **PASS (IPv6)**.

| Check | Expect | Proves |
|---|---|---|
| (a) `GET /api/health` via CloudFront | 200 | distribution → API Gateway → Lambda path works |
| (b) `GET /api/v1/auth/me` via CloudFront | 401 with **our** JSON `{ "error": { code, message } }` | the origin header arrives and Express answers (API Gateway's own `{"message":"Forbidden"}` would mean the origin header is missing or the policy forwards Host) |
| (c) `GET /api/v1/auth/me` on the execute-api URL | 403 `forbidden_origin` | the gateway cannot be used to bypass CloudFront |
| (d) login, then `GET /api/v1/auth/sessions` | the current session's `ip` equals your public IP | `CloudFront-Viewer-Address` is forwarded; otherwise the API is in the "ip unknown" fallback |

Use an account without an authenticator for (d) (the script logs out at the end).

## SSM parameters to create before the first deploy

All under `/eayni/<stage>/`. `first-deploy.sh` checks the first three and creates the last two when missing.

| Parameter | Type | Value |
|---|---|---|
| `mongodb-uri` | SecureString | Atlas connection string (`mongodb+srv://…`), database user with readWrite on the app database only |
| `app-secret` | SecureString | ≥ 32 random chars: `openssl rand -base64 48`; rotation uses `APP_SECRET_PREVIOUS` |
| `origin-secret` | SecureString | ≥ 32 random chars; CloudFront → API header |
| `origin-secret-previous` | SecureString | `""` unless rotating |
| `app-url` | String | `https://<distribution domain>`; placeholder on the very first deploy (see below) |

## First deploy order (staging readiness item 2)

`APP_URL` is read from SSM **at deploy time**, but the CloudFront domain exists only after the first deploy.
`scripts/first-deploy.sh <stage> [email]` resolves that:

1. verifies the SSM parameters above, writes `https://placeholder.invalid` to `app-url` when it is missing;
2. `npx serverless deploy --stage <stage>`;
3. reads `WebDistributionDomain` and `HttpApiUrl` from the stack outputs;
4. writes `https://<domain>` to `app-url` and **redeploys** (CORS, cookie origin, files-bucket CORS now point at it);
5. `scripts/deploy-web.sh <stage>` then `scripts/smoke-staging.sh …`.

Then create the first admin (item 1):

```bash
npx serverless invoke -f bootstrap --stage staging --data '{"adminEmail":"you@eayni.local"}'
```

It creates the ten official departments (DECISIONS §3; idempotent, no sample branches, sites, positions or
people), and one `system_admin` with a random temporary password **printed once in the invoke output**:
first login forces a password change and the authenticator enrolment (DECISIONS §2). It refuses when an active
system admin already exists, and writes an audit row.

### MongoDB Atlas network access

The Lambdas run outside a VPC, so their source addresses are not fixed. **Staging** uses an Atlas IP access list
of `0.0.0.0/0` with a dedicated database user (long random password, `readWrite` on the application database
only, no admin roles) and TLS, which Atlas enforces. **Production** decides between AWS PrivateLink and VPC
peering (Lambdas inside a VPC with NAT) before go-live — DECISIONS §1.

## Staging demo data (item 3, staging only)

```bash
npx serverless invoke -f seedStagingDemo --stage staging   # sample people, tasks, tickets, news, reports
npx serverless invoke -f purgeDemo --stage staging         # remove exactly what the demo seed created
```

`seedStagingDemo` is **refused unless `STAGE=staging`** (so never prod/production, never an unnamed production
process). Every demo account gets its own random password; the `accounts: [{ email, password }]` list is in the
invoke output only — not stored, not logged. Every created document is tagged in `demo_records`, so `purgeDemo`
deletes exactly that set and keeps departments, roles, settings, real users and the audit/login logs.

## Web assets after a deploy (item 4)

`deploy-web.sh` never deletes: a tab still running the previous build can lazy-load its old chunks. The web app
also listens for Vite's `vite:preloadError` and reloads once (guarded per path in `sessionStorage`) so a stale tab
recovers after a deploy. With every build `deploy-web.sh` also uploads `_deploy/files.txt`, the complete file list of
that build (`scripts/web-file-list.sh apps/web/dist`), because index.html alone never names the logo, local fonts or
lazy chunks that JS/CSS reference. Old assets are removed later:

```bash
scripts/prune-web-assets.sh staging 14   # assets not in the live build's file list and older than 14 days
```

Prune stops and deletes nothing when `_deploy/files.txt` is missing (a bucket last filled by an older
`deploy-web.sh`): run `deploy-web.sh` once first.

## Other SSM parameters

| Parameter | Used by |
|---|---|
| `/eayni/<stage>/mongodb-uri` | API — MongoDB Atlas connection string |
| `/eayni/<stage>/app-secret` | API — root secret for field encryption and signing (rotate with `APP_SECRET_PREVIOUS`) |
| `/eayni/<stage>/app-url` | API — CORS origin and cookie domain; files bucket CORS |
| `/eayni/<stage>/origin-secret` | CloudFront origin header + API check (above) |
| `/eayni/<stage>/origin-secret-previous` | accepted during a rotation; empty otherwise |

## Deploy steps (staging)

```bash
npx serverless deploy --stage staging
scripts/deploy-web.sh staging          # build, upload with the right cache headers, invalidate index.html
scripts/smoke-staging.sh https://<distribution> https://<id>.execute-api.<region>.amazonaws.com you@eayni.local
```

Scheduled jobs: every 5 minutes (`cadence: frequent`) and daily at 06:00 Asia/Riyadh (`cadence: daily`),
see DECISIONS §19.

## Backups (SAL §16 «النسخ الاحتياطية», Sales S5) — configure before production data
Nothing here is code; it is the checklist for the Atlas project and the AWS account (DECISIONS §1 «Pending before staging»). Checked against the MongoDB Atlas documentation on 2026-11-14: [Dedicated Cluster Backups](https://www.mongodb.com/docs/atlas/backup/cloud-backup/dedicated-cluster-backup/), [Backup scheduling and retention](https://www.mongodb.com/docs/atlas/backup/cloud-backup/scheduling/), [Backup Compliance Policy](https://mongodb.com/docs/atlas/backup/cloud-backup/backup-compliance-policy).

**Database (MongoDB Atlas)**
1. Use a dedicated cluster tier (M10 or above); cloud backup snapshots are a dedicated-cluster feature. Shared and free tiers are for development only.
2. Turn on **Cloud Backup** and **Continuous Cloud Backup** for production. Continuous backup replays the oplog, so the cluster can be restored to any minute inside the window; on Atlas Core clusters it adds to the monthly cost, so staging can keep snapshots only.
3. Proposed policy (owner to confirm the numbers): snapshots every 6 hours kept 2 days, daily kept 14 days, weekly kept 8 weeks, monthly kept 12 months; point-in-time window 7 days.
4. Snapshots are stored in the cluster's own cloud region. Pick the region with the data-residency decision (open item: hosting region); do not add copies to another region without that decision.
5. Consider a **Backup Compliance Policy** for production, so that nobody (an admin included) can delete snapshots or shorten retention.
6. Restores need the Atlas role Project Backup Manager, Project Backup Recovery Operator or Project Owner. Give it to two named people, not to the application user.
7. **Restore drill every quarter:** restore the latest snapshot into a new temporary cluster, point a staging stack at it, sign in, open a customer file, an invoice and the Sales dashboard, then delete the temporary cluster. Record the date and the time it took.

**Files (S3)**
1. Turn on **bucket versioning** on the files bucket, so an overwritten or deleted attachment can be recovered (signed contracts, invoices, procedures in the Sales library).
2. Add a lifecycle rule that expires *noncurrent* versions after 90 days (owner to confirm); current files are never expired by the rule.
3. Block public access; the app serves files only through presigned URLs (CLAUDE.md "Serverless rules").

**Configuration**
- The SSM parameters and secrets listed above are the configuration of record. Export their names (not their values) into the runbook after each change. The deploy pipeline and `serverless.yml` in git rebuild everything else.

**What the application already guarantees**
- History is append-only: communication logs, stage logs, price entries, target versions, discussion entries and audit. A restore to an earlier point never leaves a record without its history.
- Business records use soft delete (`deletedAt`), so a mistaken delete is undone in the app without a restore.
