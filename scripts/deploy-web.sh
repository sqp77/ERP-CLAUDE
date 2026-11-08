#!/usr/bin/env bash
# Upload the web build to the stage's bucket and invalidate CloudFront (docs/DEPLOY.md).
# Hashed assets are immutable for a year; index.html is never cached, so a browser never asks for a chunk that
# `s3 sync --delete` removed (go-live follow-up on fffae18, item 3).
set -euo pipefail
STAGE="${1:-staging}"
BUCKET="eayni-erp-${STAGE}-web"
DIST_ID="${2:-$(aws cloudformation describe-stacks --stack-name "eayni-erp-${STAGE}" \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionId'].OutputValue" --output text)}"

npm run build -w apps/web
# 1. everything except index.html: content-hashed → long-lived, immutable
aws s3 sync apps/web/dist "s3://${BUCKET}" --delete --exclude 'index.html' \
  --cache-control 'public,max-age=31536000,immutable'
# 2. index.html last, uncached, so it only ever references chunks that already exist
aws s3 cp apps/web/dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control 'no-cache' --content-type 'text/html; charset=utf-8'
aws cloudfront create-invalidation --distribution-id "${DIST_ID}" --paths '/index.html' '/'
echo "web deployed to ${BUCKET}; distribution ${DIST_ID} invalidated"
