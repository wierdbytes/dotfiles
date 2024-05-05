#!/bin/bash

case "$(uname -s)" in
Darwin)
    type brew >/dev/null 2>&1 || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    brew install chezmoi
    ;;
Linux)
    echo "not yet supported"
    exit 1
    ;;
*)
    echo "unsupported OS"
    exit 1
    ;;
esac

chezmoi init --apply https://github.com/wierdbytes/dotfiles.git
