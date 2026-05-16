/**
 * @file animation_batch.cpp (wrapper/master file)
 * @brief Master inclusion file for all batch animation modules
 * @details This file includes all refactored animation batch processing modules:
 *          - animation_batch_percussion.cpp: Percussion animations
 *          - animation_batch_melodic.cpp: Melodic instrument animations
 *          - animation_batch_effects.cpp: Special effects animations
 *          - animation_batch_foliage.cpp: Foliage/vegetation animations
 *          - animation_batch_simd.cpp: SIMD-optimized animations
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"
#include <wasm_simd128.h>
#include "animation_batch_utils.h"

// Include all refactored animation modules
#include "animation_batch_percussion.cpp"
#include "animation_batch_melodic.cpp"
#include "animation_batch_effects.cpp"
#include "animation_batch_foliage.cpp"
#include "animation_batch_simd.cpp"

