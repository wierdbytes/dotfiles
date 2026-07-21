#!/bin/bash

# Toggle the tmux status usage widget between Claude, Codex, and Qwen Cloud.
current=$(tmux show-option -gqv '@ghostty-usage-provider')
case "$current" in
  codex) next=qwen ;;
  qwen) next=claude ;;
  *) next=codex ;;
esac

tmux set-option -g '@ghostty-usage-provider' "$next"
"${0%/*}/ghostty.tmux"
tmux refresh-client -S
