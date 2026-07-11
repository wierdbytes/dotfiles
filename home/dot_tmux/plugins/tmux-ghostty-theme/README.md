## tmux-ghostty-theme

This is a very small TPM-friendly tmux theme that mirrors the active Ghostty
color scheme. It reads the same theme files that ship with Ghostty
(`/Applications/Ghostty.app/Contents/Resources/ghostty/themes`) and applies the
palette to tmux every time the config is sourced.

### How it works

1. Determine the theme name, either from `@ghostty-theme-name` or the Ghostty
   config (`~/.config/ghostty/config` by default).
2. Parse the corresponding Ghostty theme file.
3. Map the base, accent and neutral colors to tmux status, pane borders, and
   message styles.

Any time you change the Ghostty theme you can `prefix + r` to reload tmux and
immediately pick up the new palette.

### Configuration

All options are optional:

| option | default | purpose |
| --- | --- | --- |
| `@ghostty-theme-name` | detected from Ghostty config | Force a specific theme |
| `@ghostty-theme-directory` | `/Applications/Ghostty.app/Contents/Resources/ghostty/themes` | Override the theme root |
| `@ghostty-config-path` | `~/.config/ghostty/config` | Location of the Ghostty config used for auto-detection |
| `@ghostty-show-powerline` | `on` | Toggles the separators in the status line |
| `@ghostty-transparent-status` | `off` | Keep the tmux status background transparent |
| `@ghostty-left-icon` | `#S` | Content of the left-most segment |
| `@ghostty-right-format` | `%a %b %d %R` | Format string placed on the right |
| `@ghostty-refresh-rate` | `5` | `status-interval` value |

Example snippet for `.tmux.conf`:

```
set -g @plugin '~/.tmux/plugins/tmux-ghostty-theme'
set -g @ghostty-show-powerline on
set -g @ghostty-transparent-status off
```

### Claude and Codex usage widget

`usage.sh` provides one formatter for both providers:

```sh
usage.sh <claude|codex> [5h|7d|age|all]
```

The optional mode defaults to `all`. The status format recognizes
`claude-5h`, `claude-7d`, `claude-age`, `codex-5h`, `codex-7d`, and
`codex-age`; each token is expanded to a direct `usage.sh` invocation.
`claude-usage.sh` remains as a compatibility wrapper.

Set `@ghostty-right-format` to `usage-limits` and select the visible provider
with `@ghostty-usage-provider` (`claude` by default). The Claude group is
prefixed with `󰛄`, while Codex uses `󰭹`. Only one provider is rendered at a
time. In the bundled tmux configuration, `prefix + u` runs
`toggle-usage.sh`, switches the provider, and refreshes the status line.

Claude authentication is read from the macOS Keychain service
`Claude Code-credentials`. Codex authentication is read from
`${CODEX_HOME:-$HOME/.codex}/auth.json`. The widget requires Bash, `curl`,
`jq`, and (for Claude) macOS `security`; credentials are sent to curl through
standard input and are not placed in its argument list.

Responses are normalized before caching, so provider caches contain only the
provider name plus 5-hour/7-day utilization and Unix reset times. Codex account
and identity fields are never cached. The cache TTL is 120 seconds; stale valid
data remains visible during authentication, network, HTTP, or schema failures.
Requests use an atomic lock and exponential retry backoff. `age` only inspects
the cache and never accesses authentication or the network. Historical Claude
cache and backoff paths, including raw Claude cache data, remain supported.

