#!/bin/bash

# Compatibility entry point for the tmux status line; the implementation lives
# in ~/bin/ai-usage (shared with the herdr `limits` mod).
exec "${AI_USAGE_BIN:-$HOME/bin/ai-usage}" "$@"
