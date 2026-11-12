#!/usr/bin/env bash
# Remove web assets that the live build no longer uses and that are older than N days (staging readiness item 4).
# deploy-web.sh never deletes, so tabs running an older build can still lazy-load their chunks; this script is the
# periodic cleanup. "Used" means listed in _deploy/files.txt, the complete file list deploy-web.sh uploads with every
# build. index.html alone is not enough: it never names the logo, fonts or lazy chunks that JS/CSS reference.
# If the list is missing the script stops and deletes nothing.
#   scripts/prune-web-assets.sh staging 14
set -euo pipefail
STAGE="${1:-staging}"; DAYS="${2:-14}"
BUCKET="eayni-erp-${STAGE}-web"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
if ! aws s3 cp "s3://${BUCKET}/_deploy/files.txt" "$tmp/files.txt" >/dev/null 2>&1; then
  echo "no _deploy/files.txt in ${BUCKET}: run scripts/deploy-web.sh ${STAGE} first; nothing removed" >&2
  exit 1
fi
LC_ALL=C sort -u "$tmp/files.txt" > "$tmp/keep"
cutoff=$(date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d "-${DAYS} days" +%Y-%m-%dT%H:%M:%S)
removed=0
aws s3api list-objects-v2 --bucket "${BUCKET}" --prefix assets/ \
  --query "Contents[?LastModified<'${cutoff}'].Key" --output text | tr '\t' '\n' | grep -v '^None$' > "$tmp/old" || true
while read -r key; do
  [ -z "$key" ] && continue
  if ! grep -qxF "${key}" "$tmp/keep"; then
    aws s3 rm "s3://${BUCKET}/${key}" >/dev/null && echo "removed ${key}" && removed=$((removed+1))
  fi
done < "$tmp/old"
echo "prune done: removed ${removed} (older than ${DAYS} days and not in the live build's file list)"
