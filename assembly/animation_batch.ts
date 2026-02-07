/**
 * @file animation_batch.ts
 * @brief Expanded batch animation processing for foliage - AssemblyScript
 * 
 * This module provides batch processing for additional animation types
 * that were previously computed in JavaScript. Processing thousands of
 * objects in WASM provides significant performance benefits.
 * 
 * @perf-migrate {target: "asc", reason: "hot-loop-math", note: "Processes 3000+ objects/frame"}
 */

import { ANIMATION_OFFSET } from "./constants";

// =============================================================================
// BATCH CONFIGURATION
// =============================================================================

/** Maximum objects per batch - matches foliage-batcher.ts */
export const BATCH_SIZE: i32 = 4000;

/** Memory layout stride (4 bytes per f32) */
const F32_SIZE: i32 = 4;

// =============================================================================
// ANIMATION TYPE CONSTANTS (match TypeScript enum)
// =============================================================================

export const ANIM_TYPE_GENTLE_SWAY: i32 = 1;
export const ANIM_TYPE_BOUNCE: i32 = 2;
export const ANIM_TYPE_WOBBLE: i32 = 3;
export const ANIM_TYPE_HOP: i32 = 4;
export const ANIM_TYPE_SHIVER: i32 = 5;
export const ANIM_TYPE_SPRING: i32 = 6;
export const ANIM_TYPE_VINE_SWAY: i32 = 7;
export const ANIM_TYPE_FLOAT: i32 = 9;
export const ANIM_TYPE_SPIN: i32 = 10;
export const ANIM_TYPE_GLOW_PULSE: i32 = 11;
export const ANIM_TYPE_CLOUD_BOB: i32 = 12;

// New animation types being migrated from JS
export const ANIM_TYPE_SNARE_SNAP: i32 = 13;
export const ANIM_TYPE_ACCORDION: i32 = 14;
export const ANIM_TYPE_FIBER_WHIP: i32 = 15;
export const ANIM_TYPE_SPIRAL_WAVE: i32 = 16;
export const ANIM_TYPE_VIBRATO_SHAKE: i32 = 17;
export const ANIM_TYPE_TREMOLO_PULSE: i32 = 18;
export const ANIM_TYPE_CYMBAL_SHAKE: i32 = 19;
export const ANIM_TYPE_PANNING_BOB: i32 = 20;
export const ANIM_TYPE_SPIRIT_FADE: i32 = 21;

// =============================================================================
// BATCH STATE STRUCTURE (in-memory layout)
// Each batch entry is 6 floats (24 bytes):
// [0] offset: f32 - animation offset
// [1] intensity: f32 - animation intensity  
// [2] originalY: f32 - original Y position (for bounce/hop)
// [3] wobbleBoost: f32 - wobble multiplier
// [4] param1: f32 - type-specific param (e.g., snare trigger state)
// [5] param2: f32 - type-specific param
// =============================================================================

const ENTRY_STRIDE: i32 = 6;

// Result buffers (stored at fixed offsets after input data)
// Results are 4 floats per object: posY, rotX, rotY, rotZ
const RESULT_STRIDE: i32 = 4;

// Memory layout offsets (must match foliage-batcher.ts)
const INPUT_OFFSET: i32 = 65536;    // Start at 64KB
const RESULT_OFFSET: i32 = 155536;  // After 4000 * 24 bytes of input

// =============================================================================
// BATCH PROCESSING FUNCTIONS
// =============================================================================

/**
 * Process a batch of snare snap animations
 * Snare trap plants that snap shut on beat
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param snareTrigger - Snare trigger intensity (0-1)
 * @param outPtr - Pointer to output results
 */
export function batchSnareSnap(
    ptr: i32,
    count: i32,
    time: f32,
    snareTrigger: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        
        // Load previous snap state from param1
        let snapState = load<f32>(base + 4 * F32_SIZE);
        
        // Snap logic: trigger on snare, decay over time
        if (snareTrigger > 0.2) {
            const oldState = snapState;
            if (oldState < 0.2) {
                // Rising edge - snap!
                snapState = 1.0;
            }
        } else {
            snapState = Mathf.max(0.0, snapState - 0.1);
        }
        
        // Store updated state back
        store<f32>(base + 4 * F32_SIZE, snapState);
        
        // Output: snapState in rotX field
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, 0.0); // posY (unused)
        store<f32>(resultBase + 1 * F32_SIZE, snapState); // rotX (snap state)
        store<f32>(resultBase + 2 * F32_SIZE, 0.0); // rotY
        store<f32>(resultBase + 3 * F32_SIZE, 0.0); // rotZ
    }
}

