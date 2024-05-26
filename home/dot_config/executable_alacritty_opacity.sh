#!/usr/bin/env bash

## Fetch background_opacity from alacritty.toml
opacity=$(awk '$1 == "opacity" {print $NF; exit}' \
    ~/.config/alacritty/alacritty.toml)

## Assign toggle opacity value
case $opacity in
  1)
    toggle_opacity=0.7
    ;;
  *)
    toggle_opacity=1
    ;;
esac

## Replace opacity value in alacritty.toml
sed -i -- "s/opacity = $opacity/opacity = $toggle_opacity/" \
    ~/.config/alacritty/alacritty.toml
