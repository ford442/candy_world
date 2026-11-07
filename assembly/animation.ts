// Arpeggio state machine. The scalar animation calculators that lived here
// (bounce, sway, wobble, fiber whip, spiral, prism, particles, and
// updateFoliageBatch) had no caller and were deleted (#2026).

// =============================================================================
// ARPEGGIO FUNCTIONS (Batch Processing Step)
// =============================================================================

let arpeggioUnfurlStep: f32 = 0.0;
let arpeggioTargetStep: f32 = 0.0;

/**
 * Calculates the Arpeggio State Machine logic
 * returns nothing (uses global getters to retrieve multiple values)
 *
 * Logic:
 * if (arpeggioActive) {
 *    if (noteTrigger && !lastTrigger) targetStep++
 * } else {
 *    targetStep = 0
 * }
 * lerp unfurlStep -> targetStep
 */
export function calcArpeggioStep(
    currentUnfurl: f32,
    currentTarget: f32,
    lastTrigger: i32,     // bool 0/1
    arpeggioActive: i32,  // bool 0/1
    noteTrigger: i32,     // bool 0/1
    maxSteps: f32
): void {
    let nextTarget = currentTarget;

    if (arpeggioActive != 0) {
        // Rising edge check
        if ((noteTrigger != 0) && (lastTrigger == 0)) {
            nextTarget = nextTarget + 1.0;
            if (nextTarget > maxSteps) nextTarget = maxSteps;
        }
    } else {
        nextTarget = 0.0;
    }

    // Smooth animate
    const speed: f32 = (nextTarget > currentUnfurl) ? 0.3 : 0.05;

    // Lerp
    const diff = nextTarget - currentUnfurl;
    const nextUnfurl = currentUnfurl + (diff * speed);

    // Store results
    arpeggioTargetStep = nextTarget;
    arpeggioUnfurlStep = nextUnfurl;
}

export function getArpeggioTargetStep(): f32 { return arpeggioTargetStep; }
export function getArpeggioUnfurlStep(): f32 { return arpeggioUnfurlStep; }
