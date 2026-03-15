#!/bin/bash

# Usage: claude-usage.sh [5h|7d|age|all]
# 5h  - показать только 5-часовой лимит
# 7d  - показать только недельный лимит
# age - показать возраст кэша (время с последнего ответа API)
# all - показать оба (по умолчанию)

MODE="${1:-all}"

CACHE_DIR="$HOME/.cache"
API_CACHE_FILE="$CACHE_DIR/claude-api-response.json"
LOCK_FILE="$CACHE_DIR/claude-usage.lock"
BACKOFF_FILE="$CACHE_DIR/claude-usage-backoff"

# Tokyo Night Storm palette (tmux format)
C_RED="#[fg=#f7767e]"
C_YELLOW="#[fg=#e0af68]"
C_GRAY="#[fg=#565f89]"
C_RESET="#[default]"

[[ ! -d "$CACHE_DIR" ]] && mkdir -p "$CACHE_DIR"

get_pct_color() {
  local pct="$1"
  if [[ $pct -gt 80 ]]; then
    echo "$C_RED"
  elif [[ $pct -gt 60 ]]; then
    echo "$C_YELLOW"
  else
    echo "$C_GRAY"
  fi
}

make_bar() {
  local pct="$1"
  local color="$2"
  local width=10
  local filled=$((pct * width / 100))
  local empty=$((width - filled))
  [[ $filled -gt $width ]] && filled=$width
  [[ $filled -lt 0 ]] && filled=0
  [[ $empty -lt 0 ]] && empty=0
  local bar_filled=$(printf '%*s' "$filled" '' | tr ' ' '▓')
  local bar_empty=$(printf '%*s' "$empty" '' | tr ' ' '░')
  printf "${C_GRAY}[${C_RESET}${color}${bar_filled}${C_GRAY}${bar_empty}]${C_RESET}"
}

get_file_age() {
  local file="$1"
  local mod_time=$(stat -f '%m' "$file" 2>/dev/null)
  local now=$(date +%s)
  echo $((now - mod_time))
}

format_remaining_time() {
  local seconds="$1"
  if [[ $seconds -le 0 ]]; then
    echo "0m"
    return
  fi
  local hours=$((seconds / 3600))
  local mins=$(((seconds % 3600) / 60))
  if [[ $hours -gt 0 ]]; then
    echo "${hours}h${mins}m"
  else
    echo "${mins}m"
  fi
}

format_remaining_time_days() {
  local seconds="$1"
  if [[ $seconds -le 0 ]]; then
    echo "0m"
    return
  fi
  local days=$((seconds / 86400))
  local hours=$(((seconds % 86400) / 3600))
  local mins=$(((seconds % 3600) / 60))
  if [[ $days -gt 0 ]]; then
    echo "${days}d${hours}h"
  elif [[ $hours -gt 0 ]]; then
    echo "${hours}h${mins}m"
  else
    echo "${mins}m"
  fi
}

