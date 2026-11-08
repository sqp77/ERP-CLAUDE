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

| Check | Expect | Proves |
|---|---|---|
| (a) `GET /api/health` via CloudFront | 200 | distribution → API Gateway → Lambda path works |
| (b) `GET /api/v1/auth/me` via CloudFront | 401 with **our** JSON `{ "error": { code, message } }` | the origin header arrives and Express answers (API Gateway's own `{"message":"Forbidden"}` would mean the origin header is missing or the policy forwards Host) |
| (c) `GET /api/v1/auth/me` on the execute-api URL | 403 `forbidden_origin` | the gateway cannot be used to bypass CloudFront |
| (d) login, then `GET /api/v1/auth/sessions` | the current session's `ip` equals your public IP | `CloudFront-Viewer-Address` is forwarded; otherwise the API is in the "ip unknown" fallback |

Use an account without an authenticator for (d) (the script logs out at the end).

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
