/**
 * @file animation.cpp
 * @brief Candy World Animation Functions - C++/Emscripten WASM Module
 * 
 * This file contains all animation calculation functions exported to JavaScript via
 * Emscripten/WebAssembly. Each function uses EMSCRIPTEN_KEEPALIVE to ensure the
 * function is not stripped during optimization and remains available as an export.
 * 
 * ## EXPORT MECHANISM
 * 
 * EMSCRIPTEN_KEEPALIVE:
 * - Prevents DCE (Dead Code Elimination) from removing the function
 * - Ensures the function appears in the WASM module's export table
 * - Functions are exported with a leading underscore (e.g., _calcFiberWhip)
 * - The wasm-loader.js uses getNativeFunc('calcFiberWhip') which prepends '_'
 * 
 * ## FALLBACK SYSTEM
 * 
 * If a function is NOT exported (e.g., due to build issues or missing implementation),
 * the JavaScript wasm-loader.js will automatically use a pure JavaScript fallback.
 * This ensures the application never crashes due to missing WASM exports.
 * 
 * ## ADDING NEW FUNCTIONS
 * 
 * 1. Implement the function in this file with EMSCRIPTEN_KEEPALIVE
 * 2. Add the export name (with leading underscore) to EXPORTS in build.sh
 * 3. Add a corresponding JS fallback in wasm-loader.js
 * 4. Run the build and verify with: node emscripten/verify_build.js
 * 
 * @author Candy World Team
 * @see build.sh for the build configuration
 * @see src/utils/wasm-loader.js for JavaScript wrappers and fallbacks
 */

#include <emscripten.h>
#include <cmath>
#include <algorithm>

// =================================================================================
// GLOBAL STATE FOR RESULTS
// 
// These global variables store computed results from multi-return functions.
// The pattern is: call a calc*() function, then read individual values via get*() functions.
// This avoids complex memory management for returning structs to JavaScript.
// =================================================================================



// Fiber Results
float fiberBaseRotY = 0.0f;
float fiberBranchRotZ = 0.0f;

// Shiver Results
float shiverRotX = 0.0f;
float shiverRotZ = 0.0f;

// Spiral Results
float spiralRotY = 0.0f;
float spiralYOffset = 0.0f;
float spiralScale = 1.0f;

// Prism Results
float prismUnfurl = 0.0f;
float prismSpin = 0.0f;
float prismPulse = 1.0f;
float prismHue = 0.0f;

// Particle Results
float particleX = 0.0f;
float particleY = 0.0f;
float particleZ = 0.0f;

// Arpeggio Results
float arpeggioResult[2]; // [targetStep, unfurlStep]

// Wobble Results
float wobbleRotX = 0.0f;
float wobbleRotZ = 0.0f;

// Accordion Results
float accordionStretchY = 1.0f;
float accordionWidthXZ = 1.0f;