/**
 * Process a batch of accordion stretch animations
 * Trees that stretch vertically on beat
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param outPtr - Pointer to output results (scaleY, scaleXZ)
 */
export function batchAccordion(
    ptr: i32,
    count: i32,
    time: f32,
    intensity: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        
        const animTime = time + offset;
        const rawStretch = Mathf.sin(animTime * 10.0);
        const stretchY: f32 = 1.0 + Mathf.max(0.0, rawStretch) * 0.31 * intensity;
        const widthXZ: f32 = 1.0 / Mathf.sqrt(stretchY);
        
        // Output: scaleY and scaleXZ
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, stretchY);
        store<f32>(resultBase + 1 * F32_SIZE, widthXZ);
        store<f32>(resultBase + 2 * F32_SIZE, 0.0);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of fiber whip animations
 * Willow branches that whip in the wind
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param leadVol - Lead channel volume
 * @param isActive - Whether animation is active
 * @param outPtr - Pointer to output results (baseRotY, branchRotZ)
 */
export function batchFiberWhip(
    ptr: i32,
    count: i32,
    time: f32,
    leadVol: f32,
    isActive: i32,
    outPtr: i32
): void {
    const whip = leadVol * 2.0;
    
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        const branchIndex = i32(load<f32>(base + 4 * F32_SIZE)); // param1 stores branch index
        
        const baseRotY: f32 = Mathf.sin(time * 0.5 + offset) * 0.1;
        
        const childOffset = f32(branchIndex) * 0.5;
        let branchRotZ = 0.785398 + Mathf.sin(time * 2.0 + childOffset) * 0.1;
        
        if (isActive != 0) {
            branchRotZ += Mathf.sin(time * 10.0 + childOffset) * whip;
        }
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, baseRotY);
        store<f32>(resultBase + 1 * F32_SIZE, branchRotZ as f32);
        store<f32>(resultBase + 2 * F32_SIZE, 0.0);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of spiral wave animations
 * Flowers with spiraling petals
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param intensity - Animation intensity
 * @param groove - Groove amount
 * @param outPtr - Pointer to output results (rotY, yOffset, scale)
 */
export function batchSpiralWave(
    ptr: i32,
    count: i32,
    time: f32,
    intensity: f32,
    groove: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        const childIndex = f32(i);
        
        const animTime = time + offset + childIndex * 0.5;
        const rotY: f32 = Mathf.sin(animTime * 2.0) * 0.2 * intensity;
        const yOffset: f32 = Mathf.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
        const scale: f32 = 1.0 + Mathf.sin(animTime * 4.0) * 0.05 * intensity;
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, rotY);
        store<f32>(resultBase + 1 * F32_SIZE, yOffset);
        store<f32>(resultBase + 2 * F32_SIZE, scale as f32);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of vibrato shake animations
 * Flowers that shake based on vibrato effect
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects  
 * @param time - Current time
 * @param vibratoAmount - Vibrato intensity (0-1)
 * @param intensity - Base animation intensity
 * @param outPtr - Pointer to output results (rotX, rotY, shakeSpeed)
 */
export function batchVibratoShake(
    ptr: i32,
    count: i32,
    time: f32,
    vibratoAmount: f32,
    intensity: f32,
    outPtr: i32
): void {
    const shakeSpeed: f32 = 50.0 + vibratoAmount * 100.0;
    const shakeAmount: f32 = 0.05 + vibratoAmount * 0.25;
    
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        const phase = f32(i) * 0.5;
        
        const rotX: f32 = -1.5708 + Mathf.sin(time * shakeSpeed + phase) * shakeAmount; // -PI/2
        const rotY: f32 = Mathf.cos(time * shakeSpeed * 1.3 + phase) * shakeAmount * 0.8;
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, rotX);
        store<f32>(resultBase + 1 * F32_SIZE, rotY);
        store<f32>(resultBase + 2 * F32_SIZE, shakeSpeed);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of tremolo pulse animations
 * Flowers that pulse based on tremolo effect
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param tremoloAmount - Tremolo intensity (0-1)
 * @param intensity - Base animation intensity
 * @param outPtr - Pointer to output results (scale, opacity, emission)
 */
