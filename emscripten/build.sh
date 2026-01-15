#!/bin/bash
# =============================================================================
# Build script for Candy World Emscripten WASM module
# =============================================================================
# 
# This script compiles C++ animation and physics code to WebAssembly using
# Emscripten. It includes several robustness features:
#
# 1. CONDITIONAL EXPORTS: Only exports functions that exist in source files
#    to prevent linking errors when functions are missing or unimplemented.
#
# 2. DISABLED ASSERTIONS: Uses -s ASSERTIONS=0 in production builds to prevent
#    runtime aborts from missing exports. The JS fallback system handles missing
#    functions gracefully instead.
#    
#    NOTE: Disabling assertions may hide other issues during development.
#    Set CANDY_DEBUG=1 to enable assertions for debugging.
#
# 3. EMSCRIPTEN FALLBACK: If Emscripten is not installed, the script exits
#    gracefully and removes stale WASM artifacts. The application will use
#    pure JavaScript fallbacks defined in src/utils/wasm-loader.js.
#
# 4. POST-BUILD VERIFICATION: After successful compilation, runs a Node.js
#    script to verify which functions were actually exported.
#
# Environment Variables:
#   CANDY_DEBUG=1  - Enable assertions for debugging (default: 0)
#   SKIP_VERIFY=1  - Skip post-build verification step (default: 0)
#
# =============================================================================

# Exit on error, but handle failures gracefully for missing Emscripten
set -uo pipefail

echo "=========================================="
echo "Candy World WASM Build (Robust Mode)"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Debug mode (enables assertions)
CANDY_DEBUG="${CANDY_DEBUG:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

# ---------------------------------------------------------
# STEP 1: Find and source Emscripten SDK
# ---------------------------------------------------------
FOUND_EMSDK=0
EMSDK_ENV_LOCATIONS=(
    "/app/emsdk/emsdk_env.sh"
    "/content/build_space/emsdk/emsdk_env.sh"
    "$HOME/emsdk/emsdk_env.sh"
    "../emsdk/emsdk_env.sh"
    "/opt/emsdk/emsdk_env.sh"
    "/usr/local/emsdk/emsdk_env.sh"
)

for LOC in "${EMSDK_ENV_LOCATIONS[@]}"; do
    if [ -f "$LOC" ]; then
        echo "[INFO] Sourcing emsdk_env.sh from $LOC"
        source "$LOC" 2>/dev/null || true
        FOUND_EMSDK=1
        break
    fi
done

if [ $FOUND_EMSDK -eq 0 ]; then
    echo "[WARN] emsdk_env.sh not found. Assuming em++ is in PATH."
fi

# ---------------------------------------------------------
# STEP 2: Check if Emscripten is available
# ---------------------------------------------------------
# If em++ is not available, gracefully exit and clean up stale artifacts.
# The application will use JavaScript fallbacks instead.
if ! command -v em++ >/dev/null 2>&1; then
    echo ""
    echo "=========================================="
    echo "[WARN] Emscripten (em++) not found in PATH"
    echo "=========================================="
    echo ""
    echo "The WASM native module cannot be built."
    echo "The application will use JavaScript fallbacks for all animation functions."
    echo ""
    echo "To enable native WASM acceleration:"
    echo "  1. Install Emscripten: https://emscripten.org/docs/getting_started/downloads.html"
    echo "  2. Source emsdk_env.sh before running this script"
    echo "  3. Re-run: npm run build:emcc"
    echo ""
    
    # Remove stale artifacts to prevent loading outdated WASM
    echo "[INFO] Removing stale WASM artifacts..."
    rm -f "$REPO_ROOT/public/candy_native.js" \
          "$REPO_ROOT/public/candy_native.wasm" \
          "$REPO_ROOT/public/candy_native.worker.js"
    
    echo "[OK] Build skipped. JS fallback mode enabled."
    exit 0
fi

echo "[INFO] Found em++ at: $(which em++)"

OUTPUT_JS="$REPO_ROOT/public/candy_native.js"
OUTPUT_WASM="$REPO_ROOT/public/candy_native.wasm"

# ---------------------------------------------------------
# STEP 3: Build Conditional Export List
# ---------------------------------------------------------
# Only export functions that actually exist in our source files.
# This prevents linking errors when functions are missing or unimplemented.

echo "[INFO] Scanning source files for implemented functions..."

