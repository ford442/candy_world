/**
 * @file wasm-animations.ts
 * @brief Animation Functions with WASM and JavaScript Fallbacks
 * 
 * This module contains:
 * - All animation functions: calcBounceY, calcSwayRotZ, calcWobble, calcHopY
 * - Advanced animations: calcAccordionStretch, calcFiberWhip, calcShiver, calcSpiralWave, calcPrismRose
 * - Musical/audio reactivity: calcArpeggioStep, calcSpeakerPulse
 * - Particle effects: calcFloatingParticle, calcRainDropY
 * - Color utilities: lerpColor
 * - Result object caches (reused to avoid allocation)
 */

import { 
    wasmInstance,
    getNativeFunc,
    type WasmExports 
} from './wasm-loader-core.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Wobble result
 */
export interface WobbleResult {
    rotX: number;
    rotZ: number;
}

/**
 * Accordion stretch result
 */
export interface AccordionResult {
    stretchY: number;
    widthXZ: number;
}

/**
 * Fiber whip result
 */
export interface FiberResult {
    baseRotY: number;
    branchRotZ: number;
}

/**
 * Shiver result
 */
export interface ShiverResult {
    rotX: number;
    rotZ: number;
}

/**
 * Spiral wave result
 */
export interface SpiralResult {
    rotY: number;
    yOffset: number;
    scale: number;
}

/**
 * Prism rose result
 */
export interface PrismResult {
    unfurl: number;
    spin: number;
    pulse: number;
    hue: number;
}

/**
 * Arpeggio result
 */
export interface ArpeggioResult {
    targetStep: number;
    unfurlStep: number;
}

/**
 * Particle position result
 */
export interface ParticleResult {
    x: number;
    y: number;
    z: number;
}

// =============================================================================
// RESULT OBJECT CACHES (reused to avoid allocation)
// =============================================================================

const accordionResult: AccordionResult = { stretchY: 1, widthXZ: 1 };
const fiberResult: FiberResult = { baseRotY: 0, branchRotZ: 0 };
const shiverResult: ShiverResult = { rotX: 0, rotZ: 0 };
const spiralResult: SpiralResult = { rotY: 0, yOffset: 0, scale: 1 };
const prismResult: PrismResult = { unfurl: 0, spin: 0, pulse: 1, hue: 0 };
const particleResult: ParticleResult = { x: 0, y: 0, z: 0 };
const arpeggioResult: ArpeggioResult = { targetStep: 0, unfurlStep: 0 };
const wobbleResult: WobbleResult = { rotX: 0, rotZ: 0 };

// =============================================================================
// SIMPLE ANIMATION HELPERS
// =============================================================================

/**
 * Calculate vertical bounce offset for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * @param time - Current animation time
 * @param offset - Phase offset for desynchronization
 * @param intensity - Animation intensity multiplier
 * @param kick - Audio kick trigger value (0-1)
 * @returns Vertical offset value
 */
export function calcBounceY(time: number, offset: number, intensity: number, kick: number): number {
    // Check if WASM export exists before calling
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcBounceY) {
        return exports.calcBounceY(time, offset, intensity, kick);
    }
    // JavaScript fallback - identical algorithm to C++ implementation
    const animTime = time + offset;
    let yOffset = Math.sin(animTime * 3) * 0.1 * intensity;
    if (kick > 0.1) yOffset += kick * 0.2;
    return yOffset;
}

/**
 * Calculate rotation Z sway for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * @param time - Current animation time
 * @param offset - Phase offset for desynchronization
 * @param intensity - Animation intensity multiplier
 * @returns Rotation Z value in radians
 */
export function calcSwayRotZ(time: number, offset: number, intensity: number): number {
    // Check if WASM export exists before calling
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcSwayRotZ) {
        return exports.calcSwayRotZ(time, offset, intensity);
    }
    // JavaScript fallback
    return Math.sin(time + offset) * 0.1 * intensity;
}

/**
 * Calculate wobble rotation (X and Z axes) for an object.
 * Uses WASM if available, otherwise falls back to JavaScript.
 * @param time - Current animation time
 * @param offset - Phase offset for desynchronization
 * @param intensity - Animation intensity multiplier
 * @returns Rotation values in radians
 */
