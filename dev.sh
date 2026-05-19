#!/bin/bash
set -e
# Source emsdk environment if available; skip gracefully if not installed
if [ -f "emsdk/emsdk_env.sh" ]; then
    source emsdk/emsdk_env.sh
fi
bash emscripten/build.sh
vite
