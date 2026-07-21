#!/bin/bash

# Unified tmux usage widget. Bash 3.2 compatible.
# Usage: usage.sh <claude|codex|qwen> [5h|7d|age|all]

PROVIDER="${1:-}"
MODE="${2:-all}"
case "$PROVIDER" in claude|codex|qwen) ;; *) exit 2 ;; esac
case "$MODE" in 5h|7d|age|all) ;; *) MODE=all ;; esac

# Raw API responses can contain account metadata; keep all runtime files private.
umask 077

CACHE_ROOT="${USAGE_CACHE_DIR:-$HOME/.cache}"
if [ "$PROVIDER" = claude ]; then
  # Keep the historical Claude paths for a transparent migration.
  CACHE_FILE="$CACHE_ROOT/claude-api-response.json"
  LOCK_DIR="$CACHE_ROOT/claude-usage.lock"
  BACKOFF_FILE="$CACHE_ROOT/claude-usage-backoff"
elif [ "$PROVIDER" = codex ]; then
  CACHE_FILE="$CACHE_ROOT/codex-api-response.json"
  LOCK_DIR="$CACHE_ROOT/codex-usage.lock"
  BACKOFF_FILE="$CACHE_ROOT/codex-usage-backoff"
else
  CACHE_FILE="$CACHE_ROOT/qwen-api-response.json"
  LOCK_DIR="$CACHE_ROOT/qwen-usage.lock"
  BACKOFF_FILE="$CACHE_ROOT/qwen-usage-backoff"
fi
CACHE_TTL=120
LOCK_TTL=30
C_RED='#[fg=#f7767e]'
C_YELLOW='#[fg=#e0af68]'
C_GRAY='#[fg=#565f89]'
C_RESET='#[default]'
LOCK_HELD=0
TEMP_BODY=''
TEMP_STATUS=''
TEMP_PARAMS=''

mkdir -p "$CACHE_ROOT" 2>/dev/null || true
now() { if [ -n "${USAGE_NOW:-}" ]; then printf '%s\n' "$USAGE_NOW"; else date +%s; fi; }
file_mtime() {
  stat -f '%m' "$1" 2>/dev/null || stat -c '%Y' "$1" 2>/dev/null
}
file_age() {
  local stamp
  stamp=$(file_mtime "$1") || return 1
  printf '%s\n' "$(( $(now) - stamp ))"
}
cleanup() {
  [ -n "$TEMP_BODY" ] && rm -f "$TEMP_BODY"
  [ -n "$TEMP_STATUS" ] && rm -f "$TEMP_STATUS"
  [ -n "$TEMP_PARAMS" ] && rm -f "$TEMP_PARAMS"
  if [ "$LOCK_HELD" -eq 1 ]; then rmdir "$LOCK_DIR" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then LOCK_HELD=1; return 0; fi
  local age
  age=$(file_age "$LOCK_DIR" 2>/dev/null) || age=0
  if [ "$age" -ge "$LOCK_TTL" ]; then
    if [ -d "$LOCK_DIR" ]; then rmdir "$LOCK_DIR" 2>/dev/null || return 1
    else rm -f "$LOCK_DIR" 2>/dev/null || return 1
    fi
    if mkdir "$LOCK_DIR" 2>/dev/null; then LOCK_HELD=1; return 0; fi
  fi
  return 1
}

in_backoff() {
  [ -f "$BACKOFF_FILE" ] || return 1
  local delay age
  delay=$(cat "$BACKOFF_FILE" 2>/dev/null)
  case "$delay" in 120|240|480|600) ;; *) delay=120 ;; esac
  age=$(file_age "$BACKOFF_FILE" 2>/dev/null) || return 1
  [ "$age" -lt "$delay" ]
}
record_failure() {
  local old next tmp
  old=$(cat "$BACKOFF_FILE" 2>/dev/null)
  case "$old" in 120) next=240 ;; 240) next=480 ;; 480|600) next=600 ;; *) next=120 ;; esac
  tmp="$BACKOFF_FILE.tmp.$$"
  (umask 077; printf '%s\n' "$next" > "$tmp") && chmod 600 "$tmp" 2>/dev/null && mv -f "$tmp" "$BACKOFF_FILE"
}

