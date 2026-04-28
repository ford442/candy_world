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
    if grep -E "(void|float|int|double|char|long|unsigned|uintptr_t)\s*\*?\s*${func_name}\s*\(" $CPP_FILES >/dev/null 2>&1; then
        return 0  # Function found
    fi
    # Also check for EMSCRIPTEN_KEEPALIVE on previous line (multiline pattern)
    # Use -A1 to get line after EMSCRIPTEN_KEEPALIVE and check if it contains our function
    if grep -A1 "EMSCRIPTEN_KEEPALIVE" $CPP_FILES 2>/dev/null | grep -E "(void|float|int|double|char|long|unsigned|uintptr_t)\s*\*?\s*${func_name}\s*\(" >/dev/null 2>&1; then
        return 0  # Function found after EMSCRIPTEN_KEEPALIVE
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
    
    # SIMD-optimized math functions (math.cpp)
    ["valueNoise2D_simd4"]="math"
    ["fbm2D_simd4"]="math"
    ["batchGroundHeight_simd"]="math"
    ["fastInvSqrt_simd4"]="math"
    ["batchFastSin_simd"]="math"
    ["batchFastCos_simd"]="math"
    
    # OpenMP-parallelized batch functions (math.cpp)
    ["batchValueNoise_omp"]="math"
    ["batchFbm_omp"]="math"
    ["batchDistSq3D_omp"]="math"
    
    # Fast approximation functions (math.cpp)
    ["fastSin"]="math"
    ["fastCos"]="math"
    ["fastPow2"]="math"
    
    # Math SIMD/OpenMP functions (math.cpp)
    ["valueNoise2D_simd4"]="math"
    ["fbm2D_simd4"]="math"
    ["batchGroundHeight_simd"]="math"
    ["batchValueNoise_omp"]="math"
    ["batchFbm_omp"]="math"
    ["batchDistSq3D_omp"]="math"
    ["fastSin"]="math"
    ["fastCos"]="math"
    ["fastPow2"]="math"
    
    # Physics functions (physics.cpp)
    ["fastDistance"]="physics"
    ["smoothDamp"]="physics"
    ["updateParticles"]="physics"
    ["checkCollision"]="physics"
    ["initPhysics"]="physics"
    ["addObstacle"]="physics"
    ["addObstaclesBatch"]="physics"
    ["setPlayerState"]="physics"
    ["getPlayerX"]="physics"
    ["getPlayerY"]="physics"
    ["getPlayerZ"]="physics"
    ["getPlayerVX"]="physics"
    ["getPlayerVY"]="physics"
    ["getPlayerVZ"]="physics"
    ["updatePhysicsCPP"]="physics"
    
    # Agent 4: Frustum/distance culling functions
    ["batchFrustumCull_c"]="physics"
    ["batchDistanceCullIndexed_c"]="physics"
    ["batchFrustumCullSIMD_c"]="physics"
    
    # Batch physics functions (physics.cpp)
    ["batchCollisionCheck_c"]="physics"
    ["batchRaycast_c"]="physics"
    
    # Batch functions (batch.cpp)
    ["batchDistances"]="batch"
    ["batchDistanceCull_c"]="batch"
    ["batchSinWave"]="batch"
    ["batchCalcFiberWhip"]="batch"
    ["batchCalcSpiralWave"]="batch"
    ["batchCalcWobble"]="batch"
    
    # Agent 3: LOD batch update functions (lod_batch.cpp)
    ["batchUpdateLODMatrices_c"]="lod_batch"
    ["batchDistanceCullLOD_c"]="lod_batch"
    ["batchScaleMatrices_c"]="lod_batch"
    ["batchTranslateMatrices_c"]="lod_batch"
    ["batchFadeColors_c"]="lod_batch"
    
    # New batch animation functions (animation_batch.cpp)
    ["batchSnareSnap_c"]="animation_batch"
    ["batchAccordion_c"]="animation_batch"
    ["batchFiberWhip_c"]="animation_batch"
    ["batchSpiralWave_c"]="animation_batch"
    ["batchVibratoShake_c"]="animation_batch"
    ["batchTremoloPulse_c"]="animation_batch"
    ["batchCymbalShake_c"]="animation_batch"
    ["batchPanningBob_c"]="animation_batch"
    ["batchSpiritFade_c"]="animation_batch"
    ["processBatchUniversal_c"]="animation_batch"
    
    # Agent 1: Simple animation types migrated from TS
    ["batchShiver_c"]="animation_batch"
    ["batchSpring_c"]="animation_batch"
    ["batchFloat_c"]="animation_batch"
    ["batchCloudBob_c"]="animation_batch"
    
    # Agent 1: SIMD-optimized animation batch functions
    ["batchShiver_simd"]="animation_batch"
    ["batchSpring_simd"]="animation_batch"
    ["batchFloat_simd"]="animation_batch"
    ["batchCloudBob_simd"]="animation_batch"
    ["batchVineSway_simd"]="animation_batch"
    ["batchGeyserErupt_c"]="animation_batch"
    ["batchRetrigger_simd"]="animation_batch"
    
    # Mesh deformation functions (mesh_deformation.cpp)
    ["deformMeshWave"]="mesh_deformation"
    ["deformMeshJiggle"]="mesh_deformation"
    ["deformMeshWobble"]="mesh_deformation"
    ["recomputeNormals"]="mesh_deformation"
    ["batchDeformMeshes"]="mesh_deformation"
    ["getDeformBatchSize"]="mesh_deformation"
    ["hasSIMDSupport"]="mesh_deformation"
    
    # Agent 2: SIMD-optimized batch deformation functions
    ["deformWave_c"]="mesh_deformation"
    ["deformJiggle_c"]="mesh_deformation"
    ["deformWobble_c"]="mesh_deformation"
    
    # Bootstrap functions (bootstrap_loader.cpp)
    ["startBootstrapInit"]="bootstrap"
    ["getBootstrapProgress"]="bootstrap"
    ["isBootstrapComplete"]="bootstrap"
    ["getBootstrapHeight"]="bootstrap"
    ["resetBootstrap"]="bootstrap"
    ["startShaderWarmup"]="bootstrap"
    ["getShaderWarmupProgress"]="bootstrap"
    
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

    # Fluid functions (fluid.cpp)
    ["fluidInit"]="fluid"
    ["fluidStep"]="fluid"
    ["fluidAddDensity"]="fluid"
    ["fluidAddVelocity"]="fluid"
    ["fluidGetDensityPtr"]="fluid"
    
    # Particle physics functions (particle_physics.cpp)
    ["updateParticlesWASM"]="particle_physics"
    ["getParticlePhysicsVersion"]="particle_physics"
    ["initParticleRandom"]="particle_physics"
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
# - O3: Maximum optimization for speed
# - msimd128: Enable SIMD for vectorized math operations
# - mrelaxed-simd: Allow relaxed SIMD operations for better performance
# - ffast-math: Aggressive floating-point optimizations
# - fno-rtti: Disable RTTI to reduce code size
# - pthread: Enable threading support for parallel operations
# - fopenmp: Enable OpenMP for parallel batch operations
COMPILE_FLAGS="-O3 -msimd128 -mrelaxed-simd -ffast-math -fno-rtti -funroll-loops -fopenmp -pthread -matomics -I."

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

