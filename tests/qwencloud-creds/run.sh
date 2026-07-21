#!/bin/bash
set -u

# Parser tests for bin/qwencloud-creds. The live verification step is
# bypassed by pointing QWENCLOUD_WIDGET at a non-existent path.

ROOT=$(cd "${0%/*}/../.." && pwd)
SCRIPT="$ROOT/home/bin/executable_qwencloud-creds"
TMP=${TMPDIR:-/tmp}/qwencloud-creds-test.$$
PASS=0
FAIL=0
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

ok() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
not_ok() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1"; }
assert_jq() { if jq -e "$2" "$1" >/dev/null 2>&1; then ok "$3"; else not_ok "$3"; fi; }
run_creds() {
  QWENCLOUD_HOME="$1" QWENCLOUD_WIDGET="$TMP/no-such-widget" bash "$SCRIPT" 2>"$TMP/stderr"
}

# Chrome-style "Copy as cURL": single-quoted -H cookie header, sec_token and
# region inside the urlencoded form body, gateway URL on cs-data.* and the
# console origin in the Referer header.
chrome_curl="curl 'https://cs-data.qwencloud.com/data/api.json?product=sfm_bailian&action=IntlBroadScopeAspnGateway&api=zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage' \\
  -X POST \\
  -H 'content-type: application/x-www-form-urlencoded' \\
  -H 'Referer: https://home.qwencloud.com/billing/subscription/token-plan-individual' \\
  -H 'cookie: login_ticket=abc123; x_token=def456; _sso=1' \\
  --data-raw 'product=sfm_bailian&action=IntlBroadScopeAspnGateway&sec_token=SECTOKEN-xyz_9&region=ap-southeast-1&params=%7B%22Api%22%3A%22zeldaHttp.apikeyMgr.%2Ftokenplan%2Fpersonal%2Fapi%2Fv2%2Fusage%22%2C%22Data%22%3A%7B%7D%7D' \\
  --compressed"

home="$TMP/chrome"; mkdir "$home"
printf '%s\n' "$chrome_curl" | run_creds "$home"
assert_jq "$home/credentials.json" '.cookie=="login_ticket=abc123; x_token=def456; _sso=1"' 'Chrome curl: cookie extracted'
assert_jq "$home/credentials.json" '.sec_token=="SECTOKEN-xyz_9"' 'Chrome curl: sec_token extracted'
assert_jq "$home/credentials.json" '.region=="ap-southeast-1" and .action=="IntlBroadScopeAspnGateway"' 'Chrome curl: region and action captured'
assert_jq "$home/credentials.json" '.base_url=="https://cs-data.qwencloud.com"' 'Chrome curl: gateway host captured from URL'
assert_jq "$home/credentials.json" '.referer=="https://home.qwencloud.com/billing/subscription/token-plan-individual"' 'Chrome curl: referer captured'
mode=$(stat -f '%Lp' "$home/credentials.json" 2>/dev/null || stat -c '%a' "$home/credentials.json")
[ "$mode" = 600 ] && ok 'credentials file mode is 0600' || not_ok 'credentials file mode is 0600'

# Firefox-style: -b cookie flag and double-quoted headers, no Referer header.
firefox_curl='curl "https://home.qwencloud.com/data/api.json" -H "Cookie: sid=fff111" --data-raw "product=sfm_bailian&action=IntlBroadScopeAspnGateway&sec_token=FF-TOKEN-1" --compressed'
home="$TMP/firefox"; mkdir "$home"
printf '%s\n' "$firefox_curl" | run_creds "$home"
assert_jq "$home/credentials.json" '.cookie=="sid=fff111" and .sec_token=="FF-TOKEN-1"' 'Firefox curl: cookie and sec_token extracted'
assert_jq "$home/credentials.json" '.base_url=="https://home.qwencloud.com" and (has("referer")|not)' 'Firefox curl: base_url captured, referer absent'

# Re-import preserves optional keys already in the credentials file.
home="$TMP/merge"; mkdir "$home"
printf '{"usage_api":"custom.route","cookie":"old","sec_token":"old"}\n' > "$home/credentials.json"
printf '%s\n' "$chrome_curl" | run_creds "$home"
assert_jq "$home/credentials.json" '.usage_api=="custom.route" and .cookie=="login_ticket=abc123; x_token=def456; _sso=1" and .sec_token=="SECTOKEN-xyz_9"' 'existing optional keys survive re-import'

# A curl without sec_token is rejected with a helpful error.
home="$TMP/no-token"; mkdir "$home"
printf "curl 'https://home.qwencloud.com/' -H 'cookie: a=b'\n" | run_creds "$home" >/dev/null
rc=$?
[ "$rc" -ne 0 ] && ok 'missing sec_token exits non-zero' || not_ok 'missing sec_token exits non-zero'
grep -q 'sec_token' "$TMP/stderr" && ok 'error mentions sec_token' || not_ok 'error mentions sec_token'
[ ! -f "$home/credentials.json" ] && ok 'no file written on parse failure' || not_ok 'no file written on parse failure'

# A bare - argument means read the curl from stdin.
home="$TMP/dash"; mkdir "$home"
printf '%s\n' "$chrome_curl" | QWENCLOUD_HOME="$home" QWENCLOUD_WIDGET="$TMP/no-such-widget" bash "$SCRIPT" - 2>"$TMP/stderr"
assert_jq "$home/credentials.json" '.sec_token=="SECTOKEN-xyz_9"' 'dash argument reads curl from stdin'

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
