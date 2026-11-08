#!/usr/bin/env bash
# First deploy of a stage (docs/DEPLOY.md "First deploy"). APP_URL is read from SSM at deploy time but the CloudFront
# domain exists only after the first deploy, so: placeholder → deploy → read the domain → write it → redeploy → web → smoke.
#   scripts/first-deploy.sh staging [admin-email-for-smoke]
set -euo pipefail
STAGE="${1:-staging}"; SMOKE_EMAIL="${2:-}"
P="/eayni/${STAGE}"
need() { aws ssm get-parameter --name "$1" --with-decryption >/dev/null 2>&1 || { echo "missing SSM parameter $1 — see docs/DEPLOY.md"; exit 1; }; }
need "${P}/mongodb-uri"; need "${P}/app-secret"; need "${P}/origin-secret"
aws ssm get-parameter --name "${P}/origin-secret-previous" >/dev/null 2>&1 \
  || aws ssm put-parameter --name "${P}/origin-secret-previous" --type SecureString --value "" --overwrite >/dev/null
if ! aws ssm get-parameter --name "${P}/app-url" >/dev/null 2>&1; then
  echo "app-url missing → placeholder until the distribution exists"
  aws ssm put-parameter --name "${P}/app-url" --type String --value "https://placeholder.invalid" >/dev/null
fi
npx serverless deploy --stage "${STAGE}"
DOMAIN=$(aws cloudformation describe-stacks --stack-name "eayni-erp-${STAGE}" \
  --query "Stacks[0].Outputs[?OutputKey=='WebDistributionDomain'].OutputValue" --output text)
GW=$(aws cloudformation describe-stacks --stack-name "eayni-erp-${STAGE}" \
  --query "Stacks[0].Outputs[?OutputKey=='HttpApiUrl'].OutputValue" --output text)
echo "distribution: https://${DOMAIN}  api gateway: ${GW}"
CURRENT=$(aws ssm get-parameter --name "${P}/app-url" --query Parameter.Value --output text)
if [ "${CURRENT}" != "https://${DOMAIN}" ]; then
  aws ssm put-parameter --name "${P}/app-url" --type String --value "https://${DOMAIN}" --overwrite >/dev/null
  echo "app-url set → redeploy so CORS, cookies and the files-bucket CORS use it"
  npx serverless deploy --stage "${STAGE}"
fi
scripts/deploy-web.sh "${STAGE}"
scripts/smoke-staging.sh "https://${DOMAIN}" "${GW}" ${SMOKE_EMAIL:+"${SMOKE_EMAIL}"}
echo "next: npx serverless invoke -f bootstrap --stage ${STAGE} --data '{\"adminEmail\":\"you@eayni.local\"}'"
