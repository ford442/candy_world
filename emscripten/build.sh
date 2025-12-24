#!/bin/bash
# Build script for Candy World Emscripten WASM module
# Optimized for: Standalone WASM32 + SIMD + No Bloat

set -euo pipefail

echo "Building candy_native.wasm (Optimized Clean Build)..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source Emscripten
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

OUTPUT_WASM="$REPO_ROOT/public/candy_native.wasm"

# ---------------------------------------------------------
# COMPILER FLAGS (Step 1)
# ---------------------------------------------------------
# -O3: Max speed
# -msimd128: The ONLY flag needed for WASM SIMD
# -mrelaxed-simd: Allows faster, less precise SIMD instructions
# -ffast-math: Trades tiny precision for speed
# -flto=thin: Faster Link Time Optimization
# -fno-exceptions: Removes exception handling overhead (adds speed/reduces size)
# -mbulk-memory: Fast memory copying
COMPILE_FLAGS="-O3 -msimd128 -mrelaxed-simd -ffast-math -flto=thin -fno-exceptions -funroll-loops -mbulk-memory -fopenmp-simd"

# ---------------------------------------------------------
# LINKER FLAGS (Step 2)
# ---------------------------------------------------------
# -s STANDALONE_WASM=1: Crucial for loading without glue JS
# -s MALLOC=emmalloc: Tiny memory allocator
# -s INITIAL_MEMORY=512mb: Safe size (2GB is risky on mobile/some browsers)
# -s ASSERTIONS=0: Removes debug checks for max speed
LINK_FLAGS="-s STANDALONE_WASM=1 -s WASM=1 -s WASM_BIGINT=1 -s MALLOC=emmalloc -s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=512mb -s ASSERTIONS=0 --no-entry -flto=thin -s ERROR_ON_UNDEFINED_SYMBOLS=1"

# Exported C functions
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

# ---------------------------------------------------------
# Step 1: Compile .cpp -> .o
# ---------------------------------------------------------
echo "Step 1: Compiling C++ sources..."
OBJECT_FILES=""

for src_file in "$SCRIPT_DIR"/*.cpp; do
    obj_file="${src_file%.cpp}.o"
    echo "  Compiling $(basename "$src_file")"
    
    # Always clean old objects to ensure flags update
    rm -f "$obj_file"
    
    em++ -c "$src_file" -o "$obj_file" $COMPILE_FLAGS
    
    OBJECT_FILES="$OBJECT_FILES $obj_file"
done

# ---------------------------------------------------------
# Step 2: Link .o -> .wasm
# ---------------------------------------------------------
echo "Step 2: Linking..."

em++ $OBJECT_FILES -o "$OUTPUT_WASM" \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS"

# ---------------------------------------------------------
# Cleanup
# ---------------------------------------------------------
echo "Cleaning up object files..."
rm -f $OBJECT_FILES

if [ $? -eq 0 ]; then
    echo "Build successful! Output: public/candy_native.wasm"
else
    echo "Build failed."
    exit 1
fi
