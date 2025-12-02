#!/bin/bash

# Ensure the build directory exists
mkdir -p build
mkdir -p dist/build

# Define the source and output
SOURCE="src/physics.cpp"
OUTPUT="build/optimized.wasm"
DIST_OUTPUT="dist/build/optimized.wasm"

# Exported functions (Note: _ prefix is required for C functions)
EXPORTS="['_updateParticles', '_checkCollision', '_initParticles', '_seedRandom', '_malloc', '_free']"

echo "Compiling $SOURCE to $OUTPUT..."

# Run emcc
# Note: We assume emcc is in the PATH or sourced previously.
# If running in the user's specific environment, they might need to source emsdk first.
emcc "$SOURCE" \
  -O3 \
  -flto \
  -msimd128 \
  -s WASM=1 \
  -s STANDALONE_WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s "EXPORTED_FUNCTIONS=$EXPORTS" \
  --no-entry \
  -o "$OUTPUT"

# Check success
if [ $? -eq 0 ]; then
  echo "✅ Build successful: $OUTPUT"

  # Copy to dist if it exists
  if [ -d "dist" ]; then
    cp "$OUTPUT" "$DIST_OUTPUT"
    echo "✅ Copied to: $DIST_OUTPUT"
  fi
else
  echo "❌ Build failed!"
  exit 1
fi
