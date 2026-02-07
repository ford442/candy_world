/**
 * @file material_batch.ts
 * @brief Batched material flash/fade processing - AssemblyScript
 * 
 * High-performance batch processing for material color lerping operations.
 * Reduces GC pressure and improves cache locality by processing materials
 * in tight WASM loops rather than scattered JS object access.
 * 
 * @perf-migrate {target: "asc", reason: "hot-loop-math", note: "Processes 1000+ materials/frame"}
 */

// =============================================================================
// BATCH CONFIGURATION
// =============================================================================

/** Maximum materials per batch */
export const MAX_MATERIALS: i32 = 2000;

/** Memory layout: 12 floats per material (48 bytes) */
const MATERIAL_STRIDE: i32 = 12;

/** Memory layout offsets (in floats) */
const OFF_CURRENT_R: i32 = 0;
const OFF_CURRENT_G: i32 = 1;
const OFF_CURRENT_B: i32 = 2;
const OFF_BASE_R: i32 = 3;
const OFF_BASE_G: i32 = 4;
const OFF_BASE_B: i32 = 5;
const OFF_FLASH_R: i32 = 6;
const OFF_FLASH_G: i32 = 7;
const OFF_FLASH_B: i32 = 8;
const OFF_FLASH_INTENSITY: i32 = 9;
const OFF_EMISSIVE_INTENSITY: i32 = 10;
const OFF_FLAGS: i32 = 11; // bit 0: isBasicMaterial, bit 1: hasEmissive, bit 2: needsFadeBack

// Flag bits
const FLAG_BASIC: i32 = 1;
const FLAG_EMISSIVE: i32 = 2;
const FLAG_NEEDS_FADE: i32 = 4;

// =============================================================================
// BATCH STATE
// =============================================================================

// Material data buffer (at fixed offset to avoid allocations)
const MATERIAL_BUFFER_OFFSET: i32 = 200000; // 200KB - after other data

// Results buffer (output colors)
const RESULT_BUFFER_OFFSET: i32 = 300000; // 300KB
const RESULT_STRIDE: i32 = 4; // r, g, b, emissiveIntensity

// =============================================================================
// BATCH PROCESSING FUNCTIONS
// =============================================================================

/**
 * Process a batch of material flash updates
 * 
 * For each material:
 * - If flashIntensity > 0: blend toward flash color, decay intensity
 * - If needsFadeBack: lerp back to base color
 * 
 * @param count - Number of materials to process
 * @param fadeSpeed - Lerp speed for fade back (default 0.06)
 * @param snapThreshold - Distance threshold to snap to base color
 * @param flashScale - Global flash intensity multiplier
 * @returns Number of materials still active (have flash or fading)
 */
