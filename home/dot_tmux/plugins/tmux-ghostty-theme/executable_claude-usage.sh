#!/bin/bash

exec "${0%/*}/usage.sh" claude "${1:-all}"