export function batchTremoloPulse(
    ptr: i32,
    count: i32,
    time: f32,
    tremoloAmount: f32,
    intensity: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        
        const pulseSpeed: f32 = 8.0 + tremoloAmount * 15.0;
        const pulseAmount: f32 = 0.1 + tremoloAmount * 0.3;
        const pulse: f32 = 1.0 + Mathf.sin(time * pulseSpeed + offset) * pulseAmount;
        
        const opacity: f32 = 0.7 + Mathf.sin(time * pulseSpeed + offset) * 0.2 * intensity;
        const emission: f32 = 0.3 + tremoloAmount * 0.7;
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, pulse);      // scale
        store<f32>(resultBase + 1 * F32_SIZE, opacity);    // opacity
        store<f32>(resultBase + 2 * F32_SIZE, emission);   // emissive intensity
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of cymbal shake animations
 * Dandelions that shake on high frequency content
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param highFreq - High frequency intensity (0-1)
 * @param intensity - Base animation intensity
 * @param outPtr - Pointer to output results (rotZ, rotX, scale)
 */
export function batchCymbalShake(
    ptr: i32,
    count: i32,
    time: f32,
    highFreq: f32,
    intensity: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        
        // Load previous rotation state from params
        let rotZ = load<f32>(base + 4 * F32_SIZE);
        let rotX = load<f32>(base + 5 * F32_SIZE);
        
        if (highFreq > 0.05) {
            const twitch = highFreq * 0.2;
            // Add random-like jitter based on time
            const jitterSeed: f32 = time * 10.0 + f32(i);
            const jitterZ: f32 = Mathf.sin(jitterSeed) * twitch;
            const jitterX: f32 = Mathf.cos(jitterSeed * 1.3) * twitch;
            rotZ = jitterZ;
            rotX = jitterX;
        } else {
            // Dampen back to rest
            rotZ *= 0.9;
            rotX *= 0.9;
        }
        
        // Store state back
        store<f32>(base + 4 * F32_SIZE, rotZ);
        store<f32>(base + 5 * F32_SIZE, rotX);
        
        // Calculate scale burst
        let scale = 1.0;
        if (highFreq > 0.4) {
            scale = 1.0 + (highFreq - 0.4) * 0.5;
        }
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, rotZ);
        store<f32>(resultBase + 1 * F32_SIZE, rotX);
        store<f32>(resultBase + 2 * F32_SIZE, scale as f32);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of panning bob animations
 * Pads that bob based on panning effects
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param panActivity - Pan activity amount (0-1)
 * @param intensity - Base animation intensity
 * @param outPtr - Pointer to output results (posY, rotZ, glowIntensity)
 */
export function batchPanningBob(
    ptr: i32,
    count: i32,
    time: f32,
    panActivity: f32,
    intensity: f32,
    outPtr: i32
): void {
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        const panBias = load<f32>(base + 4 * F32_SIZE); // param1 stores pan bias
        
        // Smooth bob
        const currentBob = load<f32>(base + 5 * F32_SIZE); // param2 stores current bob
        const nextBob = currentBob + (panActivity - currentBob) * 0.1;
        store<f32>(base + 5 * F32_SIZE, nextBob);
        
        const bobHeight: f32 = nextBob * 1.5 * intensity;
        const posY: f32 = Mathf.sin(time * 2.0 + offset) * 0.1 + bobHeight;
        const rotZ: f32 = panBias * bobHeight * 0.2;
        const glowIntensity: f32 = 0.6 + bobHeight * 0.8;
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, posY);
        store<f32>(resultBase + 1 * F32_SIZE, rotZ);
        store<f32>(resultBase + 2 * F32_SIZE, glowIntensity);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

