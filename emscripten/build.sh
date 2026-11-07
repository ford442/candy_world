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
#    With em++ present, a failed MT or ST compile removes both artifacts and
#    exits 1, so `npm run build` cannot ship a missing or stale module green.
#
# 4. POST-BUILD VERIFICATION: After successful compilation, runs a Node.js
#    script to verify which functions were actually exported.
#
# Environment Variables:
#   CANDY_DEBUG=1        - Enable assertions for debugging (default: 0)
#   SKIP_VERIFY=1        - Skip post-build verification step (default: 0)
#   CANDY_STRICT_EMSDK=1 - Fail if em++ differs from .emsdk-version (default: 0, warn)
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
# set -u: every env knob needs a default, or reading it aborts the script.
CANDY_STRICT_EMSDK="${CANDY_STRICT_EMSDK:-0}"

# Build summary variables
BUILD_START_TIME=$(date +%s)
COMPILED_FILES=""
EXPORT_COUNT=0
BUILD_SIZE=""

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
          "$REPO_ROOT/public/candy_native.wasm"
    
    echo "[OK] Build skipped. JS fallback mode enabled."
    exit 0
fi

echo "[INFO] Found em++ at: $(which em++)"

# The emsdk version is pinned in .emsdk-version (CI and release builds install
# exactly that). A different local version builds, but is not what ships;
# CANDY_STRICT_EMSDK=1 turns the warning into a failure.
PINNED_EMSDK="$(tr -d '[:space:]' < "$REPO_ROOT/.emsdk-version" 2>/dev/null)"
ACTUAL_EMSDK="$(em++ --version 2>/dev/null | head -n1 | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
if [ -n "$PINNED_EMSDK" ] && [ "$PINNED_EMSDK" != "$ACTUAL_EMSDK" ]; then
    echo "[WARN] em++ is $ACTUAL_EMSDK but .emsdk-version pins $PINNED_EMSDK"
    echo "       Install the pinned SDK: ./emsdk install $PINNED_EMSDK && ./emsdk activate $PINNED_EMSDK"
    if [ "$CANDY_STRICT_EMSDK" = "1" ]; then
        echo "[ERROR] CANDY_STRICT_EMSDK=1: refusing to build with an unpinned emsdk"
        exit 1
    fi
fi

OUTPUT_JS="$REPO_ROOT/public/candy_native.js"
OUTPUT_WASM="$REPO_ROOT/public/candy_native.wasm"

# ---------------------------------------------------------
# STEP 3: Build Conditional Export List
# ---------------------------------------------------------
# Only export functions that actually exist in our source files.
# This prevents linking errors when functions are missing or unimplemented.

echo "[INFO] Scanning source files for implemented functions..."

