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
   `CloudFront-Viewer-Address` header (`ip:port`; IPv6 keeps its colons, the port is the last segment),
   which the custom origin request policy `ApiOriginRequestPolicy` forwards. `TRUST_PROXY_HOPS` is `0` in
   deployed stages; locally it stays `1` for the Vite proxy and no origin secret is set.

Login rate limits, the login log, sessions and audit rows all use this address.

Generate the secret once per stage (at least 32 random characters) and store it before the first deploy:

```bash
aws ssm put-parameter --name /eayni/staging/origin-secret --type SecureString --value "$(openssl rand -base64 48)"
```

Rotating it: put the new value in SSM, redeploy (CloudFront and Lambda pick it up together), then invalidate
nothing — requests in flight during the switch may get a 403 for a few seconds.

## Other SSM parameters

| Parameter | Used by |
|---|---|
| `/eayni/<stage>/mongodb-uri` | API — MongoDB Atlas connection string |
| `/eayni/<stage>/app-secret` | API — root secret for field encryption and signing (rotate with `APP_SECRET_PREVIOUS`) |
| `/eayni/<stage>/app-url` | API — CORS origin and cookie domain; files bucket CORS |
| `/eayni/<stage>/origin-secret` | CloudFront origin header + API check (above) |

## Deploy steps (staging)

```bash
npx serverless deploy --stage staging
npm run build -w apps/web
aws s3 sync apps/web/dist s3://eayni-erp-staging-web --delete
aws cloudfront create-invalidation --distribution-id <WebDistribution id from the stack> --paths '/*'
```

Scheduled jobs: every 5 minutes (`cadence: frequent`) and daily at 06:00 Asia/Riyadh (`cadence: daily`),
see DECISIONS §19.
