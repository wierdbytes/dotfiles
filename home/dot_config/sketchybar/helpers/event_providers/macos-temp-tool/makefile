CC=clang

FRAMEWORKS:= -framework Foundation -framework IOKit
LIBRARIES:= -lobjc

SOURCE=temp_sensor.m

CFLAGS=-Wall -v $(SOURCE)
LDFLAGS=$(LIBRARIES) $(FRAMEWORKS)
OUT=-o macos-temp-tool

build:
	$(CC) $(CFLAGS) $(LDFLAGS) $(OUT)

all: build