export function batchMaterialFlash(
    count: i32,
    fadeSpeed: f32,
    snapThreshold: f32,
    flashScale: f32
): i32 {
    const snapSq: f32 = snapThreshold * snapThreshold;
    let activeCount: i32 = 0;
    
    for (let i: i32 = 0; i < count; i++) {
        const base = MATERIAL_BUFFER_OFFSET + (i * MATERIAL_STRIDE * 4); // 4 bytes per f32
        
        // Load material data
        let currentR = load<f32>(base + OFF_CURRENT_R * 4);
        let currentG = load<f32>(base + OFF_CURRENT_G * 4);
        let currentB = load<f32>(base + OFF_CURRENT_B * 4);
        
        const baseR = load<f32>(base + OFF_BASE_R * 4);
        const baseG = load<f32>(base + OFF_BASE_G * 4);
        const baseB = load<f32>(base + OFF_BASE_B * 4);
        
        const flashR = load<f32>(base + OFF_FLASH_R * 4);
        const flashG = load<f32>(base + OFF_FLASH_G * 4);
        const flashB = load<f32>(base + OFF_FLASH_B * 4);
        
        let flashIntensity = load<f32>(base + OFF_FLASH_INTENSITY * 4);
        let emissiveIntensity = load<f32>(base + OFF_EMISSIVE_INTENSITY * 4);
        
        const flags = i32(load<f32>(base + OFF_FLAGS * 4));
        const isBasic = (flags & FLAG_BASIC) != 0;
        const hasEmissive = (flags & FLAG_EMISSIVE) != 0;
        let needsFadeBack = (flags & FLAG_NEEDS_FADE) != 0;
        
        // Process flash
        if (flashIntensity > 0.0) {
            const t: f32 = Mathf.min(1.0, flashIntensity * 1.2) * 0.8;
            
            if (flashIntensity > 0.7) {
                // Immediate override
                currentR = flashR;
                currentG = flashG;
                currentB = flashB;
            } else {
                // Lerp toward flash color
                currentR = currentR + (flashR - currentR) * t;
                currentG = currentG + (flashG - currentG) * t;
                currentB = currentB + (flashB - currentB) * t;
            }
            
            // Update emissive intensity
            if (hasEmissive) {
                emissiveIntensity = Mathf.max(0.2, flashIntensity * flashScale);
            }
            
            // Decay flash
            flashIntensity = Mathf.max(0.0, flashIntensity - 0.05); // Default decay
            if (flashIntensity == 0.0) {
                needsFadeBack = true;
            }
            
            activeCount++;
        }
        // Process fade back
        else if (needsFadeBack) {
            // Lerp current back to base
            const distSq: f32 = 
                (currentR - baseR) * (currentR - baseR) +
                (currentG - baseG) * (currentG - baseG) +
                (currentB - baseB) * (currentB - baseB);
            
            if (distSq > snapSq) {
                currentR = currentR + (baseR - currentR) * fadeSpeed;
                currentG = currentG + (baseG - currentG) * fadeSpeed;
                currentB = currentB + (baseB - currentB) * fadeSpeed;
                activeCount++;
            } else {
                // Snap to base
                currentR = baseR;
                currentG = baseG;
                currentB = baseB;
                needsFadeBack = false;
            }
            
            // Fade emissive intensity
            if (hasEmissive && emissiveIntensity > snapThreshold) {
                emissiveIntensity = emissiveIntensity + (0.0 - emissiveIntensity) * fadeSpeed;
                activeCount++;
            } else if (hasEmissive) {
                emissiveIntensity = 0.0;
            }
        }
        
        // Store results
        store<f32>(base + OFF_CURRENT_R * 4, currentR);
        store<f32>(base + OFF_CURRENT_G * 4, currentG);
        store<f32>(base + OFF_CURRENT_B * 4, currentB);
        store<f32>(base + OFF_FLASH_INTENSITY * 4, flashIntensity);
        
        // Update flags
        let newFlags = flags;
        if (needsFadeBack) {
            newFlags = newFlags | FLAG_NEEDS_FADE;
        } else {
            newFlags = newFlags & ~FLAG_NEEDS_FADE;
        }
        store<f32>(base + OFF_FLAGS * 4, f32(newFlags));
        
        // Store output to result buffer
        const resultBase = RESULT_BUFFER_OFFSET + (i * RESULT_STRIDE * 4);
        store<f32>(resultBase + 0, currentR);
        store<f32>(resultBase + 4, currentG);
        store<f32>(resultBase + 8, currentB);
        store<f32>(resultBase + 12, emissiveIntensity);
    }
    
    return activeCount;
}

/**
 * Initialize a material entry in the batch buffer
 * 
 * @param index - Material index (0 to MAX_MATERIALS-1)
 * @param currentR, currentG, currentB - Current color
 * @param baseR, baseG, baseB - Base/resting color
 * @param isBasicMaterial - Whether it's a MeshBasicMaterial
 * @param hasEmissive - Whether material has emissive property
 */