iso_to_unix() {
  local value="$1" clean
  clean=$(printf '%s' "$value" | sed 's/\.[0-9][0-9]*//; s/+00:00$/Z/')
  date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$clean" '+%s' 2>/dev/null ||
    date -u -d "$clean" '+%s' 2>/dev/null
}

normalize_claude() {
  local input="$1" five seven freset sreset
  five=$(jq -r '.five_hour.utilization // empty' "$input" 2>/dev/null)
  seven=$(jq -r '.seven_day.utilization // empty' "$input" 2>/dev/null)
  [ -n "$five" ] || [ -n "$seven" ] || return 1
  freset=$(jq -r '.five_hour.reset_at // .five_hour.resets_at // empty' "$input" 2>/dev/null)
  sreset=$(jq -r '.seven_day.reset_at // .seven_day.resets_at // empty' "$input" 2>/dev/null)
  case "$freset" in *[!0-9]*|'') [ -n "$freset" ] && freset=$(iso_to_unix "$freset") || freset='' ;; esac
  case "$sreset" in *[!0-9]*|'') [ -n "$sreset" ] && sreset=$(iso_to_unix "$sreset") || sreset='' ;; esac
  jq -n -c --arg p claude --arg fu "$five" --arg fr "$freset" --arg su "$seven" --arg sr "$sreset" '
    def window($u;$r): if $u == "" then null else
      {utilization: ($u|tonumber), reset_at: (if $r=="" then null else ($r|tonumber|floor) end)} end;
    {provider:$p,five_hour:window($fu;$fr),seven_day:window($su;$sr)}' 2>/dev/null
}