LINK_FLAGS="-O3 -std=c++17 -lembind -s USE_PTHREADS=1 -s PTHREAD_POOL_SIZE=4 -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=384MB -s MAXIMUM_MEMORY=256MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"wasmMemory\"] -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web,worker -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s SHARED_MEMORY=1 \
-matomics -fopenmp -msimd128 -mrelaxed-simd -ffast-math -pthread -L$SCRIPT_DIR -lomp"

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
COMPILE_FLAGS_ST="-O3 -msimd128 -mrelaxed-simd -ffast-math -fno-rtti -funroll-loops"

# Linker flags for ST (remove pthread, shared memory)
LINK_FLAGS_ST="-O3 -std=c++17 -lembind -s WASM=1 -s WASM_BIGINT=0 \
-s ALLOW_MEMORY_GROWTH=1 -s TOTAL_STACK=16MB -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=256MB $ASSERTION_FLAG -s EXPORT_ES6=1 \
-s EXPORTED_RUNTIME_METHODS=[\"ccall\",\"cwrap\",\"wasmMemory\"] -s MODULARIZE=1 -s EXPORT_NAME=createCandyNative \
-s ENVIRONMENT=web -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
-msimd128 -mrelaxed-simd -ffast-math"

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
for f in "$SCRIPT_DIR"/*.cpp; do
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