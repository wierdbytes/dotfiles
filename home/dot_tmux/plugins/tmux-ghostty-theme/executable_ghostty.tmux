#!/usr/bin/env bash

set -euo pipefail

palette=()
background=""
foreground=""
cursor_color=""
cursor_text=""
selection_background=""
selection_foreground=""

ghostty_default_theme_dir="/Applications/Ghostty.app/Contents/Resources/ghostty/themes"
ghostty_default_config="${HOME}/.config/ghostty/config"

get_tmux_option() {
  local option=$1
  local default_value=$2
  local value
  value="$(tmux show-option -gqv "$option")"
  if [ -z "$value" ]; then
    printf '%s' "$default_value"
  else
    printf '%s' "$value"
  fi
}

get_bool_option() {
  local option=$1
  local default_value=$2
  local raw
  raw="$(get_tmux_option "$option" "$default_value")"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|on|yes|enable|enabled)
      printf '%s' "true"
      ;;
    *)
      printf '%s' "false"
      ;;
  esac
}

trim_leading_ws() {
  local value=$1
  printf '%s' "${value#"${value%%[![:space:]]*}"}"
}

detect_theme_from_config() {
  local config_path=$1
  [ -f "$config_path" ] || return

  local line theme=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim_leading_ws "$line")"
    [ -n "$line" ] || continue
    [ "${line:0:1}" = "#" ] && continue

    if [[ $line =~ ^theme[[:space:]]*=[[:space:]]*\"([^\"]+)\" ]]; then
      theme="${BASH_REMATCH[1]}"
    fi
  done < "$config_path"

  [ -n "$theme" ] && printf '%s' "$theme"
}

parse_theme_file() {
  local theme_file=$1
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    line="$(trim_leading_ws "$line")"
    [ -n "$line" ] || continue
    [ "${line:0:1}" = "#" ] && continue

    if [[ $line =~ ^palette[[:space:]]*=[[:space:]]*([0-9]+)=(#[0-9A-Fa-f]{6,8}) ]]; then
      palette[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
      continue
    fi

    if [[ $line =~ ^background[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      background="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ $line =~ ^foreground[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      foreground="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ $line =~ ^cursor-color[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      cursor_color="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ $line =~ ^cursor-text[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      cursor_text="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ $line =~ ^selection-background[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      selection_background="${BASH_REMATCH[1]}"
      continue
    fi

    if [[ $line =~ ^selection-foreground[[:space:]]*=[[:space:]]*(#[0-9A-Fa-f]{6,8}) ]]; then
      selection_foreground="${BASH_REMATCH[1]}"
      continue
    fi
  done < "$theme_file"
}

apply_tmux_theme() {
  local fallback_bg="#1d202f"
  local fallback_fg="#c0caf5"

  local bg="${background:-${palette[0]:-$fallback_bg}}"
  local fg="${foreground:-${palette[7]:-$fallback_fg}}"
  local accent="${palette[4]:-${palette[12]:-$fg}}"
  local accent_alt="${palette[5]:-${palette[13]:-$fg}}"
  local success="${palette[2]:-${palette[10]:-$fg}}"
  local warning="${palette[3]:-${palette[11]:-$fg}}"
  local muted="${palette[8]:-${palette[0]:-$fg}}"
  local selection="${selection_background:-${palette[0]:-$bg}}"

  local status_refresh
  status_refresh="$(get_tmux_option "@ghostty-refresh-rate" "5")"
  local show_powerline
  show_powerline="$(get_bool_option "@ghostty-show-powerline" "true")"
  local transparent
  transparent="$(get_bool_option "@ghostty-transparent-status" "false")"
  local left_icon
  left_icon="$(get_tmux_option "@ghostty-left-icon" "#S")"

  tmux set-option -g status-interval "$status_refresh"
  tmux set-option -g status-left-length 80
  tmux set-option -g status-right-length 160
  tmux set-option -g clock-mode-style 24

  if [ "$transparent" = "true" ]; then
    tmux set-option -g status-style "bg=default,fg=${fg}"
  else
    tmux set-option -g status-style "bg=${bg},fg=${fg}"
  fi

  tmux set-option -g message-style "bg=${accent},fg=${bg}"
  tmux set-option -g message-command-style "bg=${accent_alt},fg=${bg}"
  tmux set-option -g pane-border-style "fg=${muted}"
  tmux set-option -g pane-active-border-style "fg=${accent}"
  tmux set-option -g display-panes-active-colour "${accent}"
  tmux set-option -g display-panes-colour "${muted}"

  local left_status
  if [ "$show_powerline" = "true" ]; then
    left_status="#[fg=${bg},bg=${accent}]#{?client_prefix,#[bg=${warning}],} ${left_icon}#[fg=${accent},bg=${bg}]#{?client_prefix,#[fg=${warning}],}"
  else
    left_status="#[fg=${bg},bg=${accent}]#{?client_prefix,#[bg=${warning}],} ${left_icon} "
  fi
  tmux set-option -g status-left "$left_status"

  tmux set-option -g status-right ""

  tmux setw -g window-status-separator ""
  tmux setw -g window-status-activity-style "bold"
  tmux setw -g window-status-bell-style "bold"

  local window_edge_inactive="default"
  local window_edge_active="${accent_alt}"
  if [ "$show_powerline" = "true" ]; then
    # left = , right = 
    tmux setw -g window-status-format "#[fg=${fg},bg=defautl]  #I #W#[fg=${bg},bg=${window_edge_inactive}]"
    tmux setw -g window-status-current-format "#[fg=${bg},bg=${accent_alt}] #I #W#[fg=${window_edge_active},bg=${window_edge_inactive}]"
  else
    tmux setw -g window-status-format "#[fg=${window_edge_inactive},bg=${window_edge_inactive}] #[fg=${fg},bg=${bg}] #I #{?window_flags,#[fg=${warning}]#{window_flags} ,}#W #[fg=${window_edge_inactive},bg=${window_edge_inactive}] "
    tmux setw -g window-status-current-format "#[fg=${window_edge_active},bg=${window_edge_active}] #[fg=${bg},bg=${accent_alt}] #I #W #[fg=${window_edge_active},bg=${window_edge_active}] "
  fi

  tmux set-option -g mode-style "bg=${selection},fg=${fg}"
  tmux set-option -g copy-mode-match-style "bg=${selection},fg=${success}"
}

main() {
  local theme_dir
  theme_dir="$(get_tmux_option "@ghostty-theme-directory" "$ghostty_default_theme_dir")"
  local config_path
  config_path="$(get_tmux_option "@ghostty-config-path" "$ghostty_default_config")"

  local theme_name
  theme_name="$(get_tmux_option "@ghostty-theme-name" "")"
  if [ -z "$theme_name" ]; then
    theme_name="$(detect_theme_from_config "$config_path" || true)"
  fi
  if [ -z "$theme_name" ]; then
    theme_name="Ghostty Default Style Dark"
  fi

  local theme_file="${theme_dir%/}/${theme_name}"
  if [ ! -f "$theme_file" ]; then
    tmux display-message "ghostty-theme: unable to find theme '${theme_name}' in ${theme_dir}"
    return 0
  fi

  parse_theme_file "$theme_file"
  apply_tmux_theme
}

main

