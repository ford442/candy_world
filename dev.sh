#!/bin/bash
set -e
source emsdk/emsdk_env.sh
bash emscripten/build.sh
vite