export function calcWobble(time: number, offset: number, intensity: number): WobbleResult {
    // Check if all required WASM exports exist
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcWobble && exports?.getWobbleX && exports?.getWobbleZ) {
        exports.calcWobble(time, offset, intensity);
        return {
            rotX: exports.getWobbleX(),
            rotZ: exports.getWobbleZ()
        };
    }
    // JavaScript fallback
    const animTime = time + offset;
    return {
        rotX: Math.sin(animTime * 3) * 0.15 * intensity,
        rotZ: Math.cos(animTime * 3) * 0.15 * intensity
    };
}

/**
 * Calculate hop Y offset for bouncing objects.
 * @param time - Current animation time
 * @param offset - Phase offset
 * @param intensity - Animation intensity
 * @param kick - Audio kick trigger (0-1)
 * @returns Vertical offset
 */
export function calcHopY(time: number, offset: number, intensity: number, kick: number): number {
    // Check if WASM export exists
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcHopY) {
        return exports.calcHopY(time, offset, intensity, kick);
    }
    // JavaScript fallback
    const animTime = time + offset;
    const hopVal = Math.sin(animTime * 4.0);
    let bounce = Math.max(0, hopVal) * 0.3 * intensity;
    if (kick > 0.1) bounce += kick * 0.15;
    return bounce;
}

/**
 * Calculate shiver animation for small rapid movements.
 * @param time - Current animation time
 * @param offset - Phase offset
 * @param intensity - Animation intensity
 * @returns Rotation values
 */
export function calcShiver(time: number, offset: number, intensity: number): ShiverResult {
    // Check if all required WASM exports exist
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcShiver && exports?.getShiverRotX && exports?.getShiverRotZ) {
        exports.calcShiver(time, offset, intensity);
        shiverResult.rotX = exports.getShiverRotX();
        shiverResult.rotZ = exports.getShiverRotZ();
    } else {
        // JavaScript fallback
        const animTime = time + offset;
        shiverResult.rotX = Math.sin(animTime * 20.0) * 0.02 * intensity;
        shiverResult.rotZ = Math.cos(animTime * 20.0) * 0.02 * intensity;
    }
    return shiverResult;
}

// =============================================================================
// ADVANCED ANIMATION WRAPPERS
// =============================================================================

/**
 * Calculate accordion stretch animation for instruments.
 * @param animTime - Current animation time
 * @param offset - Phase offset
 * @param intensity - Animation intensity
 * @returns Stretch values
 */
export function calcAccordionStretch(animTime: number, offset: number, intensity: number): AccordionResult {
    // Check if all required WASM exports exist
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcAccordionStretch && exports?.getAccordionStretchY && exports?.getAccordionWidthXZ) {
        exports.calcAccordionStretch(animTime, offset, intensity);
        accordionResult.stretchY = exports.getAccordionStretchY();
        accordionResult.widthXZ = exports.getAccordionWidthXZ();
    } else {
        // JavaScript fallback - matches C++ implementation in animation.cpp
        const rawStretch = Math.sin(animTime * 10.0 + offset);
        accordionResult.stretchY = 1.0 + Math.max(0, rawStretch) * 0.3 * intensity;
        accordionResult.widthXZ = 1.0 / Math.sqrt(accordionResult.stretchY);
    }
    return accordionResult;
}

/**
 * Calculate fiber whip animation for fiber optic-style trees.
 * This is a key animation function that was often missing from exports.
 * @param time - Current animation time
 * @param offset - Phase offset for desynchronization
 * @param leadVol - Audio lead volume (0-1)
 * @param isActive - Whether audio is currently active
 * @param branchIndex - Index of the branch being animated
 * @returns Rotation values in radians
 */
export function calcFiberWhip(time: number, offset: number, leadVol: number, isActive: boolean, branchIndex: number): FiberResult {
    // Check if all required WASM exports exist before calling
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcFiberWhip && exports?.getFiberBaseRotY && exports?.getFiberBranchRotZ) {
        exports.calcFiberWhip(time, offset, leadVol, isActive ? 1 : 0, branchIndex);
        fiberResult.baseRotY = exports.getFiberBaseRotY();
        fiberResult.branchRotZ = exports.getFiberBranchRotZ();
    } else {
        // JavaScript fallback - matches C++ implementation in animation.cpp
        fiberResult.baseRotY = Math.sin(time * 0.5 + offset) * 0.1;
        const whip = leadVol * 2.0;
        const childOffset = branchIndex * 0.5;
        fiberResult.branchRotZ = Math.PI / 4 + Math.sin(time * 2.0 + childOffset) * 0.1;
        if (isActive) {
            fiberResult.branchRotZ += Math.sin(time * 10.0 + childOffset) * whip;
        }
    }
    return fiberResult;
}

