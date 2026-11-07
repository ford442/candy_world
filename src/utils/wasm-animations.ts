/**
 * @file wasm-animations.ts
 * @brief Arpeggio step animation: native C++ -> AssemblyScript -> JavaScript
 *
 * The other scalar animation wrappers (bounce, sway, wobble, fiber whip, ...)
 * had no caller and were deleted with their C++ exports (#2026).
 */

import { 
    wasmInstance,
    getNativeFunc,
    type WasmExports 
} from './wasm-loader-core.ts';

/**
 * Arpeggio result
 */
export interface ArpeggioResult {
    targetStep: number;
    unfurlStep: number;
}

/** Reused result object (avoids an allocation per call) */
const arpeggioResult: ArpeggioResult = { targetStep: 0, unfurlStep: 0 };

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