format_cache_age() {
  local seconds="$1"
  local result
  if [[ $seconds -lt 2 ]]; then
    result="now"
  elif [[ $seconds -lt 60 ]]; then
    result="${seconds}s"
  elif [[ $seconds -lt 3600 ]]; then
    result="$((seconds / 60))m"
  else
    result="$((seconds / 3600))h"
  fi
  [[ ${#result} -lt 3 ]] && result=" ${result}"
  echo "$result"
}

parse_iso_to_seconds_left() {
  local iso_date="$1"
  local clean_date=$(echo "$iso_date" | sed 's/\.[0-9]*//; s/+00:00//; s/Z$//')
  local reset_ts=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$clean_date" "+%s" 2>/dev/null)
  if [[ -n "$reset_ts" ]]; then
    local now=$(date +%s)
    echo $((reset_ts - now))
  else
    echo ""
  fi
}

# Получаем данные API (с кэшированием и backoff)
fetch_api_data() {
  local CACHE_TTL=120

  # Используем кэш если свежий
  if [[ -f "$API_CACHE_FILE" ]]; then
    local age=$(get_file_age "$API_CACHE_FILE")
    if [[ $age -lt $CACHE_TTL ]]; then
      cat "$API_CACHE_FILE"
      return 0
    fi
  fi

  # Exponential backoff после rate limit ошибок
  if [[ -f "$BACKOFF_FILE" ]]; then
    local backoff_age=$(get_file_age "$BACKOFF_FILE")
    local backoff_until=$(cat "$BACKOFF_FILE" 2>/dev/null)
    backoff_until=${backoff_until:-120}
    if [[ $backoff_age -lt $backoff_until ]]; then
      [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"
      return 0
    fi
  fi

  # Lock: не более одного запроса одновременно
  if [[ -f "$LOCK_FILE" ]]; then
    local lock_age=$(get_file_age "$LOCK_FILE")
    if [[ $lock_age -lt 30 ]]; then
      [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"
      return 0
    fi
  fi
  touch "$LOCK_FILE"

  # Получаем credentials
  local keychain_data=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null)
  [[ -z "$keychain_data" ]] && { [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"; return 0; }

  local token=$(echo "$keychain_data" | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
  [[ -z "$token" ]] && { [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"; return 0; }

  local claude_version=$(claude -v 2>/dev/null || echo '2.1.69')
  local response=$(curl -s --max-time 5 "https://api.anthropic.com/api/oauth/usage" \
    -H "Authorization: Bearer $token" \
    -H "anthropic-beta: oauth-2025-04-20" \
    -H "User-Agent: claude-code/$claude_version" 2>/dev/null)

  if [[ -z "$response" ]]; then
    [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"
    return 0
  fi

  # Проверяем ответ на ошибки — НЕ кэшируем ошибки
  local err_type=$(echo "$response" | jq -r '.error.type // empty' 2>/dev/null)
  if [[ "$err_type" == "rate_limit_error" ]]; then
    # Exponential backoff: 120 -> 240 -> 480 -> max 600s
    local prev_backoff=$(cat "$BACKOFF_FILE" 2>/dev/null)
    prev_backoff=${prev_backoff:-60}
    local next_backoff=$((prev_backoff * 2))
    [[ $next_backoff -gt 600 ]] && next_backoff=600
    echo "$next_backoff" > "$BACKOFF_FILE"
    # Вернуть старый кэш (даже просроченный) вместо ошибки
    [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"
    return 0
  elif [[ -n "$err_type" ]]; then
    # Другие ошибки API — тоже не кэшируем, используем старый кэш
    [[ -f "$API_CACHE_FILE" ]] && cat "$API_CACHE_FILE"
    return 0
  fi

  # Успешный ответ — сброс backoff и обновление кэша
  rm -f "$BACKOFF_FILE"
  echo "$response" > "$API_CACHE_FILE"
  echo "$response"
}

# Форматирование 5-часового лимита
format_5h() {
  local response="$1"
  local session=$(echo "$response" | jq -r '.five_hour.utilization // empty' 2>/dev/null)
  [[ -z "$session" ]] && return

  local session_int=${session%.*}
  local session_color=$(get_pct_color "$session_int")
  local session_bar=$(make_bar "$session_int" "$session_color")
  local reset_at=$(echo "$response" | jq -r '.five_hour.resets_at // empty' 2>/dev/null)

  local time_fmt="5h"
  if [[ -n "$reset_at" ]]; then
    local secs_left=$(parse_iso_to_seconds_left "$reset_at")
    time_fmt=$(format_remaining_time "$secs_left")
  fi

  printf "%s: %s %s%s%%%s" "$time_fmt" "$session_bar" "$session_color" "$session_int" "$C_RESET"
}

# Форматирование недельного лимита
format_7d() {
  local response="$1"
  local weekly=$(echo "$response" | jq -r '.seven_day.utilization // empty' 2>/dev/null)
  [[ -z "$weekly" ]] && return

  local weekly_int=${weekly%.*}
  local weekly_color=$(get_pct_color "$weekly_int")
  local weekly_bar=$(make_bar "$weekly_int" "$weekly_color")
  local reset_at=$(echo "$response" | jq -r '.seven_day.resets_at // empty' 2>/dev/null)

  local time_fmt="7d"
  if [[ -n "$reset_at" ]]; then
    local secs_left=$(parse_iso_to_seconds_left "$reset_at")
    time_fmt=$(format_remaining_time_days "$secs_left")
  fi

  printf "%s%s:%s %s %s%s%%%s" "$C_GRAY" "$time_fmt" "$C_RESET" "$weekly_bar" "$weekly_color" "$weekly_int" "$C_RESET"
}

# age mode не требует API запроса — только возраст кэш-файла
if [[ "$MODE" == "age" ]]; then
  if [[ -f "$API_CACHE_FILE" ]]; then
    cache_age_secs=$(get_file_age "$API_CACHE_FILE")
    printf "%s%s%s" "$C_GRAY" "$(format_cache_age "$cache_age_secs")" "$C_RESET"
  else
    printf "%snow%s" "$C_GRAY" "$C_RESET"
  fi
  exit 0
fi

# Основная логика
RESPONSE=$(fetch_api_data)
[[ -z "$RESPONSE" ]] && exit 0

# Проверка max подписки
session=$(echo "$RESPONSE" | jq -r '.five_hour.utilization // empty' 2>/dev/null)
weekly=$(echo "$RESPONSE" | jq -r '.seven_day.utilization // empty' 2>/dev/null)
if [[ -z "$session" && -z "$weekly" ]]; then
  echo "${C_GRAY}?? Max${C_RESET}"
  exit 0
fi

case "$MODE" in
  5h)
    format_5h "$RESPONSE"
    ;;
  7d)
    format_7d "$RESPONSE"
    ;;
  all|*)
    output_5h=$(format_5h "$RESPONSE")
    output_7d=$(format_7d "$RESPONSE")
    if [[ -n "$output_5h" && -n "$output_7d" ]]; then
      echo "${output_5h} ${C_GRAY}│${C_RESET} ${output_7d}"
    elif [[ -n "$output_5h" ]]; then
      echo "$output_5h"
    elif [[ -n "$output_7d" ]]; then
      echo "$output_7d"
    fi
    ;;
esac