export function initMaterialEntry(
    index: i32,
    currentR: f32, currentG: f32, currentB: f32,
    baseR: f32, baseG: f32, baseB: f32,
    isBasicMaterial: i32,
    hasEmissive: i32
): void {
    if (index < 0 || index >= MAX_MATERIALS) return;
    
    const base = MATERIAL_BUFFER_OFFSET + (index * MATERIAL_STRIDE * 4);
    
    store<f32>(base + OFF_CURRENT_R * 4, currentR);
    store<f32>(base + OFF_CURRENT_G * 4, currentG);
    store<f32>(base + OFF_CURRENT_B * 4, currentB);
    
    store<f32>(base + OFF_BASE_R * 4, baseR);
    store<f32>(base + OFF_BASE_G * 4, baseG);
    store<f32>(base + OFF_BASE_B * 4, baseB);
    
    store<f32>(base + OFF_FLASH_R * 4, 1.0);
    store<f32>(base + OFF_FLASH_G * 4, 1.0);
    store<f32>(base + OFF_FLASH_B * 4, 1.0);
    
    store<f32>(base + OFF_FLASH_INTENSITY * 4, 0.0);
    store<f32>(base + OFF_EMISSIVE_INTENSITY * 4, 0.0);
    
    let flags: i32 = 0;
    if (isBasicMaterial != 0) flags = flags | FLAG_BASIC;
    if (hasEmissive != 0) flags = flags | FLAG_EMISSIVE;
    store<f32>(base + OFF_FLAGS * 4, f32(flags));
}

/**
 * Trigger a flash on a material
 * 
 * @param index - Material index
 * @param flashR, flashG, flashB - Flash color
 * @param intensity - Flash intensity (0-1)
 */
export function triggerMaterialFlash(
    index: i32,
    flashR: f32, flashG: f32, flashB: f32,
    intensity: f32
): void {
    if (index < 0 || index >= MAX_MATERIALS) return;
    
    const base = MATERIAL_BUFFER_OFFSET + (index * MATERIAL_STRIDE * 4);
    
    store<f32>(base + OFF_FLASH_R * 4, flashR);
    store<f32>(base + OFF_FLASH_G * 4, flashG);
    store<f32>(base + OFF_FLASH_B * 4, flashB);
    store<f32>(base + OFF_FLASH_INTENSITY * 4, intensity);
}

/**
 * Get the result color for a material
 * 
 * @param index - Material index
 * @param outPtr - Pointer to output buffer (4 floats: r, g, b, emissiveIntensity)
 */
export function getMaterialResult(index: i32, outPtr: i32): void {
    if (index < 0 || index >= MAX_MATERIALS) return;
    
    const resultBase = RESULT_BUFFER_OFFSET + (index * RESULT_STRIDE * 4);
    
    const r = load<f32>(resultBase + 0);
    const g = load<f32>(resultBase + 4);
    const b = load<f32>(resultBase + 8);
    const emissive = load<f32>(resultBase + 12);
    
    store<f32>(outPtr + 0, r);
    store<f32>(outPtr + 4, g);
    store<f32>(outPtr + 8, b);
    store<f32>(outPtr + 12, emissive);
}

/**
 * Check if a material needs fade back
 * 
 * @param index - Material index
 * @returns 1 if needs fade back, 0 otherwise
 */
export function materialNeedsFadeBack(index: i32): i32 {
    if (index < 0 || index >= MAX_MATERIALS) return 0;
    
    const base = MATERIAL_BUFFER_OFFSET + (index * MATERIAL_STRIDE * 4);
    const flags = i32(load<f32>(base + OFF_FLAGS * 4));
    
    return (flags & FLAG_NEEDS_FADE) != 0 ? 1 : 0;
}

/**
 * Get the current flash intensity of a material
 * 
 * @param index - Material index
 * @returns Flash intensity (0-1)
 */
export function getMaterialFlashIntensity(index: i32): f32 {
    if (index < 0 || index >= MAX_MATERIALS) return 0.0;
    
    const base = MATERIAL_BUFFER_OFFSET + (index * MATERIAL_STRIDE * 4);
    return load<f32>(base + OFF_FLASH_INTENSITY * 4);
}