normalize_codex() {
  local input="$1"
  jq -e -c --argjson now "$(now)" '
    def windows: [(.rate_limit? // .) | .. | objects |
      select((.limit_window_seconds? == 18000) or (.limit_window_seconds? == 604800))];
    def normalized($seconds):
      ([windows[] | select(.limit_window_seconds == $seconds)][0]) as $w |
      if $w == null or (($w.used_percent? // $w.utilization?) | type) != "number" then null
      else {utilization: ($w.used_percent // $w.utilization),
            reset_at: (if ($w.reset_at? | type) == "number" then $w.reset_at
                       elif (($w.reset_after? // $w.reset_after_seconds?) | type) == "number"
                       then ($now + ($w.reset_after // $w.reset_after_seconds) | floor)
                       else null end)} end;
    {provider:"codex",five_hour:normalized(18000),seven_day:normalized(604800)} |
    select(.five_hour != null or .seven_day != null)' "$input" 2>/dev/null
}

normalize_qwen() {
  # Qwen Cloud Token Plan usage (console gateway /data/api.json).
  # per5HourPercentage / per1WeekPercentage are the USED share of the window
  # expressed as a 0..1 FRACTION (the console inverts it to "Remaining"), so
  # we scale to percent here to match the Claude/Codex utilization axis. The
  # bar's red/yellow thresholds only make sense on the used axis, which is
  # why the widget intentionally shows "used" while the site shows "remaining".
  # per5HourResetTime / per1WeekResetTime are reset timestamps in ms.
  local input="$1"
  jq -e -c '
    ([.. | objects | select(
      ((.per5HourPercentage? | type) == "number") or
      ((.per1WeekPercentage? | type) == "number"))][0]) as $w |
    select($w != null) |
    def pct($v): ($v * 10000 | round) / 100;
    def window($v; $r):
      if ($v | type) == "number" then
        {utilization: pct($v),
         reset_at: (if ($r | type) == "number" then ($r / 1000 | floor) else null end)}
      else null end;
    {provider:"qwen",
     five_hour: window($w.per5HourPercentage?; $w.per5HourResetTime?),
     seven_day: window($w.per1WeekPercentage?; $w.per1WeekResetTime?)}' "$input" 2>/dev/null
}

normalize_file() {
  case "$PROVIDER" in
    claude) normalize_claude "$1" ;;
    codex) normalize_codex "$1" ;;
    *) normalize_qwen "$1" ;;
  esac
}
valid_normalized_cache() {
  jq -e --arg p "$PROVIDER" '
    .provider == $p and
    (.five_hour == null or (.five_hour|type)=="object" and (.five_hour.utilization|type)=="number" and (.five_hour.reset_at == null or (.five_hour.reset_at|type)=="number")) and
    (.seven_day == null or (.seven_day|type)=="object" and (.seven_day.utilization|type)=="number" and (.seven_day.reset_at == null or (.seven_day.reset_at|type)=="number")) and
    (.five_hour != null or .seven_day != null)' "$1" >/dev/null 2>&1
}
read_cache() {
  [ -f "$CACHE_FILE" ] || return 1
  if valid_normalized_cache "$CACHE_FILE"; then cat "$CACHE_FILE"; return 0; fi
  # Historical Claude caches contain raw five_hour/seven_day responses.
  if [ "$PROVIDER" = claude ]; then
    local normalized
    normalized=$(normalize_claude "$CACHE_FILE") || return 1
    write_cache "$normalized" || return 1
    printf '%s\n' "$normalized"
  else
    return 1
  fi
}
write_cache() {
  local data="$1" tmp="$CACHE_FILE.tmp.$$"
  (umask 077; printf '%s\n' "$data" > "$tmp") || return 1
  chmod 600 "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$CACHE_FILE"
}

request() {
  local body="$1" status_file="$2" token account creds version
  local cookie sec_token base_url action region usage_api params_file
  if [ -n "${USAGE_FIXTURE_FILE:-}" ]; then
    cp "$USAGE_FIXTURE_FILE" "$body" || return 1
    printf '%s' "${USAGE_FIXTURE_STATUS:-200}" > "$status_file"
    return 0
  fi
  if [ "$PROVIDER" = claude ]; then
    creds=$(security find-generic-password -s 'Claude Code-credentials' -w 2>/dev/null) || return 1
    token=$(printf '%s' "$creds" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
    [ -n "$token" ] || return 1
    version=$(claude -v 2>/dev/null || printf '2.1.69')
    curl --silent --show-error --max-time 5 --output "$body" --write-out '%{http_code}' \
      --config - > "$status_file" 2>/dev/null <<EOF
url = "https://api.anthropic.com/api/oauth/usage"
header = "Authorization: Bearer $token"
header = "anthropic-beta: oauth-2025-04-20"
header = "User-Agent: claude-code/$version"
EOF
  elif [ "$PROVIDER" = codex ]; then
    creds="${CODEX_HOME:-$HOME/.codex}/auth.json"
    [ -f "$creds" ] || return 1
    token=$(jq -r '.tokens.access_token // empty' "$creds" 2>/dev/null)
    account=$(jq -r '.tokens.account_id // empty' "$creds" 2>/dev/null)
    [ -n "$token" ] && [ -n "$account" ] || return 1
    curl --silent --show-error --max-time 5 --output "$body" --write-out '%{http_code}' \
      --config - > "$status_file" 2>/dev/null <<EOF
url = "https://chatgpt.com/backend-api/wham/usage"
request = "GET"
header = "Authorization: Bearer $token"
header = "ChatGPT-Account-Id: $account"
header = "User-Agent: codex-cli"
EOF
  else
    # Qwen Cloud Token Plan usage. Same internal gateway the console home
    # page calls to render 5-hour/7-day utilization (per5HourPercentage /
    # per1WeekPercentage). Session cookie auth, not an sk- API key: the
    # cookie + sec_token are exported from a logged-in home.qwencloud.com
    # browser tab into ~/.qwencloud/credentials.json (see README).
    creds="${QWENCLOUD_HOME:-$HOME/.qwencloud}/credentials.json"
    [ -f "$creds" ] || return 1
    cookie=$(jq -r '.cookie // empty' "$creds" 2>/dev/null) || return 1
    sec_token=$(jq -r '.sec_token // empty' "$creds" 2>/dev/null)
    [ -n "$cookie" ] && [ -n "$sec_token" ] || return 1
    base_url=$(jq -r '.base_url // "https://cs-data.qwencloud.com"' "$creds" 2>/dev/null)
    referer=$(jq -r '.referer // "https://home.qwencloud.com/"' "$creds" 2>/dev/null)
    action=$(jq -r '.action // "IntlBroadScopeAspnGateway"' "$creds" 2>/dev/null)
    region=$(jq -r '.region // "ap-southeast-1"' "$creds" 2>/dev/null)
    usage_api=$(jq -r '.usage_api // "zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage"' "$creds" 2>/dev/null)
    [ -n "$base_url" ] && [ -n "$action" ] && [ -n "$region" ] && [ -n "$usage_api" ] || return 1
    # cornerstoneParam mirrors what the console injects client-side (Wxe());
    # domain follows the console host taken from the referer.
    domain=${referer#*://}
    domain=${domain%%/*}
    api_enc=$(jq -rn --arg a "$usage_api" '$a|@uri' 2>/dev/null) || api_enc=''
    params_file="$CACHE_ROOT/.usage-qwen-params.$$"
    TEMP_PARAMS="$params_file"
    rm -f "$params_file"
    printf '%s' "$(jq -n -c --arg api "$usage_api" --arg domain "$domain" '
      {Api:$api,
       Data:{cornerstoneParam:{domain:$domain,consoleSite:"QWENCLOUD",
              console:"ONE_CONSOLE",xsp_lang:"en-US",protocol:"V2",
              productCode:"p_efm"}},
       V:"1.0"}' 2>/dev/null)" > "$params_file" || return 1
    curl --silent --show-error --max-time 5 --compressed --output "$body" --write-out '%{http_code}' \
      --config - > "$status_file" 2>/dev/null <<EOF
url = "$base_url/data/api.json?product=sfm_bailian&action=$action&api=$api_enc"
request = "POST"
header = "Content-Type: application/x-www-form-urlencoded"
header = "Cookie: $cookie"
header = "Referer: $referer"
header = "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:152.0) Gecko/20100101 Firefox/152.0"
data-urlencode = "product=sfm_bailian"
data-urlencode = "action=$action"
data-urlencode = "sec_token=$sec_token"
data-urlencode = "region=$region"
data-urlencode = "params@$params_file"
EOF
  fi
}

fetch_data() {
  local age body status_file status normalized cached
  DATA=''
  if [ -f "$CACHE_FILE" ]; then
    age=$(file_age "$CACHE_FILE" 2>/dev/null) || age=$CACHE_TTL
    if [ "$age" -lt "$CACHE_TTL" ] && cached=$(read_cache); then
      DATA="$cached"
      return
    fi
  fi
  if in_backoff || ! acquire_lock; then
    cached=$(read_cache) && DATA="$cached"
    return
  fi
  body="$CACHE_ROOT/.usage-body.$$"
  status_file="$CACHE_ROOT/.usage-status.$$"
  TEMP_BODY="$body"
  TEMP_STATUS="$status_file"
  rm -f "$body" "$status_file"
  if request "$body" "$status_file"; then
    status=$(cat "$status_file" 2>/dev/null)
  else
    status=000
  fi
  if case "$status" in 2[0-9][0-9]) true ;; *) false ;; esac && normalized=$(normalize_file "$body"); then
    if write_cache "$normalized"; then
      rm -f "$BACKOFF_FILE"
      DATA="$normalized"
    fi
    rm -f "$body" "$status_file"
    TEMP_BODY=''; TEMP_STATUS=''
    return
  fi
  rm -f "$body" "$status_file"
  TEMP_BODY=''; TEMP_STATUS=''
  record_failure
  cached=$(read_cache) && DATA="$cached"
}

clamp_pct() {
  local pct
  pct=${1%%.*}
  case "$pct" in ''|'-') pct=0 ;; esac
  [ "$pct" -lt 0 ] && pct=0
  [ "$pct" -gt 100 ] && pct=100
  printf '%s' "$pct"
}
pct_color() { if [ "$1" -gt 80 ]; then printf '%s' "$C_RED"; elif [ "$1" -gt 60 ]; then printf '%s' "$C_YELLOW"; else printf '%s' "$C_GRAY"; fi; }
make_bar() {
  local pct="$1" color="$2" filled empty full blank
  filled=$((pct * 10 / 100)); empty=$((10 - filled))
  full=$(printf '%*s' "$filled" '' | tr ' ' '▓')
  blank=$(printf '%*s' "$empty" '' | tr ' ' '░')
  printf '%s[%s%s%s%s]%s' "$C_GRAY" "$C_RESET" "$color" "$full" "$C_GRAY$blank" "$C_RESET"
}
format_time() {
  local seconds="$1" days hours mins
  [ "$seconds" -lt 0 ] && seconds=0
  days=$((seconds / 86400)); hours=$(((seconds % 86400) / 3600)); mins=$(((seconds % 3600) / 60))
  if [ "$days" -gt 0 ]; then printf '%sd%sh' "$days" "$hours"; elif [ "$hours" -gt 0 ]; then printf '%sh%sm' "$hours" "$mins"; else printf '%sm' "$mins"; fi
}
format_window() {
  local data="$1" key="$2" utilization reset pct color bar label
  utilization=$(printf '%s' "$data" | jq -r ".$key.utilization // empty" 2>/dev/null)
  [ -n "$utilization" ] || return
  reset=$(printf '%s' "$data" | jq -r ".$key.reset_at // empty" 2>/dev/null)
  pct=$(clamp_pct "$utilization"); color=$(pct_color "$pct"); bar=$(make_bar "$pct" "$color")
  if [ -n "$reset" ]; then label=$(format_time "$((reset - $(now)))"); elif [ "$key" = five_hour ]; then label=5h; else label=7d; fi
  if [ "$key" = five_hour ]; then
    printf '%s%s:%s %s %s%s%%%s' "$C_GRAY" "$label" "$C_RESET" "$bar" "$color" "$pct" "$C_RESET"
  else
    printf '%s%s:%s %s %s%s%%%s' "$C_GRAY" "$label" "$C_RESET" "$bar" "$color" "$pct" "$C_RESET"
  fi
}
format_age() {
  local seconds="$1" result
  if [ "$seconds" -lt 2 ]; then result=now; elif [ "$seconds" -lt 60 ]; then result="${seconds}s"; elif [ "$seconds" -lt 3600 ]; then result="$((seconds / 60))m"; else result="$((seconds / 3600))h"; fi
  [ "${#result}" -lt 3 ] && result=" $result"
  printf '%s%s%s' "$C_GRAY" "$result" "$C_RESET"
}
missing() { printf '%s--%s' "$C_GRAY" "$C_RESET"; }

if [ "$MODE" = age ]; then
  if [ -f "$CACHE_FILE" ] && read_cache >/dev/null 2>&1; then age=$(file_age "$CACHE_FILE" 2>/dev/null) || age=0; format_age "$age"; else missing; fi
  exit 0
fi
DATA=''
fetch_data
if [ -z "$DATA" ]; then missing; exit 0; fi
case "$MODE" in
  5h) output=$(format_window "$DATA" five_hour); [ -n "$output" ] && printf '%s' "$output" || missing ;;
  7d) output=$(format_window "$DATA" seven_day); [ -n "$output" ] && printf '%s' "$output" || missing ;;
  all)
    first=$(format_window "$DATA" five_hour); second=$(format_window "$DATA" seven_day)
    if [ -n "$first" ] && [ -n "$second" ]; then printf '%s %s│%s %s' "$first" "$C_GRAY" "$C_RESET" "$second"
    elif [ -n "$first" ]; then printf '%s' "$first"
    elif [ -n "$second" ]; then printf '%s' "$second"
    else missing; fi ;;
esac
