#!/bin/bash
#
# Claude Code statusline - Tokyo Night Storm.
#
# Mirrors the layout of @wierdbytes/pi-statusline (pi.dev):
#
#   ─  Opus 5  xhigh │ 1%: 15k[▓░░░░░░░░░]952k │ $0.00 │ …/me/dev/x │ master ✓ ─────
#
# Blocks, in order: model (+ effort/thinking), context, cost, path, git.
# The row opens with a horizontal rule and is padded out to the terminal
# width with the same glyph so it reads as a border under the prompt box.
#
# Icons are Nerd Font glyphs (PUA) - matches the `nerd-font` icon set in
# ~/.pi/agent/wierd-statusline/events.json.

# Multibyte-aware ${#var} for the fill calculation.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8*|*utf8*|*UTF8*) ;;
    *) export LC_ALL=en_US.UTF-8 ;;
esac

# Tokyo Night Storm palette
C_RED=$'\033[38;2;247;118;142m'
C_YELLOW=$'\033[38;2;224;175;104m'
C_GREEN=$'\033[38;2;158;206;106m'
C_CYAN=$'\033[38;2;125;207;255m'
C_BLUE=$'\033[38;2;122;162;247m'
C_PURPLE=$'\033[38;2;187;154;247m'
C_PINK=$'\033[38;2;215;135;175m'
C_ORANGE=$'\033[38;2;255;158;100m'
C_GRAY=$'\033[38;2;86;95;137m'
C_RESET=$'\033[0m'

# Glyphs (substituted at build time; see the icon table in icons.ts upstream)
ICON_MODEL=''
ICON_THINK=''
GLYPH_RULE='─'
GLYPH_SEP='│'
GLYPH_FULL='▓'
GLYPH_EMPTY='░'
GLYPH_ELLIPSIS='…'
GLYPH_OK='✓'
GLYPH_DIRTY='✗'

# Autocompact buffer is 33k tokens (absolute, not percentage-based); the
# context block measures against the usable window, not the raw one.
AUTOCOMPACT_BUFFER=33000
BAR_WIDTH=10

input=$(cat)

