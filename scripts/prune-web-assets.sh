#!/usr/bin/env bash
# Remove hashed web assets that the current index.html no longer references and that are older than N days
# (staging readiness item 4). deploy-web.sh never deletes, so tabs running an older build can still lazy-load
# their chunks; this script is the periodic cleanup.
#   scripts/prune-web-assets.sh staging 14
set -euo pipefail
STAGE="${1:-staging}"; DAYS="${2:-14}"
BUCKET="eayni-erp-${STAGE}-web"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
aws s3 cp "s3://${BUCKET}/index.html" "$tmp/index.html" >/dev/null
# every /assets/... path the live index.html references (scripts, styles, modulepreload)
grep -oE '/assets/[A-Za-z0-9_.-]+' "$tmp/index.html" | sort -u > "$tmp/referenced"
cutoff=$(date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%S)
removed=0
aws s3api list-objects-v2 --bucket "${BUCKET}" --prefix assets/ \
  --query "Contents[?LastModified<'${cutoff}'].Key" --output text | tr '\t' '\n' | grep -v '^None$' | while read -r key; do
  [ -z "$key" ] && continue
  if ! grep -qx "/${key}" "$tmp/referenced"; then
    aws s3 rm "s3://${BUCKET}/${key}" >/dev/null && echo "removed ${key}" && removed=$((removed+1))
  fi
done
echo "prune done (older than ${DAYS} days, unreferenced by the live index.html)"