# All C++ source files (used for function scanning)
CPP_FILES="$SCRIPT_DIR"/*.cpp

# Compilation units: every emscripten/*.cpp (none #includes another).
COMPILE_UNITS=("$SCRIPT_DIR"/*.cpp)

# Function to check if a function is implemented in source
# This verifies the function has EMSCRIPTEN_KEEPALIVE and a proper function signature
# The grep pattern looks for the return type followed by function name and opening paren
function_exists() {
    local func_name="$1"
    # Look for the function name with a return type - must be a proper function definition
    # Pattern: (void|float|int|double) funcName(
    if grep -E "(void|float|int|double|char|long|unsigned|bool|uint32_t|int32_t|size_t|uintptr_t)\s*\*?\s*${func_name}\s*\(" $CPP_FILES >/dev/null 2>&1; then
        return 0  # Function found
    fi
    # Also check for EMSCRIPTEN_KEEPALIVE on previous line (multiline pattern)
    # Use -A1 to get line after EMSCRIPTEN_KEEPALIVE and check if it contains our function
    if grep -A1 "EMSCRIPTEN_KEEPALIVE" $CPP_FILES 2>/dev/null | grep -E "(void|float|int|double|char|long|unsigned|bool|uint32_t|int32_t|size_t|uintptr_t)\s*\*?\s*${func_name}\s*\(" >/dev/null 2>&1; then
        return 0  # Function found after EMSCRIPTEN_KEEPALIVE
    fi
    return 1  # Function not found
}

# Build list of exports - only include functions that exist
EXPORT_LIST=()

# Core functions (always required)
CORE_EXPORTS=("main" "malloc" "free")
for func in "${CORE_EXPORTS[@]}"; do
    EXPORT_LIST+=("_$func")
done

# Define all animation function exports and check each one
# Format: "c_function_name" (without underscore prefix)
# This is the whole C++ ABI: every name here has a caller in src/ or tests/
# (scripts/check-native-exports.mjs), and every EMSCRIPTEN_KEEPALIVE function
# in emscripten/*.cpp must be listed (EXPORT_KEEPALIVE=1 exports it either way;
# verify:emcc:manifest enforces both). #2026 deleted the 93 exports nothing
# called: the animation.cpp scalars, mesh_deformation.cpp, the percussion /
# melodic / effects / *_simd batches, the noise and fast-math twins, and the
# legacy physics particles.
declare -A ANIMATION_FUNCTIONS=(
    # Math (math.cpp): getGroundHeight is the parity reference (tests/parity.mjs)
    ["getGroundHeight"]="math"
    ["batchGroundHeight_simd"]="math"

    # Unified ground height (ground.cpp)
    ["clearGroundPlatforms"]="ground"
    ["addGroundPlatform"]="ground"
    ["invalidateGroundCache"]="ground"
    ["setGroundCacheTTL"]="ground"
    ["getUnifiedGroundHeight"]="ground"
    ["batchUnifiedGroundHeight"]="ground"

    # Foliage interaction (foliage_interact.cpp)
    ["batchGeyserLaunch_c"]="foliage_interact"
    ["batchPadForces_c"]="foliage_interact"
    ["batchVineInteraction_c"]="foliage_interact"
    ["calcVineDetachImpulse_c"]="foliage_interact"

    # Player physics assist ABI (physics.cpp, tests/character-controller-native)
    ["initPhysics"]="physics"
    ["addCollisionObject"]="physics"
    ["setPlayerState"]="physics"
    ["getPlayerX"]="physics"
    ["getPlayerY"]="physics"
    ["getPlayerZ"]="physics"
    ["getPlayerVX"]="physics"
    ["getPlayerVY"]="physics"
    ["getPlayerVZ"]="physics"
    ["updatePhysicsCPP"]="physics"

    # Distance culling (batch.cpp)
    ["batchDistanceCull_c"]="batch"

    # LOD factors and matrix composition (lod_batch.cpp)
    ["batchUpdateLodFactors_c"]="lod_batch"
    ["batchComposeMatrices_c"]="lod_batch"

    # #1358: instanced batcher pose -> matrix/color (batcher_instance.cpp)
    ["batchWriteInstancePose_c"]="batcher_instance"

    # Foliage batch animations for the ECS bridge (animation_batch.cpp)
    ["batchShiver_c"]="animation_batch"
    ["batchSpring_c"]="animation_batch"
    ["batchFloat_c"]="animation_batch"
    ["batchCloudBob_c"]="animation_batch"

    # Arpeggio state machine (animation.cpp)
    ["calcArpeggioStep_c"]="animation"
    ["getArpeggioTargetStep_c"]="animation"
    ["getArpeggioUnfurlStep_c"]="animation"

    # Fluid (fluid.cpp)
    ["fluidInit"]="fluid"
    ["fluidStep"]="fluid"
    ["fluidAddDensity"]="fluid"
    ["fluidAddVelocity"]="fluid"
    ["fluidGetDensityPtr"]="fluid"

    # CPU particle fallback (particle_physics.cpp)
    ["updateCpuParticlesWASM"]="particle_physics"

    # Discovery spatial grid (discovery.cpp)
    ["initDiscoveryGrid"]="discovery"
    ["registerDiscoverable"]="discovery"
    ["queryDiscoveries"]="discovery"
    ["clearDiscoveryGrid"]="discovery"

    # Boids (boids.cpp)
    ["updateBoids_c"]="boids"

    # ECS slabs (ecs.cpp, src/systems/ecs/world.ts)
    ["ecsInit"]="ecs"
    ["ecsCreateEntity"]="ecs"
    ["ecsDestroyEntity"]="ecs"
    ["ecsIsAlive"]="ecs"
    ["ecsRegisterComponent"]="ecs"
    ["ecsGetComponent"]="ecs"
    ["ecsSetComponent"]="ecs"
    ["ecsAddComponent"]="ecs"
    ["ecsRemoveComponent"]="ecs"
    ["ecsHasComponent"]="ecs"
    ["ecsQueryComponents"]="ecs"
    ["ecsQueryComponentPointers"]="ecs"
    ["ecsGetComponentStride"]="ecs"
)

# Check each function and add to export list if it exists
FOUND_COUNT=0
MISSING_COUNT=0
MISSING_FUNCS=""

for func in "${!ANIMATION_FUNCTIONS[@]}"; do
    if function_exists "$func"; then
        EXPORT_LIST+=("_$func")
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

# =============================================================================
# ROBUST EXPORT LIST (fixes optimizer DCE + shell quoting trap)
# =============================================================================
echo "[INFO] Building export list (${#EXPORT_LIST[@]} functions)..."

# Generate a clean JSON file (Emscripten's recommended way for large/complex lists)
EXPORTS_FILE="$SCRIPT_DIR/exports.txt"
rm -f "$EXPORTS_FILE"
for func in "${EXPORT_LIST[@]}"; do
    echo "$func" >> "$EXPORTS_FILE"
done
LC_ALL=C sort -u -o "$EXPORTS_FILE" "$EXPORTS_FILE"
echo "[INFO] Generated $EXPORTS_FILE with $(wc -l < "$EXPORTS_FILE") functions"

# ---------------------------------------------------------
# STEP 4: Configure Compiler and Linker Flags
# ---------------------------------------------------------

# Compiler flags for performance
# - O2: Optimize for speed. This is the pinned level for BOTH the compile and
#   link steps of the MT and ST artifacts. AGENTS.md documents the same level;
#   change them together, and only after a measured -O3 pass keeps
#   exports.txt + `npm run verify:emcc:manifest` green.
# - msimd128: Enable SIMD for vectorized math operations. No -mrelaxed-simd:
#   no source uses a relaxed intrinsic, and the ST build is the fallback for
#   browsers without cross-origin isolation (Safari), where it only adds risk
# - fno-rtti: Disable RTTI to reduce code size
# - pthread: Enable threading support for parallel operations
# - fopenmp: Enable OpenMP for parallel batch operations
# - flto: Link-time optimization across the translation units
# - fno-exceptions: No C++ exceptions anywhere in emscripten/*.cpp
# - CANDY_PTHREAD_POOL_SIZE: math.cpp caps the OpenMP team at the pool size,
#   so `#pragma omp parallel` never waits on workers the pool never spawned
#
# NOTE: -ffast-math is intentionally NOT used. math.cpp's getGroundHeight()
# NaN guard (std::isnan) depends on IEEE-compliant float semantics;
# -ffast-math implies -ffinite-math-only, which licenses the compiler to fold
# isnan() to a constant `false`. tests/parity.mjs also asserts TS/AS/C++
# numeric agreement to |Δ| <= 1e-5, which -ffast-math's reassociation can
# violate in a compiler-version-dependent way.
PTHREAD_POOL_SIZE=4
COMPILE_FLAGS="-O2 -flto -fno-exceptions -msimd128 -fno-rtti -funroll-loops -fopenmp -pthread -matomics -DCANDY_PTHREAD_POOL_SIZE=$PTHREAD_POOL_SIZE -I."

# Runtime methods JS needs on Module. HEAP8/HEAPU8/HEAP32/HEAPF32 must be listed
# or Module.HEAPF32 is undefined (and every `em.HEAPF32.set(...)` throws);
# Emscripten refreshes these views itself after memory growth.
RUNTIME_METHODS='["ccall","cwrap","wasmMemory","HEAP8","HEAPU8","HEAP32","HEAPF32"]'

# Linker flags
# - pthread: Enable pthread support (requires SharedArrayBuffer); replaces the
#   deprecated -s USE_PTHREADS=1. emsdk >= 3.1.58 emits no .worker.js file.
# - PTHREAD_POOL_SIZE: Pre-spawn worker threads (also the OpenMP team size)
# - STACK_SIZE: replaces the deprecated TOTAL_STACK. 1MB: every large buffer in
#   emscripten/*.cpp is static data or heap (std::vector) and nothing recurses.
#   16MB took a quarter of the 64MB initial heap, and pthreads created with
#   default attributes inherit it (DEFAULT_PTHREAD_STACK_SIZE follows STACK_SIZE).
# - no WASM_BIGINT=0: no export takes or returns i64, and BigInt is the default
# - no -lembind: nothing uses EMSCRIPTEN_BINDINGS
# - ALLOW_MEMORY_GROWTH=1: Allow dynamic memory allocation
# - MODULARIZE=1: Generate ES6 module for clean importing
# - EXPORT_ES6=1: Use ES6 export syntax
#
# WASM IMPORT/EXPORT NAME MINIFICATION (do NOT add a flag for it):
# - MINIFY_WASM_IMPORTS_AND_EXPORTS / MINIFY_WASM_EXPORT_NAMES are *internal*
#   Emscripten settings (src/settings_internal.js). Passing either with -s makes
#   emcc exit with "is an internal setting and cannot be set from command line"
#   (verified against emsdk 4.0.10, pinned in .emsdk-version).
# - At -O2 with ASSERTIONS=0, emcc minifies wasm import/export names and the
#   generated candy_native*.js glue maps them back, so Module._<name> keeps the
#   C name. wasm-loader-core.ts / wasm-orchestrator.ts only go through the glue,
#   never raw instance.exports, so this is safe. CANDY_DEBUG=1 (ASSERTIONS=1)
#   turns minification off as a side effect.
# - scripts/check-emcc-manifest.mjs fails if either setting reappears here.
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

LINK_FLAGS="-O2 -flto -std=c++17 -s PTHREAD_POOL_SIZE=$PTHREAD_POOL_SIZE -s WASM=1 \
-s ALLOW_MEMORY_GROWTH=1 -s EXPORT_KEEPALIVE=1 -s STACK_SIZE=1MB -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=512MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=$RUNTIME_METHODS -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web,worker -s SHARED_MEMORY=1 \
-matomics -fopenmp -msimd128 -pthread -L$SCRIPT_DIR/vendor -lomp"

# ---------------------------------------------------------
# STEP 5: Compile and Link
# ---------------------------------------------------------

echo ""
echo "[INFO] Compiling C++ to WebAssembly..."
echo "[INFO] Output: $OUTPUT_JS"

OUTPUT_JS_ST="$REPO_ROOT/public/candy_native_st.js"
OUTPUT_WASM_ST="$REPO_ROOT/public/candy_native_st.wasm"

# Clean old files (both tiers: a stale ST must not outlive a failed build)
rm -f "$OUTPUT_JS" "$OUTPUT_WASM" "$OUTPUT_JS_ST" "$OUTPUT_WASM_ST" "penmp" "penmp.wasm" 2>/dev/null || true

# Compile with error handling
BUILD_SUCCESS=0
# noglob: EXPORTED_RUNTIME_METHODS=[...] above looks like a glob character
# class to bash when expanded unquoted below; disable pathname expansion for
# this invocation so a coincidentally-matching filename can't rewrite it.
set -f
if em++ "${COMPILE_UNITS[@]}" \
  $COMPILE_FLAGS \
  $LINK_FLAGS \
  -s EXPORTED_FUNCTIONS=@"$EXPORTS_FILE" -s EXPORT_KEEPALIVE=1 --closure 0  \
  -o "$OUTPUT_JS" 2>&1; then
    BUILD_SUCCESS=1
fi
set +f

if [ $BUILD_SUCCESS -eq 1 ] && [ -f "$OUTPUT_WASM" ]; then
    echo ""
    echo "=========================================="
    echo "[OK] Build successful!"
    echo "=========================================="
    echo "Generated files:"
    echo "  - public/candy_native.js"
    echo "  - public/candy_native.wasm"
    
    # Get file sizes
    if [ -f "$OUTPUT_WASM" ]; then
        WASM_SIZE=$(ls -lh "$OUTPUT_WASM" | awk '{print $5}')
        echo "  - WASM size: $WASM_SIZE"
    fi
    
    # Store export count for summary
    EXPORT_COUNT=$FOUND_COUNT
    
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
    
    # Verify exports exist using node if available
    if command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/verify_build.js" ]; then
        echo ""
        echo "[INFO] Verifying build exports..."
        node "$SCRIPT_DIR/verify_build.js" || true
    fi
else
    echo ""
    echo "=========================================="
    echo "[ERROR] Build failed!"
    echo "=========================================="
    echo "The WASM module could not be compiled (see the em++ output above)."
    echo ""

    # Clean up partial artifacts. em++ is installed, so this is a real
    # compile/link error: fail, rather than let a release ship JS-only.
    rm -f "$OUTPUT_JS" "$OUTPUT_WASM" 2>/dev/null || true
    exit 1
fi

# ---------------------------------------------------------
# STEP 5b: Compile Single-Threaded Fallback
# ---------------------------------------------------------
echo ""
echo "[INFO] Compiling C++ to Single-Threaded WebAssembly (Fallback)..."

# Compiler flags for ST (remove pthread, atomics, etc)
# NOTE: -ffast-math intentionally omitted; see COMPILE_FLAGS comment above.
COMPILE_FLAGS_ST="-O2 -flto -fno-exceptions -msimd128 -fno-rtti -funroll-loops"

# Linker flags for ST (remove pthread, shared memory)
LINK_FLAGS_ST="-O2 -flto -std=c++17 -s WASM=1 \
-s ALLOW_MEMORY_GROWTH=1 -s EXPORT_KEEPALIVE=1 -s STACK_SIZE=1MB -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=256MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=$RUNTIME_METHODS -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web \
-msimd128"

# noglob: EXPORTED_RUNTIME_METHODS=[...] above looks like a glob character
# class to bash when expanded unquoted below; disable pathname expansion for
# this invocation so a coincidentally-matching filename can't rewrite it.
ST_SUCCESS=0
set -f
if em++ "${COMPILE_UNITS[@]}" \
  $COMPILE_FLAGS_ST \
  $LINK_FLAGS_ST \
  -s EXPORTED_FUNCTIONS=@"$EXPORTS_FILE" -s EXPORT_KEEPALIVE=1 --closure 0  \
  -o "$OUTPUT_JS_ST" 2>&1; then
    ST_SUCCESS=1
fi
set +f

if [ $ST_SUCCESS -eq 1 ] && [ -f "$OUTPUT_WASM_ST" ]; then
    echo "[OK] Single-threaded build successful!"
    echo "  - public/candy_native_st.js"
    echo "  - public/candy_native_st.wasm"
else
    # Without cross-origin isolation (production today) the ST build is the
    # only native tier that can load, so a missing one is a release blocker.
    echo "[ERROR] Single-threaded build failed!"
    rm -f "$OUTPUT_JS_ST" "$OUTPUT_WASM_ST" 2>/dev/null || true
    exit 1
fi

# ---------------------------------------------------------
# Build Summary
# ---------------------------------------------------------
BUILD_END_TIME=$(date +%s)
BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))

echo ""
echo "=========================================="
echo "Build Summary"
echo "=========================================="
echo "Files compiled:"
for f in "${COMPILE_UNITS[@]}"; do
    echo "  - $(basename "$f")"
done
echo ""
echo "Export count: $EXPORT_COUNT functions"
echo "Build duration: ${BUILD_DURATION}s"
if [ -f "$OUTPUT_WASM" ]; then
    WASM_SIZE_BYTES=$(stat -c%s "$OUTPUT_WASM" 2>/dev/null || stat -f%z "$OUTPUT_WASM" 2>/dev/null || echo "0")
    WASM_SIZE_HUMAN=$(ls -lh "$OUTPUT_WASM" | awk '{print $5}')
    echo "WASM size: $WASM_SIZE_HUMAN ($WASM_SIZE_BYTES bytes)"
fi
echo "=========================================="
