#!/bin/bash
# Build script for Candy World Emscripten WASM module (Linux/Mac)
# Run this after activating emsdk: source emsdk_env.sh

echo "Building candy_native.wasm (Standalone WASM)..."
source /content/build_space/emsdk/emsdk_env.sh

emcc /content/build_space/candy_world/emscripten/candy_native.c -o /content/build_space/candy_world/public/candy_native.wasm \
    -O3 \
    -s STANDALONE_WASM=1 \
    -s WASM=1 \
    --no-entry \
    -s EXPORTED_FUNCTIONS="['_hash', '_valueNoise2D', '_fbm', '_fastInvSqrt', '_fastDistance', '_batchDistances', '_batchSinWave', '_malloc', '_free']" \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0

if [ $? -eq 0 ]; then
    echo "Build successful! Output: public/candy_native.wasm"
else
    echo "Build failed with error code $?"
    exit 1
fi
