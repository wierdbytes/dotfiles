#!/bin/bash

# Toggle the tmux status usage widget between Claude and Codex.
current=$(tmux show-option -gqv '@ghostty-usage-provider')
if [ "$current" = codex ]; then
  next=claude
else
  next=codex
fi

tmux set-option -g '@ghostty-usage-provider' "$next"
"${0%/*}/ghostty.tmux"
tmux refresh-client -S
