#!/usr/bin/env bash
# Staging smoke check after a deploy (docs/DEPLOY.md "Smoke check"). Nothing here changes data except one login.
#   scripts/smoke-staging.sh https://dxxxx.cloudfront.net https://abc123.execute-api.me-south-1.amazonaws.com [email]
# (a) /api/health through CloudFront → 200
# (b) /api/v1/auth/me through CloudFront → 401 with OUR JSON error body (not API Gateway's {"message":"Forbidden"})
# (c) the same call on the execute-api URL directly → 403 forbidden_origin
# (d) after a login, the session carries your public IP → CloudFront-Viewer-Address arrives
set -uo pipefail
CDN="${1:?distribution url}"; GW="${2:?execute-api url}"; EMAIL="${3:-}"
fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS $3"; else echo "FAIL $3 (got: $1, want: $2)"; fail=1; fi; }

code=$(curl -s -o /dev/null -w '%{http_code}' "${CDN}/api/health")
check "$code" 200 "(a) GET ${CDN}/api/health"

body=$(curl -s -w '\n%{http_code}' "${CDN}/api/v1/auth/me")
code=${body##*$'\n'}; json=${body%$'\n'*}
check "$code" 401 "(b) GET /api/v1/auth/me via CloudFront is 401"
echo "$json" | grep -q '"error"' && echo "PASS (b) body is our JSON error: $json" || { echo "FAIL (b) body is not ours: $json"; fail=1; }

body=$(curl -s -w '\n%{http_code}' "${GW}/api/v1/auth/me")
code=${body##*$'\n'}; json=${body%$'\n'*}
check "$code" 403 "(c) GET /api/v1/auth/me on execute-api directly is 403"
echo "$json" | grep -q 'forbidden_origin' && echo "PASS (c) code forbidden_origin" || { echo "FAIL (c) body: $json"; fail=1; }

if [ -n "$EMAIL" ]; then
  read -r -s -p "password for ${EMAIL}: " PASS; echo
  jar=$(mktemp)
  code=$(curl -s -o /dev/null -w '%{http_code}' -c "$jar" -H 'Content-Type: application/json' \
    -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASS}\"}" "${CDN}/api/v1/auth/login")
  check "$code" 200 "(d) login (use an account without an authenticator)"
  mine=$(curl -s https://checkip.amazonaws.com | tr -d '[:space:]')
  sess=$(curl -s -b "$jar" "${CDN}/api/v1/auth/sessions")
  # the current session's ip, as the API recorded it
  sip=$(echo "$sess" | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); cur=[s for s in d.get("items",[]) if s.get("current")] or d.get("items",[])
  print(cur[0].get("ip","") if cur else "")
except Exception: print("")')
  echo "     session ip = '${sip}'  checkip = '${mine}'"
  if [ "$sip" = "$mine" ]; then
    echo "PASS (d) session ip matches your public IP (CloudFront-Viewer-Address arrives)"
  elif [[ "$sip" == *:* && "$mine" != *:* ]]; then
    echo "PASS (IPv6) (d) the session carries an IPv6 address while checkip answered IPv4 — the viewer header arrives"
  elif [ -z "$sip" ]; then
    echo "FAIL (d) the session has no ip: the API is in the 'ip unknown' fallback → check the origin request policy"; fail=1
  else
    echo "FAIL (d) session ip ${sip} ≠ your ip ${mine}: X-Forwarded-For or a proxy is being used instead of the viewer header"; fail=1
  fi
  curl -s -o /dev/null -b "$jar" -X POST "${CDN}/api/v1/auth/logout"; rm -f "$jar"
else
  echo "SKIP (d) pass an email as the third argument to verify the viewer IP"
fi
exit $fail