# One jq pass, unit-separator joined so empty fields survive `read`.
fields=$(printf '%s' "$input" | jq -j '
  [ .workspace.current_dir,
    (.model.display_name // ""),
    (.effort.level // ""),
    (if (.thinking.enabled == false) then "" else "1" end),
    (.cost.total_cost_usd // 0),
    (if ((.cost.total_cost_usd // 0) > 0) then "1" else "" end),
    ((.context_window.current_usage // {})
       | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))),
    (.context_window.context_window_size // 0)
  ] | map(tostring) | join("")')

IFS=$'\037' read -r current_dir model_name effort_level thinking_on cost has_cost current ctx_size <<<"$fields"

# 1234 -> 1.2k, 15000 -> 15k, 1500000 -> 1.5M (pi's formatTokens).
fmt_tokens() {
    local n=$1
    if [ "$n" -lt 1000 ]; then
        printf '%s' "$n"
    elif [ "$n" -lt 10000 ]; then
        printf '%d.%dk' $((n / 1000)) $(((n % 1000) / 100))
    elif [ "$n" -lt 1000000 ]; then
        printf '%dk' $(((n + 500) / 1000))
    elif [ "$n" -lt 10000000 ]; then
        printf '%d.%dM' $((n / 1000000)) $(((n % 1000000) / 100000))
    else
        printf '%dM' $(((n + 500000) / 1000000))
    fi
}

parts=()   # colored
plains=()  # same text without escapes - used to measure the fill
add_block() {
    [ -z "$2" ] && return
    parts[${#parts[@]}]="$1"
    plains[${#plains[@]}]="$2"
}

# --- model ---------------------------------------------------------------
# `Claude ` / `anthropic/` prefixes are noise in a one-line footer.
case "$model_name" in
    "Claude "*)    model_name=${model_name#Claude } ;;
    "anthropic/"*) model_name=${model_name#anthropic/} ;;
esac

if [ -n "$model_name" ]; then
    m_part="${C_PINK}${ICON_MODEL} ${model_name}${C_RESET}"
    m_plain="${ICON_MODEL} ${model_name}"

    # Effort is only present in the payload for reasoning-capable models.
    if [ -n "$effort_level" ]; then
        [ -z "$thinking_on" ] && effort_level="off"
        case "$effort_level" in
            off)     think_label="off";   think_color="$C_GRAY" ;;
            minimal) think_label="min";   think_color="$C_PURPLE" ;;
            low)     think_label="low";   think_color="$C_BLUE" ;;
            medium)  think_label="med";   think_color="$C_CYAN" ;;
            high)    think_label="high";  think_color="$C_ORANGE" ;;
            xhigh)   think_label="xhigh"; think_color="$C_RED" ;;
            max)     think_label="max";   think_color="" ;;
            *)       think_label="$effort_level"; think_color="$C_GRAY" ;;
        esac
        if [ "$think_label" = "max" ]; then
            # `max` gets a per-glyph orange -> red -> pink -> purple gradient
            # so it stands above the solid-color effort ladder.
            think_colored="${C_ORANGE}${ICON_THINK} ${C_RED}m${C_PINK}a${C_PURPLE}x${C_RESET}"
        else
            think_colored="${think_color}${ICON_THINK} ${think_label}${C_RESET}"
        fi
        m_part="${m_part} ${think_colored}"
        m_plain="${m_plain} ${ICON_THINK} ${think_label}"
    fi
    add_block "$m_part" "$m_plain"
fi

# --- context -------------------------------------------------------------
if [ "${ctx_size:-0}" -gt 0 ] 2>/dev/null; then
    usable=$((ctx_size - AUTOCOMPACT_BUFFER))
    [ "$usable" -lt 1 ] && usable=$ctx_size

    pct=$((current * 100 / usable))
    remaining=$((usable - current))
    if [ "$remaining" -lt 0 ]; then
        remaining=0
        pct=100
    fi
    [ "$pct" -gt 100 ] && pct=100
    [ "$pct" -lt 0 ] && pct=0

    if [ "$pct" -gt 80 ]; then
        pct_color="$C_RED"
    elif [ "$pct" -gt 60 ]; then
        pct_color="$C_YELLOW"
    else
        pct_color="$C_GREEN"
    fi

    filled=$((pct * BAR_WIDTH / 100))
    [ "$filled" -gt "$BAR_WIDTH" ] && filled=$BAR_WIDTH
    [ "$filled" -lt 0 ] && filled=0
    empty=$((BAR_WIDTH - filled))

    bar_filled=""
    i=0
    while [ "$i" -lt "$filled" ]; do bar_filled="${bar_filled}${GLYPH_FULL}"; i=$((i + 1)); done
    bar_empty=""
    i=0
    while [ "$i" -lt "$empty" ]; do bar_empty="${bar_empty}${GLYPH_EMPTY}"; i=$((i + 1)); done

    used_fmt=$(fmt_tokens "$current")
    rem_fmt=$(fmt_tokens "$remaining")

    add_block \
        "${pct_color}${pct}%${C_RESET}: ${used_fmt}${C_GRAY}[${pct_color}${bar_filled}${C_GRAY}${bar_empty}]${C_RESET}${rem_fmt}" \
        "${pct}%: ${used_fmt}[${bar_filled}${bar_empty}]${rem_fmt}"
fi

# --- cost ----------------------------------------------------------------
if [ -n "$has_cost" ]; then
    cost_fmt=$(printf '%.2f' "$cost")
    add_block "${C_GRAY}\$${cost_fmt}${C_RESET}" "\$${cost_fmt}"
fi

# --- path ----------------------------------------------------------------
short_dir=$(printf '%s' "$current_dir" | awk -v ell="$GLYPH_ELLIPSIS" -F'/' \
    '{n = NF; if (n <= 3) print $0; else printf "%s/%s/%s/%s", ell, $(n-2), $(n-1), $n}')
case "$short_dir" in
    */*) dir_parent=${short_dir%/*}; dir_name=${short_dir##*/} ;;
    *)   dir_parent="";              dir_name=$short_dir ;;
esac
add_block "${C_GRAY}${dir_parent}${C_PURPLE}/${dir_name}${C_RESET}" "${dir_parent}/${dir_name}"

# --- git -----------------------------------------------------------------
if git -C "$current_dir" rev-parse --git-dir >/dev/null 2>&1; then
    git_branch=$(git -C "$current_dir" --no-optional-locks branch --show-current 2>/dev/null)
    if [ -n "$git_branch" ]; then
        if git -C "$current_dir" --no-optional-locks diff-index --quiet HEAD 2>/dev/null; then
            add_block "${C_CYAN}${git_branch} ${C_GREEN}${GLYPH_OK}${C_RESET}" "${git_branch} ${GLYPH_OK}"
        else
            add_block "${C_CYAN}${git_branch} ${C_RED}${GLYPH_DIRTY}${C_RESET}" "${git_branch} ${GLYPH_DIRTY}"
        fi
    fi
fi

# --- compose -------------------------------------------------------------
sep=" ${C_GRAY}${GLYPH_SEP}${C_RESET} "
sep_plain=" ${GLYPH_SEP} "

line="${C_GRAY}${GLYPH_RULE}${C_RESET} "
plain="${GLYPH_RULE} "
i=0
while [ "$i" -lt "${#parts[@]}" ]; do
    if [ "$i" -gt 0 ]; then
        line="${line}${sep}"
        plain="${plain}${sep_plain}"
    fi
    line="${line}${parts[$i]}"
    plain="${plain}${plains[$i]}"
    i=$((i + 1))
done
line="${line} "
plain="${plain} "

# Pad out to the terminal width so the row reads as a border. Width is
# only discoverable through the controlling tty - stdout is a pipe.
# `[ -r /dev/tty ]` is true even where opening it fails (no controlling
# terminal), so the whole group is muted rather than just stty.
cols=$( { stty size </dev/tty; } 2>/dev/null | awk '{print $2}' )
[ -z "$cols" ] && cols=${COLUMNS:-}

fill=1
if [ -n "$cols" ] && [ "$cols" -gt 0 ] 2>/dev/null; then
    fill=$((cols - ${#plain}))
    [ "$fill" -lt 1 ] && fill=1
fi

tail_rule=""
i=0
while [ "$i" -lt "$fill" ]; do tail_rule="${tail_rule}${GLYPH_RULE}"; i=$((i + 1)); done

printf '%s' "${line}${C_GRAY}${tail_rule}${C_RESET}"