/**
 * Process a batch of spirit fade animations
 * Spirits that fade based on audio volume
 * 
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param volume - Audio volume (0-1)
 * @param delta - Delta time
 * @param outPtr - Pointer to output results (opacity, posY)
 */
export function batchSpiritFade(
    ptr: i32,
    count: i32,
    time: f32,
    volume: f32,
    delta: f32,
    outPtr: i32
): void {
    const threshold: f32 = 0.1;
    
    for (let i: i32 = 0; i < count; i++) {
        const base = ptr + i * ENTRY_STRIDE * F32_SIZE;
        const offset = load<f32>(base);
        const originalY = load<f32>(base + 2 * F32_SIZE);
        
        // Load current state
        let currentOpacity = load<f32>(base + 4 * F32_SIZE);
        let fleeSpeed = load<f32>(base + 5 * F32_SIZE);
        
        // Calculate target opacity
        let targetOpacity: f32 = 0.0;
        if (volume < threshold) {
            targetOpacity = 0.8;
            fleeSpeed = Mathf.max(0.0, fleeSpeed - 0.01);
        } else {
            targetOpacity = 0.0;
            if (currentOpacity > 0.1) {
                fleeSpeed = Mathf.min(0.2, fleeSpeed + 0.01);
            }
        }
        
        // Lerp opacity
        currentOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.05;
        
        // Store state back
        store<f32>(base + 4 * F32_SIZE, currentOpacity);
        store<f32>(base + 5 * F32_SIZE, fleeSpeed);
        
        // Calculate hover Y
        const posY = originalY + Mathf.sin(time * 1.5 + offset) * 0.2;
        
        const resultBase = outPtr + i * RESULT_STRIDE * F32_SIZE;
        store<f32>(resultBase + 0 * F32_SIZE, currentOpacity);
        store<f32>(resultBase + 1 * F32_SIZE, posY);
        store<f32>(resultBase + 2 * F32_SIZE, fleeSpeed);
        store<f32>(resultBase + 3 * F32_SIZE, 0.0);
    }
}

// =============================================================================
// UNIVERSAL BATCH ROUTER
// =============================================================================

/**
 * Universal batch animation processor
 * Routes to specific animation type based on animType parameter
 * 
 * @param animType - Animation type constant
 * @param ptr - Pointer to input data
 * @param count - Number of objects
 * @param time - Current time
 * @param beatPhase - Beat phase offset
 * @param kick - Kick trigger intensity
 * @param groove - Groove amount
 * @param audioParam - Additional audio parameter (type-specific)
 * @param outPtr - Pointer to output results
 */
export function processBatchUniversal(
    animType: i32,
    ptr: i32,
    count: i32,
    time: f32,
    beatPhase: f32,
    kick: f32,
    groove: f32,
    audioParam: f32,
    outPtr: i32
): void {
    const animTime = time + beatPhase;
    const isActive: i32 = 1; // Assuming night/active mode
    const intensity = 1.0 + groove * 5.0;
    
    if (animType == ANIM_TYPE_SNARE_SNAP) {
        batchSnareSnap(ptr, count, time, audioParam, outPtr);
    }
    else if (animType == ANIM_TYPE_ACCORDION) {
        batchAccordion(ptr, count, time, intensity as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_FIBER_WHIP) {
        batchFiberWhip(ptr, count, time, audioParam, isActive, outPtr);
    }
    else if (animType == ANIM_TYPE_SPIRAL_WAVE) {
        batchSpiralWave(ptr, count, time, intensity as f32, groove as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_VIBRATO_SHAKE) {
        batchVibratoShake(ptr, count, time, audioParam, intensity as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_TREMOLO_PULSE) {
        batchTremoloPulse(ptr, count, time, audioParam, intensity as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_CYMBAL_SHAKE) {
        batchCymbalShake(ptr, count, time, audioParam, intensity as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_PANNING_BOB) {
        batchPanningBob(ptr, count, time, audioParam, intensity as f32, outPtr);
    }
    else if (animType == ANIM_TYPE_SPIRIT_FADE) {
        batchSpiritFade(ptr, count, time, audioParam, 0.016, outPtr);
    }
}
