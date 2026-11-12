#!/usr/bin/env bash
# Upload the web build to the stage's bucket and invalidate CloudFront (docs/DEPLOY.md).
# Hashed assets are immutable for a year and are NEVER deleted here (a tab still running the previous build can
# lazy-load its chunks); index.html is never cached. Old assets are removed later by scripts/prune-web-assets.sh
# (go-live follow-up items 3 and 4), which keeps every file named in _deploy/files.txt: the complete file list of
# the build uploaded here (not only what index.html references, since JS/CSS reference assets of their own).
set -euo pipefail
STAGE="${1:-staging}"
BUCKET="eayni-erp-${STAGE}-web"
DIST_ID="${2:-$(aws cloudformation describe-stacks --stack-name "eayni-erp-${STAGE}" \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionId'].OutputValue" --output text)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

npm run build -w apps/web
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
"$HERE/web-file-list.sh" apps/web/dist > "$tmp/files.txt"
# 1. everything except index.html: content-hashed → long-lived, immutable; no --delete (see header)
aws s3 sync apps/web/dist "s3://${BUCKET}" --exclude 'index.html' \
  --cache-control 'public,max-age=31536000,immutable'
# 2. the build's complete file list, so prune keeps every file of the live build
aws s3 cp "$tmp/files.txt" "s3://${BUCKET}/_deploy/files.txt" \
  --cache-control 'no-cache' --content-type 'text/plain; charset=utf-8'
# 3. index.html last, uncached, so it only ever references chunks that already exist
aws s3 cp apps/web/dist/index.html "s3://${BUCKET}/index.html" \
  --cache-control 'no-cache' --content-type 'text/html; charset=utf-8'
aws cloudfront create-invalidation --distribution-id "${DIST_ID}" --paths '/index.html' '/'
echo "web deployed to ${BUCKET} ($(wc -l < "$tmp/files.txt" | tr -d ' ') files); distribution ${DIST_ID} invalidated"
