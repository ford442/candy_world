#!/bin/bash
set -e  # Exit on error for critical operations

echo "🚀 Starting Post-Build Optimization..."

# 1. Define Paths
PUBLIC_DIR="public"
PHYSICS_WASM="$PUBLIC_DIR/candy_physics.wasm"
NATIVE_WASM="$PUBLIC_DIR/candy_native.wasm"
NATIVE_JS="$PUBLIC_DIR/candy_native.js"
WORKER_JS="$PUBLIC_DIR/candy_native.worker.js"

# 2. Check for Tools (but don't fail if missing)
WASM_OPT_AVAILABLE=false
TERSER_AVAILABLE=false

if command -v wasm-opt &> /dev/null; then
    WASM_OPT_AVAILABLE=true
    echo "✓ wasm-opt found"
else
    echo "⚠️  wasm-opt not found - skipping WASM optimization"
fi

if command -v terser &> /dev/null; then
    TERSER_AVAILABLE=true
    echo "✓ terser found"
else
    echo "⚠️  terser not found - skipping JS minification"
fi

if ! command -v wasmedge &> /dev/null; then
    echo "⚠️  wasmedge not found! Installing via 'curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash && source $HOME/.wasmedge/env'"
	curl -sSf https://raw.githubusercontent.com/WasmEdge/WasmEdge/master/utils/install.sh | bash && source $HOME/.wasmedge/env
fi

if ! command -v wasmedge &> /dev/null; then
    echo "⚠️  wasmedge still not found!"
else
    WASMEDGE_AVAILABLE=true
    echo "✓ wasmedge found"
fi

# 3. Optimize AssemblyScript WASM (Physics) if wasm-opt is available
if [ "$WASM_OPT_AVAILABLE" = true ] && [ -f "$PHYSICS_WASM" ]; then
    echo "🔧 Optimizing Physics WASM..."
    wasm-opt "$PHYSICS_WASM" -o "$PHYSICS_WASM" \
      -O4 \
      --converge \
      --strip-debug \
      --enable-simd \
      --enable-threads \
      --enable-bulk-memory \
      --enable-relaxed-simd \
      --enable-nontrapping-float-to-int \
      --enable-exception-handling || true
else
    echo "⏭️  Skipping WASM optimization (tool or file not available)"
fi

# Try wasmedge optimization if available
if [ "$WASMEDGE_AVAILABLE" = true ] && [ -f "$PHYSICS_WASM" ]; then
    echo "🔧 Optimizing Physics WASM (wasmedge)..."
    wasmedgec --optimize=3 --enable-all "$PHYSICS_WASM" "$PHYSICS_WASM" || true
fi

# 4. Optimize Emscripten WASM (Native Effects) - commented out as files may not exist
#if [ "$WASM_OPT_AVAILABLE" = true ] && [ -f "$NATIVE_WASM" ]; then
#    echo "🔧 Optimizing Native WASM..."
#    wasm-opt "$NATIVE_WASM" -o "$NATIVE_WASM" \
#      -O4 \
#      --converge \
#      --strip-debug \
#      --enable-simd \
#      --enable-threads \
#      --enable-relaxed-simd \
#      --enable-bulk-memory \
#      --enable-nontrapping-float-to-int \
#      --enable-exception-handling
#fi

# 5. Minify Emscripten Loaders (Safety First) - commented out as files may not exist
#if [ "$TERSER_AVAILABLE" = true ] && [ -f "$NATIVE_JS" ]; then
#    echo "📦 Minifying JS Loaders..."
#    terser "$NATIVE_JS" -o "$NATIVE_JS" \
#      --compress defaults=false,dead_code=true,unused=true,loops=true,conditionals=true \
#      --mangle reserved=['Module','FS','GL'] \
#      --comments false
#fi

echo "✅ Optimization Complete!"
exit 0
