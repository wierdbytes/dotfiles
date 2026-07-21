#!/bin/bash
set -u

ROOT=$(cd "${0%/*}/../.." && pwd)
SCRIPT="$ROOT/home/dot_tmux/plugins/tmux-ghostty-theme/executable_usage.sh"
WRAPPER="$ROOT/home/dot_tmux/plugins/tmux-ghostty-theme/executable_claude-usage.sh"
FIXTURES="$ROOT/tests/tmux-usage/fixtures"
TMP=${TMPDIR:-/tmp}/tmux-usage-test.$$
PASS=0
FAIL=0
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM

ok() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
not_ok() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1"; }
assert_contains() { case "$1" in *"$2"*) ok "$3" ;; *) not_ok "$3 (missing: $2)" ;; esac; }
assert_jq() { if jq -e "$2" "$1" >/dev/null 2>&1; then ok "$3"; else not_ok "$3"; fi; }
run_usage() { USAGE_CACHE_DIR="$1" USAGE_FIXTURE_FILE="$2" USAGE_NOW=1900000000 bash "$SCRIPT" "$3" "$4"; }

# Claude normalization, thresholds, bars, and Unix conversion.
cache="$TMP/claude"; mkdir "$cache"
out=$(run_usage "$cache" "$FIXTURES/claude.json" claude all)
assert_contains "$out" '#[fg=#e0af68]61%' 'Claude 5h uses yellow threshold'
assert_contains "$out" '#[fg=#f7767e]81%' 'Claude 7d uses red threshold'
assert_contains "$out" '│' 'all joins both windows'
assert_jq "$cache/claude-api-response.json" '.provider=="claude" and .five_hour.reset_at==2000000000 and .seven_day.reset_at==2000518400' 'Claude response is normalized'
mode=$(stat -f '%Lp' "$cache/claude-api-response.json" 2>/dev/null || stat -c '%a' "$cache/claude-api-response.json")
[ "$mode" = 600 ] && ok 'cache mode is 0600' || not_ok 'cache mode is 0600'

# Reversed Codex windows must be selected by duration; percentages are clamped.
cache="$TMP/codex"; mkdir "$cache"
out=$(run_usage "$cache" "$FIXTURES/codex-reversed.json" codex all)
assert_contains "$out" '0%' 'negative percent clamps to zero'
assert_contains "$out" '100%' 'over-limit percent clamps to 100'
assert_jq "$cache/codex-api-response.json" '.five_hour.utilization==-5 and .five_hour.reset_at==1900001800 and .seven_day.utilization==150' 'Codex windows normalize by duration'
assert_jq "$cache/codex-api-response.json" 'keys==["five_hour","provider","seven_day"] and ([..|objects|keys[]] | any(.=="email" or .=="user_id" or .=="account_id" or .=="auth") | not)' 'Codex cache is sanitized'
blocks=$(printf '%s' "$out" | awk -F'▓' '{print NF-1}')
[ "$blocks" -eq 10 ] && ok 'clamped bars have total expected filled width' || not_ok 'clamped bars have total expected filled width'

# Missing windows still render the existing window in all mode.
cache="$TMP/one"; mkdir "$cache"
out=$(run_usage "$cache" "$FIXTURES/codex-one-window.json" codex all)
assert_contains "$out" '42%' 'all renders the only available window'
case "$out" in *'│'*) not_ok 'single window has no separator' ;; *) ok 'single window has no separator' ;; esac

# age never invokes auth/network and missing cache is muted --.
cache="$TMP/age"; bin="$TMP/bin"; mkdir "$cache" "$bin"
printf '#!/bin/sh\ntouch "%s/curl-called"\n' "$TMP" > "$bin/curl"
printf '#!/bin/sh\ntouch "%s/security-called"\n' "$TMP" > "$bin/security"
chmod +x "$bin/curl" "$bin/security"
out=$(PATH="$bin:$PATH" USAGE_CACHE_DIR="$cache" bash "$SCRIPT" codex age)
assert_contains "$out" '#[fg=#565f89]--#[default]' 'missing age renders muted placeholder'
[ ! -e "$TMP/curl-called" ] && [ ! -e "$TMP/security-called" ] && ok 'age does not use auth or network' || not_ok 'age does not use auth or network'

# Invalid/error response uses stale normalized cache, records backoff, and is not cached.
cache="$TMP/stale"; mkdir "$cache"
printf '%s\n' '{"provider":"codex","five_hour":{"utilization":33,"reset_at":2000000000},"seven_day":null}' > "$cache/codex-api-response.json"
chmod 600 "$cache/codex-api-response.json"
test_now=$(date +%s)
perl -e 'utime($ARGV[0]-1000, $ARGV[0]-1000, $ARGV[1])' "$test_now" "$cache/codex-api-response.json"
out=$(USAGE_CACHE_DIR="$cache" USAGE_FIXTURE_FILE="$FIXTURES/error.json" USAGE_FIXTURE_STATUS=429 USAGE_NOW="$test_now" bash "$SCRIPT" codex 5h)
assert_contains "$out" '33%' 'HTTP/schema error uses stale valid cache'
[ "$(cat "$cache/codex-usage-backoff")" = 120 ] && ok 'first failure starts 120 second backoff' || not_ok 'first failure starts 120 second backoff'
assert_jq "$cache/codex-api-response.json" '.five_hour.utilization==33 and .error==null' 'error response is not cached'
out=$(USAGE_CACHE_DIR="$cache" USAGE_FIXTURE_FILE="$FIXTURES/codex-reversed.json" USAGE_NOW="$test_now" bash "$SCRIPT" codex 5h)
assert_contains "$out" '33%' 'active backoff avoids replacing stale cache'

