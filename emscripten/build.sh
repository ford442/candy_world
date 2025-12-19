#!/bin/bash
# Build script for Candy World Emscripten WASM module (Linux/Mac)
# Tries to source a known emsdk env script if present; otherwise expects emcc in PATH

set -euo pipefail

echo "Building candy_native.wasm (Standalone WASM)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Candidate locations for emsdk env script
CANDIDATES=(
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "/content/build_space/emsdk/emsdk_env.sh"
)

sourced=false
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        echo "Sourcing emsdk env: $f"
        # shellcheck source=/dev/null
        source "$f"
        sourced=true
        break
    fi
done

if ! command -v emcc >/dev/null 2>&1; then
    if [ "$sourced" = true ]; then
        echo "emcc still not found after sourcing emsdk. Please ensure emsdk is installed and activated."
    else
        echo "emcc not found. Install emsdk and run 'source <emsdk>/emsdk_env.sh' or add emcc to PATH."
    fi
    exit 1
fi

INPUT_C="$SCRIPT_DIR/candy_native.c"
OUTPUT_WASM="$REPO_ROOT/public/candy_native.wasm"

emcc "$INPUT_C" -o "$OUTPUT_WASM" \
    -O3 \
    -s STANDALONE_WASM=1 \
    -s WASM=1 \
    --no-entry \
    -s EXPORTED_FUNCTIONS="['_hash', '_valueNoise2D', '_fbm', '_fastInvSqrt', '_fastDistance', '_batchDistances', '_batchSinWave', '_batchDistanceCull_c', '_malloc', '_free', '_init_native']" \
    -s ERROR_ON_UNDEFINED_SYMBOLS=0

if [ $? -eq 0 ]; then
    echo "Build successful! Output: public/candy_native.wasm"
else
    echo "Build failed with error code $?"
    exit 1
fi