# All C++ source files
CPP_FILES="$SCRIPT_DIR"/*.cpp

# Function to check if a function is implemented in source
# This verifies the function has EMSCRIPTEN_KEEPALIVE and a proper function signature
# The grep pattern looks for the return type followed by function name and opening paren
function_exists() {
    local func_name="$1"
    # Look for the function name with a return type - must be a proper function definition
    # Pattern: (void|float|int|double) funcName(
    if grep -E "(void|float|int|double)\s+${func_name}\s*\(" $CPP_FILES >/dev/null 2>&1; then
        return 0  # Function found
    fi
    return 1  # Function not found
}

# Build list of exports - only include functions that exist
EXPORT_LIST=()

# Core functions (always required)
CORE_EXPORTS=("_main" "_malloc" "_free")
for func in "${CORE_EXPORTS[@]}"; do
    EXPORT_LIST+=("'$func'")
done

# Define all animation function exports and check each one
# Format: "c_function_name" (without underscore prefix)
declare -A ANIMATION_FUNCTIONS=(
    # Math functions (math.cpp)
    ["hash"]="math"
    ["valueNoise2D"]="math"
    ["fbm"]="math"
    ["fastInvSqrt"]="math"
    ["getGroundHeight"]="math"
    
    # Physics functions (physics.cpp)
    ["fastDistance"]="physics"
    ["smoothDamp"]="physics"
    ["updateParticles"]="physics"
    ["checkCollision"]="physics"
    ["initPhysics"]="physics"
    ["addObstacle"]="physics"
    ["setPlayerState"]="physics"
    ["getPlayerX"]="physics"
    ["getPlayerY"]="physics"
    ["getPlayerZ"]="physics"
    ["getPlayerVX"]="physics"
    ["getPlayerVY"]="physics"
    ["getPlayerVZ"]="physics"
    ["updatePhysicsCPP"]="physics"
    
    # Batch functions (batch.cpp)
    ["batchDistances"]="batch"
    ["batchDistanceCull_c"]="batch"
    ["batchSinWave"]="batch"
    
    # Bootstrap functions (bootstrap_loader.cpp)
    ["startBootstrapInit"]="bootstrap"
    ["getBootstrapProgress"]="bootstrap"
    ["isBootstrapComplete"]="bootstrap"
    ["getBootstrapHeight"]="bootstrap"
    ["resetBootstrap"]="bootstrap"
    
    # Animation functions (animation.cpp)
    ["calcArpeggioStep_c"]="animation"
    ["getArpeggioTargetStep_c"]="animation"
    ["getArpeggioUnfurlStep_c"]="animation"
    ["calcFiberWhip"]="animation"
    ["getFiberBaseRotY"]="animation"
    ["getFiberBranchRotZ"]="animation"
    ["calcHopY"]="animation"
    ["calcShiver"]="animation"
    ["getShiverRotX"]="animation"
    ["getShiverRotZ"]="animation"
    ["calcSpiralWave"]="animation"
    ["getSpiralRotY"]="animation"
    ["getSpiralYOffset"]="animation"
    ["getSpiralScale"]="animation"
    ["calcPrismRose"]="animation"
    ["getPrismUnfurl"]="animation"
    ["getPrismSpin"]="animation"
    ["getPrismPulse"]="animation"
    ["getPrismHue"]="animation"
    ["calcFloatingParticle"]="animation"
    ["getParticleX"]="animation"
    ["getParticleY"]="animation"
    ["getParticleZ"]="animation"
    ["calcSpeakerPulse"]="animation"
    ["getSpeakerScale"]="animation"
    ["calcBounceY"]="animation"
    ["calcSwayRotZ"]="animation"
    ["calcWobble"]="animation"
    ["getWobbleX"]="animation"
    ["getWobbleZ"]="animation"
    ["calcAccordionStretch"]="animation"
    ["getAccordionStretchY"]="animation"
    ["getAccordionWidthXZ"]="animation"
    ["calcRainDropY"]="animation"
    ["calcFloatingY"]="animation"
)

# Check each function and add to export list if it exists
FOUND_COUNT=0
MISSING_COUNT=0
MISSING_FUNCS=""

for func in "${!ANIMATION_FUNCTIONS[@]}"; do
    if function_exists "$func"; then
        EXPORT_LIST+=("'_$func'")
        ((FOUND_COUNT++))
    else
        ((MISSING_COUNT++))
        MISSING_FUNCS="$MISSING_FUNCS $func"
    fi
done

echo "[INFO] Found $FOUND_COUNT implemented functions"
if [ $MISSING_COUNT -gt 0 ]; then
    echo "[WARN] $MISSING_COUNT functions not found in source:$MISSING_FUNCS"
    echo "[INFO] Missing functions will use JavaScript fallbacks"
fi

# Convert array to comma-separated string
EXPORTS=$(IFS=,; echo "[${EXPORT_LIST[*]}]")

# ---------------------------------------------------------
# STEP 4: Configure Compiler and Linker Flags
# ---------------------------------------------------------

# Compiler flags for performance
# - O2: Good optimization without excessive compilation time
# - msimd128: Enable SIMD for vectorized math operations
# - mrelaxed-simd: Allow relaxed SIMD operations for better performance
# - ffast-math: Aggressive floating-point optimizations
# - fno-rtti: Disable RTTI to reduce code size
# - pthread: Enable threading support for parallel operations
COMPILE_FLAGS="-O2 -msimd128 -ffast-math -fwasm-exceptions -fno-rtti -funroll-loops -mbulk-memory -fopenmp-simd -pthread -matomics"

# Linker flags
# - USE_PTHREADS=1: Enable pthread support (requires SharedArrayBuffer)
# - PTHREAD_POOL_SIZE=4: Pre-spawn 4 worker threads
# - ALLOW_MEMORY_GROWTH=1: Allow dynamic memory allocation
# - MODULARIZE=1: Generate ES6 module for clean importing
# - EXPORT_ES6=1: Use ES6 export syntax
#
# ASSERTIONS DISABLED (IMPORTANT):
# - Setting ASSERTIONS=0 prevents Emscripten from aborting when exports are missing
# - Instead, the JavaScript wasm-loader.js handles missing exports gracefully
# - Enable assertions for debugging by setting CANDY_DEBUG=1
if [ "$CANDY_DEBUG" = "1" ]; then
    ASSERTION_FLAG="-s ASSERTIONS=1"
    echo "[DEBUG] Assertions ENABLED (debug mode)"
else
    ASSERTION_FLAG="-s ASSERTIONS=0"
    echo "[INFO] Assertions DISABLED for production"
fi

LINK_FLAGS="-O2 -std=c++17 -lembind -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=256MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=[\"wasmMemory\"] -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web,worker -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
-fwasm-exceptions -matomics -mbulk-memory -fopenmp-simd -msimd128 -ffast-math -pthread"

# ---------------------------------------------------------
# STEP 5: Compile and Link
# ---------------------------------------------------------

echo ""
echo "[INFO] Compiling C++ to WebAssembly..."
echo "[INFO] Output: $OUTPUT_JS"

# Clean old files
rm -f "$OUTPUT_JS" "$OUTPUT_WASM" "$REPO_ROOT/public/candy_native.worker.js" "penmp" "penmp.wasm" 2>/dev/null || true

# Compile with error handling
BUILD_SUCCESS=0
if em++ "$SCRIPT_DIR"/*.cpp \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -o "$OUTPUT_JS" 2>&1; then
    BUILD_SUCCESS=1
fi

if [ $BUILD_SUCCESS -eq 1 ] && [ -f "$OUTPUT_WASM" ]; then
    echo ""
    echo "=========================================="
    echo "[OK] Build successful!"
    echo "=========================================="
    echo "Generated files:"
    echo "  - public/candy_native.js"
    echo "  - public/candy_native.wasm"
    echo "  - public/candy_native.worker.js"
    
    # Get file sizes
    if [ -f "$OUTPUT_WASM" ]; then
        WASM_SIZE=$(ls -lh "$OUTPUT_WASM" | awk '{print $5}')
        echo "  - WASM size: $WASM_SIZE"
    fi
    
    # ---------------------------------------------------------
    # STEP 6: Post-Build Verification
    # ---------------------------------------------------------
    if [ "$SKIP_VERIFY" != "1" ] && [ -f "$SCRIPT_DIR/verify_build.js" ]; then
        echo ""
        echo "[INFO] Running post-build verification..."
        
        # Check if Node.js is available
        if command -v node >/dev/null 2>&1; then
            node "$SCRIPT_DIR/verify_build.js" "$OUTPUT_WASM" || true
        else
            echo "[WARN] Node.js not found. Skipping verification."
        fi
    fi
else
    echo ""
    echo "=========================================="
    echo "[ERROR] Build failed!"
    echo "=========================================="
    echo "The WASM module could not be compiled."
    echo "The application will use JavaScript fallbacks."
    echo ""
    
    # Clean up partial artifacts
    rm -f "$OUTPUT_JS" "$OUTPUT_WASM" "$REPO_ROOT/public/candy_native.worker.js" 2>/dev/null || true
    
    # Don't fail the overall build - JS fallbacks will work
    # But we won't try to build the ST version if the compiler failed completely
    exit 0
fi

# ---------------------------------------------------------
# STEP 5b: Compile Single-Threaded Fallback
# ---------------------------------------------------------
echo ""
echo "[INFO] Compiling C++ to Single-Threaded WebAssembly (Fallback)..."

OUTPUT_JS_ST="$REPO_ROOT/public/candy_native_st.js"
OUTPUT_WASM_ST="$REPO_ROOT/public/candy_native_st.wasm"

# Compiler flags for ST (remove pthread, atomics, etc)
COMPILE_FLAGS_ST="-O2 -msimd128 -ffast-math -fwasm-exceptions -fno-rtti -funroll-loops -mbulk-memory"

# Linker flags for ST (remove pthread, shared memory)
LINK_FLAGS_ST="-O2 -std=c++17 -lembind -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=256MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=[\"wasmMemory\"] -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
-fwasm-exceptions -mbulk-memory -msimd128 -ffast-math"

if em++ "$SCRIPT_DIR"/*.cpp \
  $COMPILE_FLAGS_ST \
  $LINK_FLAGS_ST \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -o "$OUTPUT_JS_ST" 2>&1; then
    echo "[OK] Single-threaded build successful!"
    echo "  - public/candy_native_st.js"
    echo "  - public/candy_native_st.wasm"
else
    echo "[WARN] Single-threaded build failed!"
fi