extern "C" {

// =================================================================================
// FIBER WHIP
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcFiberWhip(float time, float offset, float leadVol, int isActive, int branchIndex) {
    fiberBaseRotY = std::sin(time * 0.5f + offset) * 0.1f;
    
    float whip = leadVol * 2.0f;
    float childOffset = branchIndex * 0.5f;
    
    // Default rotation ~PI/4
    fiberBranchRotZ = 0.785f + std::sin(time * 2.0f + childOffset) * 0.1f; 
    
    if (isActive) {
        fiberBranchRotZ += std::sin(time * 10.0f + childOffset) * whip;
    }
}

EMSCRIPTEN_KEEPALIVE
float getFiberBaseRotY() { return fiberBaseRotY; }
EMSCRIPTEN_KEEPALIVE
float getFiberBranchRotZ() { return fiberBranchRotZ; }

// =================================================================================
// HOP
// =================================================================================
EMSCRIPTEN_KEEPALIVE
float calcHopY(float time, float offset, float intensity, float kick) {
    float animTime = time + offset;
    float hopVal = sin(animTime * 4.0f);
    float bounce = fmaxf(0.0f, hopVal) * 0.3f * intensity;
    if (kick > 0.1f) {
        bounce += kick * 0.15f;
    }
    return bounce;
}

// =================================================================================
// SHIVER
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcShiver(float time, float offset, float intensity) {
    float animTime = time + offset;
    shiverRotX = sin(animTime * 20.0f) * 0.02f * intensity;
    shiverRotZ = cos(animTime * 20.0f) * 0.02f * intensity;
}

EMSCRIPTEN_KEEPALIVE
float getShiverRotX() { return shiverRotX; }
EMSCRIPTEN_KEEPALIVE
float getShiverRotZ() { return shiverRotZ; }

// =================================================================================
// SPIRAL WAVE
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcSpiralWave(float time, float offset, float intensity, float groove) {
    float animTime = time + offset;
    spiralRotY = sin(animTime * 2.0f) * 0.2f * intensity;
    spiralYOffset = sin(animTime * 3.0f) * 0.1f * (1.0f + groove);
    spiralScale = 1.0f + sin(animTime * 4.0f) * 0.05f * intensity;
}

EMSCRIPTEN_KEEPALIVE
float getSpiralRotY() { return spiralRotY; }
EMSCRIPTEN_KEEPALIVE
float getSpiralYOffset() { return spiralYOffset; }
EMSCRIPTEN_KEEPALIVE
float getSpiralScale() { return spiralScale; }

// =================================================================================
// PRISM ROSE
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcPrismRose(float time, float offset, float kick, float groove, int isActive) {
    float animTime = time + offset;
    float intensity = isActive ? (1.0f + groove * 3.0f) : 0.3f;
    
    prismUnfurl = sin(animTime * 2.0f) * 0.1f * intensity;
    prismSpin = animTime * 0.5f + groove * 2.0f;
    prismPulse = 1.0f + kick * 0.3f;
    
    float hueRaw = animTime * 0.1f;
    prismHue = hueRaw - floor(hueRaw);
}

EMSCRIPTEN_KEEPALIVE
float getPrismUnfurl() { return prismUnfurl; }
EMSCRIPTEN_KEEPALIVE
float getPrismSpin() { return prismSpin; }
EMSCRIPTEN_KEEPALIVE
float getPrismPulse() { return prismPulse; }
EMSCRIPTEN_KEEPALIVE
float getPrismHue() { return prismHue; }

// =================================================================================
// FLOATING PARTICLE
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcFloatingParticle(float baseX, float baseY, float baseZ, float time, float offset, float amplitude) {
    float t = time + offset;
    particleX = baseX + sin(t * 0.5f) * amplitude;
    particleY = baseY + sin(t * 0.7f) * amplitude * 0.5f;
    particleZ = baseZ + cos(t * 0.6f) * amplitude;
}

EMSCRIPTEN_KEEPALIVE
float getParticleX() { return particleX; }
EMSCRIPTEN_KEEPALIVE
float getParticleY() { return particleY; }
EMSCRIPTEN_KEEPALIVE
float getParticleZ() { return particleZ; }

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

// =================================================================================
// SPEAKER PULSE
// =================================================================================
float speakerScale = 1.0f;

EMSCRIPTEN_KEEPALIVE
void calcSpeakerPulse(float time, float kick, float intensity) {
    float pulse = kick * 0.4f * intensity;
    float breathe = sin(time * 2.0f) * 0.05f;
    speakerScale = 1.0f + pulse + breathe;
}

EMSCRIPTEN_KEEPALIVE
float getSpeakerScale() {
    return speakerScale;
}

// =================================================================================
// BOUNCE Y (Simple vertical bounce)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
float calcBounceY(float time, float offset, float intensity, float kick) {
    float animTime = time + offset;
    float yOffset = sin(animTime * 3.0f) * 0.1f * intensity;
    if (kick > 0.1f) {
        yOffset += kick * 0.2f;
    }
    return yOffset;
}

// =================================================================================
// SWAY ROT Z (Rotation Z sway)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
float calcSwayRotZ(float time, float offset, float intensity) {
    return sin(time + offset) * 0.1f * intensity;
}

// =================================================================================
// WOBBLE (X and Z rotation)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcWobble(float time, float offset, float intensity) {
    float animTime = time + offset;
    wobbleRotX = sin(animTime * 3.0f) * 0.15f * intensity;
    wobbleRotZ = cos(animTime * 3.0f) * 0.15f * intensity;
}

EMSCRIPTEN_KEEPALIVE
float getWobbleX() { return wobbleRotX; }
EMSCRIPTEN_KEEPALIVE
float getWobbleZ() { return wobbleRotZ; }

// =================================================================================
// ACCORDION STRETCH
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcAccordionStretch(float animTime, float offset, float intensity) {
    float rawStretch = sin(animTime * 10.0f + offset);
    accordionStretchY = 1.0f + fmaxf(0.0f, rawStretch) * 0.3f * intensity;
    accordionWidthXZ = 1.0f / sqrtf(accordionStretchY);
}

EMSCRIPTEN_KEEPALIVE
float getAccordionStretchY() { return accordionStretchY; }
EMSCRIPTEN_KEEPALIVE
float getAccordionWidthXZ() { return accordionWidthXZ; }

// =================================================================================
// RAIN DROP Y (Cycling fall)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
float calcRainDropY(float startY, float time, float speed, float cycleHeight) {
    float totalDrop = time * speed;
    float cycled = fmodf(totalDrop, cycleHeight);
    return startY - cycled;
}

// =================================================================================
// FLOATING Y (Simple sine wave float)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
float calcFloatingY(float time, float offset, float baseHeight) {
    return baseHeight + sin(time + offset) * 0.5f;
}

} // extern "C"
