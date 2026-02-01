#!/bin/bash

# Tokyo Night Storm palette
C_RED="\033[38;2;247;118;142m"
C_YELLOW="\033[38;2;224;175;104m"
C_GREEN="\033[38;2;158;206;106m"
C_CYAN="\033[38;2;125;207;255m"
C_BLUE="\033[38;2;122;162;247m"
C_PURPLE="\033[38;2;187;154;247m"
C_GRAY="\033[38;2;86;95;137m"
C_RESET="\033[0m"

# Read JSON input from stdin
input=$(cat)

# Extract current directory
current_dir=$(echo "$input" | jq -r '.workspace.current_dir')

# Git information
git_branch=""
git_status=""
if git -C "$current_dir" rev-parse --git-dir > /dev/null 2>&1; then
    git_branch=$(git -C "$current_dir" --no-optional-locks branch --show-current 2>/dev/null)
    if [ -n "$git_branch" ]; then
        if git -C "$current_dir" --no-optional-locks diff-index --quiet HEAD 2>/dev/null; then
            git_status="✓"
        else
            git_status="✗"
        fi
    fi
fi

# Shorten directory path and split for coloring
short_dir=$(echo "$current_dir" | awk -F'/' '{n = NF; if (n <= 3) print $0; else printf "…/%s/%s/%s", $(n-2), $(n-1), $n}')
# Split into parent path (gray) and current dir (purple)
dir_parent=$(dirname "$short_dir")
dir_name=$(basename "$short_dir")

# Context window usage and available before autocompaction
# Autocompact buffer is 16.5% of context window (33k for 200k model)
context_part=""
usage=$(echo "$input" | jq '.context_window.current_usage')
size=$(echo "$input" | jq '.context_window.context_window_size')

if [ "$usage" != "null" ]; then
    current=$(echo "$usage" | jq '.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens')
else
    # Zero state - no messages yet
    current=0
fi

# Autocompact triggers at 83.5% (100% - 16.5% buffer)
autocompact_threshold=$((size * 835 / 1000))
# Percentage of usable context (before autocompact)
pct=$((current * 100 / autocompact_threshold))
# Remaining before autocompaction
remaining=$((autocompact_threshold - current))
if [ $remaining -lt 0 ]; then
    remaining=0
    pct=100
fi
# Format remaining tokens (e.g., 110k)
if [ $remaining -ge 1000 ]; then
    remaining_fmt="$((remaining / 1000))k"
else
    remaining_fmt="$remaining"
fi
# Format current tokens
if [ $current -ge 1000 ]; then
    current_fmt="$((current / 1000))k"
else
    current_fmt="$current"
fi
# Dynamic color based on percentage
if [ $pct -gt 80 ]; then
    pct_color="$C_RED"
elif [ $pct -gt 60 ]; then
    pct_color="$C_YELLOW"
else
    pct_color="$C_GREEN"
fi

# Progress bar (10 chars wide)
bar_width=10
filled=$((pct * bar_width / 100))
empty=$((bar_width - filled))
# Clamp values
[ $filled -gt $bar_width ] && filled=$bar_width
[ $filled -lt 0 ] && filled=0
[ $empty -lt 0 ] && empty=0

bar_filled=$(printf '%*s' "$filled" '' | tr ' ' '▓')
bar_empty=$(printf '%*s' "$empty" '' | tr ' ' '░')
progress_bar="${pct_color}${bar_filled}${C_GRAY}${bar_empty}${C_RESET}"

context_part=$(printf " ${C_GRAY}│${C_RESET} ${pct_color}${pct}%%${C_RESET}: ${current_fmt}${C_GRAY}[${C_RESET}${progress_bar}${C_GRAY}]${C_RESET}${remaining_fmt}")

# Build status line components
dir_part=$(printf "${C_GRAY}${dir_parent}${C_PURPLE}/${dir_name}${C_RESET}")

if [ -n "$git_branch" ]; then
    if [ "$git_status" = "✓" ]; then
        git_part=$(printf " ${C_GRAY}│${C_CYAN} ${git_branch} ${C_GREEN}${git_status}${C_RESET}")
    else
        git_part=$(printf " ${C_GRAY}│${C_CYAN} ${git_branch} ${C_RED}${git_status}${C_RESET}")
    fi
else
    git_part=""
fi

# Session cost
cost=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
if [ "$cost" != "0" ] && [ "$cost" != "null" ]; then
    cost_fmt=$(printf "%.2f" "$cost")
    cost_part=$(printf " ${C_GRAY}│ \$${cost_fmt}${C_RESET}")
else
    cost_part=""
fi

# Print complete status line
echo -n "${dir_part}${git_part}${context_part}${cost_part}"
