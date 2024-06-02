#!/bin/bash

find $HOME/.config/sketchybar -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256