/**
 * Calculate spiral wave animation for rotating objects.
 * @param time - Current animation time
 * @param offset - Phase offset
 * @param intensity - Animation intensity
 * @param groove - Audio groove value
 * @returns Animation values
 */
export function calcSpiralWave(time: number, offset: number, intensity: number, groove: number): SpiralResult {
    // Check if all required WASM exports exist
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcSpiralWave && exports?.getSpiralRotY && exports?.getSpiralYOffset && exports?.getSpiralScale) {
        exports.calcSpiralWave(time, offset, intensity, groove);
        spiralResult.rotY = exports.getSpiralRotY();
        spiralResult.yOffset = exports.getSpiralYOffset();
        spiralResult.scale = exports.getSpiralScale();
    } else {
        // JavaScript fallback
        const animTime = time + offset;
        spiralResult.rotY = Math.sin(animTime * 2.0) * 0.2 * intensity;
        spiralResult.yOffset = Math.sin(animTime * 3.0) * 0.1 * (1.0 + groove);
        spiralResult.scale = 1.0 + Math.sin(animTime * 4.0) * 0.05 * intensity;
    }
    return spiralResult;
}

/**
 * Calculate prism rose animation for color-shifting effects.
 * @param time - Current time
 * @param offset - Phase offset
 * @param kick - Audio kick trigger
 * @param groove - Audio groove value
 * @param isActive - Whether audio is active
 * @returns Animation values
 */
export function calcPrismRose(time: number, offset: number, kick: number, groove: number, isActive: boolean): PrismResult {
    // Check if all required WASM exports exist
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcPrismRose && exports?.getPrismUnfurl && exports?.getPrismSpin && exports?.getPrismPulse && exports?.getPrismHue) {
        exports.calcPrismRose(time, offset, kick, groove, isActive ? 1 : 0);
        prismResult.unfurl = exports.getPrismUnfurl();
        prismResult.spin = exports.getPrismSpin();
        prismResult.pulse = exports.getPrismPulse();
        prismResult.hue = exports.getPrismHue();
    } else {
        // JavaScript fallback
        const animTime = time + offset;
        const intensity = isActive ? (1.0 + groove * 3.0) : 0.3;
        prismResult.unfurl = Math.sin(animTime * 2.0) * 0.1 * intensity;
        prismResult.spin = animTime * 0.5 + groove * 2.0;
        prismResult.pulse = 1.0 + kick * 0.3;
        prismResult.hue = (animTime * 0.1) % 1.0;
    }
    return prismResult;
}

// =============================================================================
// MUSICAL/AUDIO REACTIVITY
// =============================================================================

/**
 * Calculate arpeggio step for musical animation.
 * Uses a three-tier fallback: Native C++ -> AssemblyScript -> JavaScript
 * @param currentUnfurl - Current unfurl value
 * @param currentTarget - Current target step
 * @param lastTrigger - Previous trigger state
 * @param arpeggioActive - Whether arpeggio is active
 * @param noteTrigger - Current note trigger
 * @param maxSteps - Maximum number of steps
 * @returns Arpeggio values
 */
