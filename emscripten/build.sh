#!/bin/bash
# Build script for Candy World Emscripten WASM module
# Optimized for: Multithreading (Pthreads) + SIMD + Reliability

set -euo pipefail

echo "Building candy_native.js (Safe Pthread Build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source Emscripten
CANDIDATES=(
    "/app/emsdk/emsdk_env.sh"
    "/content/build_space/emsdk/emsdk_env.sh"
    "$REPO_ROOT/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)

EMSDK_FOUND=0
for f in "${CANDIDATES[@]}"; do
    if [ -f "$f" ]; then
        echo "Sourcing EMSDK from: $f"
        source "$f"
        EMSDK_FOUND=1
        break
    fi
done

if [ $EMSDK_FOUND -eq 0 ]; then
    echo "Warning: emsdk_env.sh not found in any standard location."
    echo "Skipping Emscripten build. JavaScript fallbacks will be used."
    exit 0
fi

OUTPUT_JS="$REPO_ROOT/public/candy_native.js"

# ---------------------------------------------------------
# COMPILER FLAGS
# ---------------------------------------------------------
# FIX: Use -fopenmp-simd (SIMD only, no threading runtime required)
# FIX: Removed -flto to prevent symbol stripping issues
COMPILE_FLAGS="-O2 -msimd128 -mrelaxed-simd -ffast-math -fno-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp-simd -pthread"

# ---------------------------------------------------------
# LINKER FLAGS
# ---------------------------------------------------------
# FIX: Use -fopenmp-simd
# FIX: Keep -pthread for SharedArrayBuffer (Audio support)
# FIX: Removed -s WASM_WORKERS=1 (Incompatible with this mode)
# FIX: Removed LTO to ensure exports persist
LINK_FLAGS="-O2 -std=c++17 -lembind -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=64MB -s ASSERTIONS=1 -s EXPORT_ES6=1 -s EXPORTED_RUNTIME_METHODS=[\"wasmMemory\"] \
-s MODULARIZE=1 -s EXPORT_NAME=createCandyNative -s ENVIRONMENT=web,worker \
-fwasm-exceptions -matomics -mbulk-memory -fopenmp-simd -pthread"

# FIX: Flatted EXPORTS string to ensure no functions are lost due to shell formatting
EXPORTS="['_hash','_valueNoise2D','_fbm','_fastInvSqrt','_fastDistance','_smoothDamp','_updateParticles','_checkCollision','_batchDistances','_batchDistanceCull_c','_batchSinWave','_initPhysics','_addObstacle','_setPlayerState','_getPlayerX','_getPlayerY','_getPlayerZ','_getPlayerVX','_getPlayerVY','_getPlayerVZ','_updatePhysicsCPP','_startBootstrapInit','_getBootstrapProgress','_isBootstrapComplete','_getBootstrapHeight','_resetBootstrap','_malloc','_free','_main','_calcArpeggioStep_c','_getArpeggioTargetStep_c','_getArpeggioUnfurlStep_c','_calcSpeakerPulse','_getSpeakerYOffset','_getSpeakerScaleX','_getSpeakerScaleY','_getSpeakerScaleZ','_calcAccordionStretch','_getAccordionStretchY','_getAccordionWidthXZ','_calcFiberWhip','_getFiberBaseRotY','_getFiberBranchRotZ','_calcHopY','_calcShiver','_getShiverRotX','_getShiverRotZ','_calcSpiralWave','_getSpiralRotY','_getSpiralYOffset','_getSpiralScale','_calcPrismRose','_getPrismUnfurl','_getPrismSpin','_getPrismPulse','_getPrismHue','_calcFloatingParticle','_getParticleX','_getParticleY','_getParticleZ']"

echo "Compiling & Linking..."

# Clean old files
rm -f "$OUTPUT_JS" "$REPO_ROOT/public/candy_native.wasm" "$REPO_ROOT/public/candy_native.worker.js" "penmp" "penmp.wasm"

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
