#!/bin/bash

# Define source files
SOURCES="emscripten/physics.cpp emscripten/math.cpp emscripten/batch.cpp emscripten/animation.cpp emscripten/bootstrap_loader.cpp"

# --- DEBUG FLAGS (Use these for troubleshooting) ---
# -g: Generates debug info (symbols)
# -s ASSERTIONS=2: comprehensive runtime checks
# -s SAFE_HEAP=1: checks for memory corruption (optional, slows down)
# -s DEMANGLE_SUPPORT=1: readable C++ function names
# -O1: Low optimization to keep code structure readable (O0 is too slow for physics)

em++ $SOURCES \
  -O1 -g \
  -s ASSERTIONS=2 \
  -s DEMANGLE_SUPPORT=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s "EXPORTED_RUNTIME_METHODS=['ccall','cwrap','getValue','setValue']" \
  -s USE_PTHREADS=1 \
  -s PTHREAD_POOL_SIZE=4 \
  -s WASM=1 \
  -s NO_EXIT_RUNTIME=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="createCandyNative" \
  -o public/candy_native.js

echo "✅ Debug Build Successful (Check console for detailed WASM errors)"
