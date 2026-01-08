#!/bin/bash
# Build script for Candy World Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD + Reliability

set -euo pipefail

echo "Building candy_native.js (Safe Pthread Build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source Emscripten
CANDIDATES=(
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then source "$f"; break; fi
done
source /content/build_space/emsdk/emsdk_env.sh
OUTPUT_JS="$REPO_ROOT/public/candy_native.js"

# ---------------------------------------------------------
# COMPILER FLAGS
# ---------------------------------------------------------
# FIX: Use -fopenmp to ENABLE threading (ignoring it makes the build pass but kills performance)
COMPILE_FLAGS="-O2 -msimd128 -mrelaxed-simd -ffast-math -flto -flto=thin -fno-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp -pthread"

# ---------------------------------------------------------
# LINKER FLAGS
# ---------------------------------------------------------
# FIX: Removed -s WASM_WORKERS=1 (Incompatible with OpenMP)
# FIX: Added -pthread to LINK_FLAGS (Critical for OpenMP linking & Shared Memory)
# FIX: Reduced INITIAL_MEMORY to 64MB
LINK_FLAGS="-O2 -std=c++17 -lembind -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=64MB -s ASSERTIONS=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS=[\"wasmMemory\"] \
-s MODULARIZE=1 -s EXPORT_NAME=createCandyNative -s ENVIRONMENT=web,worker \
-flto -flto=thin -fwasm-exceptions -matomics -mbulk-memory -fopenmp -pthread"

EXPORTS="[ \
    '_hash', \
    '_valueNoise2D', \
    '_fbm', \
    '_fastInvSqrt', \
    '_fastDistance', \
    '_smoothDamp', \
    '_updateParticles', \
    '_checkCollision', \
    '_batchDistances', \
    '_batchDistanceCull_c', \
    '_batchSinWave', \
    '_calcArpeggioStep_c', \
    '_getArpeggioTargetStep_c', \
    '_getArpeggioUnfurlStep_c', \
    '_initPhysics', \
    '_addObstacle', \
    '_setPlayerState', \
    '_getPlayerX', \
    '_getPlayerY', \
    '_getPlayerZ', \
    '_getPlayerVX', \
    '_getPlayerVY', \
    '_getPlayerVZ', \
    '_updatePhysicsCPP', \
    '_startBootstrapInit', \
    '_getBootstrapProgress', \
    '_isBootstrapComplete', \
    '_getBootstrapHeight', \
    '_resetBootstrap', \
    '_malloc', \
    '_free', \
    '_main' \
]"

echo "Compiling & Linking..."

# Clean old files to prevent caching/naming conflicts
rm -f "$OUTPUT_JS" "$REPO_ROOT/public/candy_native.wasm" "$REPO_ROOT/public/candy_native.worker.js" "penmp" "penmp.wasm"

# Output flag (-o) at the end prevents flag ambiguity
em++ "$SCRIPT_DIR"/*.cpp \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -o "$OUTPUT_JS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/candy_native.js and .wasm.worker.js"
else
    echo "Build failed."
    exit 1
fi
