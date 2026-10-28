/**
 * @file animation.cpp
 * @brief Arpeggio step state machine for src/utils/wasm-animations.ts
 *
 * calcArpeggioStep_c writes its two results to globals that the get*() calls
 * read back, which avoids returning a struct to JS. The other scalar
 * calculators (bounce, sway, wobble, fiber whip, shiver, spiral, prism,
 * speaker, particles, ...) had no caller and were deleted (#2026); the batch
 * foliage animations live in animation_batch.cpp.
 */

#include <emscripten.h>

// [targetStep, unfurlStep], read back by getArpeggio*Step_c()
static float arpeggioResult[2];

extern "C" {

// =================================================================================
// ARPEGGIO LOGIC
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcArpeggioStep_c(float currentUnfurl, float currentTarget, int lastTrigger, int arpeggioActive, int noteTrigger, float maxSteps) {
    float nextTarget = currentTarget;

    if (arpeggioActive != 0) {
        if (noteTrigger != 0 && lastTrigger == 0) {
            nextTarget += 1.0f;
            if (nextTarget > maxSteps) nextTarget = maxSteps;
        }
    } else {
        nextTarget = 0.0f;
    }

    float speed = (nextTarget > currentUnfurl) ? 0.3f : 0.05f;
    float diff = nextTarget - currentUnfurl;
    float nextUnfurl = currentUnfurl + (diff * speed);

    arpeggioResult[0] = nextTarget;
    arpeggioResult[1] = nextUnfurl;
}

EMSCRIPTEN_KEEPALIVE
float getArpeggioTargetStep_c() {
    return arpeggioResult[0];
}

EMSCRIPTEN_KEEPALIVE
float getArpeggioUnfurlStep_c() {
    return arpeggioResult[1];
}

} // extern "C"
