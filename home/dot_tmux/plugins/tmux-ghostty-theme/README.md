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

