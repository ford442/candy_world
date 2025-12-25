#!/bin/bash
# Build script for Candy World Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD

set -euo pipefail

echo "Building candy_native.js (Pthread Enabled)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source Emscripten (Update paths as needed)
CANDIDATES=(
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
    "/content/build_space/emsdk/emsdk_env.sh"
)

sourced=false
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        source "$f"
        sourced=true
        break
    fi
done

if ! command -v em++ >/dev/null 2>&1; then
    echo "em++ not found. Please activate emsdk."
    exit 1
fi

OUTPUT_JS="$REPO_ROOT/public/candy_native.js"

# ---------------------------------------------------------
# COMPILER FLAGS
# ---------------------------------------------------------
# -fopenmp: Enables OpenMP threading pragmas in C++
# -pthread: Tells compiler to use thread-safe libraries
# -O3: Max speed
# -g1: Preserve function names in imports (prevents minification to "a", "b") - CRITICAL for stability
# -msimd128: SIMD support
# -mrelaxed-simd: Relaxed SIMD
# -ffast-math: Fast math
# -flto: Link Time Optimization (Full)
# -fno-exceptions: Removes exception handling overhead
# -mbulk-memory: Fast memory copying
# -fopenmp: Enables OpenMP threading pragmas
# -pthread: Tells compiler to use thread-safe libraries
COMPILE_FLAGS="-O3 -g1 -msimd128 -mrelaxed-simd -ffast-math -flto -fno-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp -pthread"

# ---------------------------------------------------------
# LINKER FLAGS
# ---------------------------------------------------------
# -s USE_PTHREADS=1: Enable threading support
# -s PTHREAD_POOL_SIZE=4: Pre-spawn 4 workers (prevents runtime lag)
# -s MODULARIZE=1: Wrap output in a function (createCandyNative)
# -s EXPORT_ES6=1: Use ES6 'export' for easier importing
# -s ENVIRONMENT='web,worker': Build for browser and workers
# -s ALLOW_MEMORY_GROWTH=1: Required for Pthreads usually, or flexibility
# -s INITIAL_MEMORY=256mb: Starting memory
LINK_FLAGS="-s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=1 -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=256mb -s ASSERTIONS=0 -s EXPORT_ES6=1 -s MODULARIZE=1 -s EXPORT_NAME='createCandyNative' -s ENVIRONMENT=web,worker -flto -g1"

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
    '_malloc', \
    '_free', \
    '_calcArpeggioStep_c', \
    '_getArpeggioTargetStep_c', \
    '_getArpeggioUnfurlStep_c' \
]"

echo "Compiling & Linking..."

# Compile and Link in one go (simpler for this setup)
# Note: We use wildcards for all cpp files in the directory
em++ "$SCRIPT_DIR"/*.cpp -o "$OUTPUT_JS" \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

if [ $? -eq 0 ]; then
    echo "Build successful!"
    echo "Generated: public/candy_native.js (+ .wasm and .worker.js)"
else
    echo "Build failed."
    exit 1
fi
