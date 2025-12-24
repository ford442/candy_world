#!/bin/bash
# Build script for Candy World Emscripten WASM module (Linux/Mac)
# Tries to source a known emsdk env script if present; otherwise expects emcc in PATH

set -euo pipefail

echo "Building candy_native.wasm (Two-step: Compile -> Link)..."

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

if ! command -v em++ >/dev/null 2>&1; then
    if [ "$sourced" = true ]; then
        echo "em++ still not found after sourcing emsdk. Please ensure emsdk is installed and activated."
    else
        echo "em++ not found. Install emsdk and run 'source <emsdk>/emsdk_env.sh' or add em++ to PATH."
    fi
    exit 1
fi

OUTPUT_WASM="$REPO_ROOT/public/candy_native.wasm"

# ---------------------------------------------------------
# Step 1: Compile .cpp files to .o object files
# ---------------------------------------------------------
echo "Step 1: Compiling C++ sources..."
OBJECT_FILES=""

# Loop through all .cpp files in the script directory
for src_file in "$SCRIPT_DIR"/*.cpp; do
    # Define object file path (e.g., animation.cpp -> animation.o)
    obj_file="${src_file%.cpp}.o"
    
    echo "  Compiling $(basename "$src_file") -> $(basename "$obj_file")"
    
    # Compile (-c) with optimizations (-O3)
    em++ -c "$src_file" -o "$obj_file" -O3 -DSIMD=AVX -msimd128 -mrelaxed-simd -mavx2 -ffast-math \
    -fforce-enable-int128 -fopenmp-simd -mbulk-memory -flto -fno-exceptions -funroll-loops -m64 -mtune=wasm64 -s MEMORY64 --target=wasm64 
    
    # Add to list of objects to link
    OBJECT_FILES="$OBJECT_FILES $obj_file"
done

# ---------------------------------------------------------
# Step 2: Link .o files into final .wasm
# ---------------------------------------------------------
echo "Step 2: Linking object files..."

# We use em++ to link to ensure C++ standard libraries are correctly handled
em++ $OBJECT_FILES -o "$OUTPUT_WASM" \
  -O3 --enable-simd -msimd128 -mrelaxed-simd -msse -msse2 -msse3 -mssse3 -msse4 -msse4.1 -msse4.2 -mavx -mavx2 \
  -s WASM=1 -s WASM_BIGINT=1 -std=c++26 -s MALLOC=emmalloc -s WASMFS=1 -fopenmp-simd -ffast-math -mbulk-memory \
  -s STANDALONE_WASM=1 -s ALLOW_MEMORY_GROWTH=0 -s INITIAL_MEMORY=700mb -s FORCE_FILESYSTEM=1 \
  --no-entry -m64 -s MEMORY64 -s ASSERTIONS=0  -mtune=wasm64 --target=wasm64 -DNDEBUG=1 \
  -s EXPORTED_FUNCTIONS="[ \
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
  ]" \
  -s ERROR_ON_UNDEFINED_SYMBOLS=1

# ---------------------------------------------------------
# Cleanup
# ---------------------------------------------------------
echo "Cleaning up object files..."
rm -f $OBJECT_FILES

if [ $? -eq 0 ]; then
    echo "Build successful! Output: public/candy_native.wasm"
else
    echo "Build failed with error code $?"
    exit 1
fi