# A 200 response with invalid JSON must also preserve stale data.
cache="$TMP/invalid-json"; mkdir "$cache"
printf '%s\n' '{"provider":"codex","five_hour":{"utilization":35,"reset_at":2000000000},"seven_day":null}' > "$cache/codex-api-response.json"
chmod 600 "$cache/codex-api-response.json"
perl -e 'utime($ARGV[0]-1000, $ARGV[0]-1000, $ARGV[1])' "$test_now" "$cache/codex-api-response.json"
out=$(USAGE_CACHE_DIR="$cache" USAGE_FIXTURE_FILE="$FIXTURES/invalid.json" USAGE_FIXTURE_STATUS=200 USAGE_NOW="$test_now" bash "$SCRIPT" codex 5h)
assert_contains "$out" '35%' 'invalid JSON uses stale valid cache'
assert_jq "$cache/codex-api-response.json" '.five_hour.utilization==35' 'invalid JSON does not replace cache'

# A stale lock is recovered and removed after the request completes.
cache="$TMP/stale-lock"; mkdir -p "$cache/codex-usage.lock"
out=$(USAGE_CACHE_DIR="$cache" USAGE_FIXTURE_FILE="$FIXTURES/codex-one-window.json" USAGE_NOW=1900000000 bash "$SCRIPT" codex all)
assert_contains "$out" '42%' 'stale lock is recovered'
[ ! -e "$cache/codex-usage.lock" ] && ok 'recovered lock is cleaned up' || not_ok 'recovered lock is cleaned up'

# Missing authentication also falls back without attempting a real request.
cache="$TMP/no-auth"; mkdir "$cache"
printf '%s\n' '{"provider":"codex","five_hour":{"utilization":44,"reset_at":2000000000},"seven_day":null}' > "$cache/codex-api-response.json"
chmod 600 "$cache/codex-api-response.json"
perl -e 'utime($ARGV[0]-1000, $ARGV[0]-1000, $ARGV[1])' "$test_now" "$cache/codex-api-response.json"
out=$(HOME="$TMP/empty-home" CODEX_HOME="$TMP/no-codex-auth" USAGE_CACHE_DIR="$cache" USAGE_NOW="$test_now" bash "$SCRIPT" codex 5h)
assert_contains "$out" '44%' 'missing auth uses stale valid cache'

# Qwen Cloud normalization, thresholds, reset times, and cache sanitization.
cache="$TMP/qwen"; mkdir "$cache"
out=$(run_usage "$cache" "$FIXTURES/qwen.json" qwen all)
assert_contains "$out" '#[fg=#e0af68]61%' 'Qwen 5h uses yellow threshold'
assert_contains "$out" '#[fg=#f7767e]81%' 'Qwen 7d uses red threshold'
assert_contains "$out" '1157d9h' 'Qwen 5h renders reset countdown from ms timestamp'
assert_contains "$out" '1163d9h' 'Qwen 7d renders reset countdown from ms timestamp'
assert_jq "$cache/qwen-api-response.json" '.provider=="qwen" and .five_hour.utilization==61.2 and .seven_day.utilization==81 and .five_hour.reset_at==2000000000 and .seven_day.reset_at==2000518400' 'Qwen response is normalized with reset times'
assert_jq "$cache/qwen-api-response.json" '([..|objects|keys[]] | any(.=="requestId" or .=="cookie" or .=="sec_token") | not)' 'Qwen cache is sanitized'

# Qwen percentage fields may sit under a nested zelda gateway Data envelope;
# without reset timestamps the renderer falls back to plain 5h/7d labels.
cache="$TMP/qwen-nested"; mkdir "$cache"
out=$(run_usage "$cache" "$FIXTURES/qwen-nested.json" qwen all)
assert_contains "$out" '0%' 'Qwen negative percent clamps to zero'
assert_contains "$out" '100%' 'Qwen over-limit percent clamps to 100'
assert_contains "$out" '5h:' 'Qwen windows fall back to plain labels without reset times'
assert_jq "$cache/qwen-api-response.json" '.five_hour.utilization==-400 and .seven_day.utilization==12000 and .five_hour.reset_at==null' 'Qwen nested envelope normalizes and scales fraction to percent'

# Missing Qwen Cloud credentials fall back to stale cache without a request.
cache="$TMP/qwen-no-auth"; mkdir "$cache"
printf '%s\n' '{"provider":"qwen","five_hour":{"utilization":46,"reset_at":null},"seven_day":null}' > "$cache/qwen-api-response.json"
chmod 600 "$cache/qwen-api-response.json"
perl -e 'utime($ARGV[0]-1000, $ARGV[0]-1000, $ARGV[1])' "$test_now" "$cache/qwen-api-response.json"
out=$(HOME="$TMP/empty-home" QWENCLOUD_HOME="$TMP/no-qwen-creds" USAGE_CACHE_DIR="$cache" USAGE_NOW="$test_now" bash "$SCRIPT" qwen 5h)
assert_contains "$out" '46%' 'missing Qwen credentials use stale valid cache'

# Historical raw Claude cache remains readable through the compatibility wrapper.
stage="$TMP/stage"; cache="$TMP/wrapper-cache"; mkdir "$stage" "$cache"
cp "$SCRIPT" "$stage/usage.sh"; cp "$WRAPPER" "$stage/claude-usage.sh"; chmod +x "$stage/usage.sh" "$stage/claude-usage.sh"
cp "$FIXTURES/claude.json" "$cache/claude-api-response.json"
out=$(USAGE_CACHE_DIR="$cache" "$stage/claude-usage.sh" 5h)
assert_contains "$out" '61%' 'compatibility wrapper reads historical Claude cache'
assert_jq "$cache/claude-api-response.json" '.provider=="claude" and (keys==["five_hour","provider","seven_day"])' 'historical Claude cache migrates to common schema'

printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
