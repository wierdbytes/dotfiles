export SDKROOT ?= $(shell xcrun --sdk macosx --show-sdk-path)

all:
	(cd event_providers && $(MAKE)) >/dev/null
	(cd menus && $(MAKE)) >/dev/null