export function calcArpeggioStep(
    currentUnfurl: number, 
    currentTarget: number, 
    lastTrigger: boolean, 
    arpeggioActive: boolean, 
    noteTrigger: boolean, 
    maxSteps: number
): ArpeggioResult {
    // 1. Try Native C++ (fastest) - uses getNativeFunc which handles null checks
    const calcFn = getNativeFunc('calcArpeggioStep_c');
    if (calcFn) {
        calcFn(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        const getTarget = getNativeFunc('getArpeggioTargetStep_c');
        const getUnfurl = getNativeFunc('getArpeggioUnfurlStep_c');
        if (getTarget && getUnfurl) {
            arpeggioResult.targetStep = getTarget();
            arpeggioResult.unfurlStep = getUnfurl();
            return arpeggioResult;
        }
    }

    // 2. Try AssemblyScript - check for export existence
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcArpeggioStep && exports?.getArpeggioTargetStep && exports?.getArpeggioUnfurlStep) {
        exports.calcArpeggioStep(currentUnfurl, currentTarget, lastTrigger ? 1 : 0, arpeggioActive ? 1 : 0, noteTrigger ? 1 : 0, maxSteps);
        arpeggioResult.targetStep = exports.getArpeggioTargetStep();
        arpeggioResult.unfurlStep = exports.getArpeggioUnfurlStep();
        return arpeggioResult;
    }

    // 3. JavaScript Fallback - identical algorithm
    let nextTarget = currentTarget;
    if (arpeggioActive) {
        if (noteTrigger && !lastTrigger) {
            nextTarget = Math.min(maxSteps, nextTarget + 1);
        }
    } else {
        nextTarget = 0;
    }
    const speed = (nextTarget > currentUnfurl) ? 0.3 : 0.05;
    const nextUnfurl = currentUnfurl + (nextTarget - currentUnfurl) * speed;

    arpeggioResult.targetStep = nextTarget;
    arpeggioResult.unfurlStep = nextUnfurl;
    return arpeggioResult;
}

/**
 * Calculate speaker pulse animation.
 * @param time - Current time
 * @param kick - Audio kick value
 * @param intensity - Animation intensity
 * @returns Scale value
 */
export function calcSpeakerPulse(time: number, kick: number, intensity: number): number {
    // Try native C++ wrapper first
    const f = getNativeFunc('calcSpeakerPulse');
    if (f) {
        f(time, kick, intensity);
        const getScale = getNativeFunc('getSpeakerScale');
        if (getScale) {
            return getScale();
        }
    }

    // JavaScript Fallback
    const pulse = kick * 0.4 * intensity;
    const breathe = Math.sin(time * 2.0) * 0.05;
    return 1.0 + pulse + breathe;
}

// =============================================================================
// PARTICLE EFFECTS
// =============================================================================

/**
 * Calculate floating particle position.
 * @param baseX - Base X position
 * @param baseY - Base Y position
 * @param baseZ - Base Z position
 * @param time - Current time
 * @param offset - Phase offset
 * @param amplitude - Movement amplitude
 * @returns Particle position
 */
export function calcFloatingParticle(baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number): ParticleResult {
    // Check for all required WASM exports
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcFloatingParticle && exports?.getParticleX && exports?.getParticleY && exports?.getParticleZ) {
        exports.calcFloatingParticle(baseX, baseY, baseZ, time, offset, amplitude);
        particleResult.x = exports.getParticleX();
        particleResult.y = exports.getParticleY();
        particleResult.z = exports.getParticleZ();
    } else {
        // JavaScript fallback
        const t = time + offset;
        particleResult.x = baseX + Math.sin(t * 0.5) * amplitude;
        particleResult.y = baseY + Math.sin(t * 0.7) * amplitude * 0.5;
        particleResult.z = baseZ + Math.cos(t * 0.6) * amplitude;
    }
    return particleResult;
}

/**
 * Calculate rain drop Y position with cycling.
 * @param startY - Starting Y position
 * @param time - Current time
 * @param speed - Fall speed
 * @param cycleHeight - Height before cycling
 * @returns Current Y position
 */
export function calcRainDropY(startY: number, time: number, speed: number, cycleHeight: number): number {
    // Check for WASM export
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.calcRainDropY) {
        return exports.calcRainDropY(startY, time, speed, cycleHeight);
    }
    // JavaScript fallback
    const totalDrop = time * speed;
    const cycled = totalDrop % cycleHeight;
    return startY - cycled;
}

// =============================================================================
// COLOR UTILITIES
// =============================================================================

/**
 * Linearly interpolate between two colors.
 * @param color1 - First color (0xRRGGBB)
 * @param color2 - Second color (0xRRGGBB)
 * @param t - Interpolation factor (0-1)
 * @returns Interpolated color
 */
export function lerpColor(color1: number, color2: number, t: number): number {
    // Check for WASM export
    const exports = wasmInstance?.exports as WasmExports | undefined;
    if (exports?.lerpColor) {
        return exports.lerpColor(color1, color2, t);
    }
    // JavaScript fallback
    const r1 = (color1 >> 16) & 0xFF, g1 = (color1 >> 8) & 0xFF, b1 = color1 & 0xFF;
    const r2 = (color2 >> 16) & 0xFF, g2 = (color2 >> 8) & 0xFF, b2 = color2 & 0xFF;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}
