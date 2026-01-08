#include <emscripten.h>
#include <cmath>
#include <algorithm>
// #include "omp.h"

// =================================================================================
// GLOBAL STATE FOR RESULTS
// =================================================================================
// We use global variables to store results, which are then retrieved by JS
// via getter functions. This avoids complex struct passing across the WASM boundary.

// Speaker Results
float speakerYOffset = 0.0f;
float speakerScaleX = 1.0f;
float speakerScaleY = 1.0f;
float speakerScaleZ = 1.0f;

// Accordion Results
float accordionStretchY = 1.0f;
float accordionWidthXZ = 1.0f;

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
int arpeggioTargetStep = 0;
float arpeggioUnfurlStep = 0.0f;

extern "C" {

// =================================================================================
// SPEAKER PULSE
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcSpeakerPulse(float time, float offset, float kick) {
    speakerYOffset = sin(time + offset) * 0.2f;
    float pump = kick * 0.5f;
    speakerScaleX = 1.0f + pump * 0.2f;
    speakerScaleY = 1.0f - pump * 0.5f;
    speakerScaleZ = 1.0f + pump * 0.2f;
}

EMSCRIPTEN_KEEPALIVE
float getSpeakerYOffset() { return speakerYOffset; }
EMSCRIPTEN_KEEPALIVE
float getSpeakerScaleX() { return speakerScaleX; }
EMSCRIPTEN_KEEPALIVE
float getSpeakerScaleY() { return speakerScaleY; }
EMSCRIPTEN_KEEPALIVE
float getSpeakerScaleZ() { return speakerScaleZ; }

// =================================================================================
// ACCORDION STRETCH
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcAccordionStretch(float animTime, float offset, float intensity) {
    float rawStretch = sin(animTime * 10.0f + offset);
    // fmaxf is the float version of max
    float stretch = fmaxf(0.0f, rawStretch); 
    
    accordionStretchY = 1.0f + stretch * 0.3f * intensity;
    // Volume preservation (approximate)
    accordionWidthXZ = 1.0f / sqrt(accordionStretchY);
}

EMSCRIPTEN_KEEPALIVE
float getAccordionStretchY() { return accordionStretchY; }
EMSCRIPTEN_KEEPALIVE
float getAccordionWidthXZ() { return accordionWidthXZ; }

// =================================================================================
// FIBER WHIP
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcFiberWhip(float time, float offset, float leadVol, int isActive, float branchIndex) {
    fiberBaseRotY = sin(time * 0.5f + offset) * 0.1f;
    
    float whip = leadVol * 2.0f;
    float childOffset = branchIndex * 0.5f;
    float baseAngle = 0.785398f; // PI/4 approx
    
    fiberBranchRotZ = baseAngle + sin(time * 2.0f + childOffset) * 0.1f;
    
    if (isActive) {
        fiberBranchRotZ += sin(time * 10.0f + childOffset) * whip;
    }
}

EMSCRIPTEN_KEEPALIVE
float getFiberBaseRotY() { return fiberBaseRotY; }
EMSCRIPTEN_KEEPALIVE
float getFiberBranchRotZ() { return fiberBranchRotZ; }

// =================================================================================
// HOP (Returns float directly)
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
    // High frequency vibration
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
    
    // Hue cycle (0.0 to 1.0)
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
// ARPEGGIO LOGIC (The Missing Functions)
// =================================================================================
EMSCRIPTEN_KEEPALIVE
void calcArpeggioStep_c(float currentUnfurl, int currentTarget, int lastTrigger, int arpeggioActive, int noteTrigger, int maxSteps) {
    int nextTarget = currentTarget;
    
    if (arpeggioActive) {
        // If note triggered this frame and wasn't triggered last frame
        if (noteTrigger && !lastTrigger) {
            nextTarget = nextTarget + 1;
            if (nextTarget > maxSteps) nextTarget = maxSteps;
        }
    } else {
        // Reset if inactive
        nextTarget = 0;
    }

    // Smooth interpolation (Lerp)
    // Unfurl faster (0.3) when growing, slower (0.05) when shrinking
    float speed = (float(nextTarget) > currentUnfurl) ? 0.3f : 0.05f;
    float diff = float(nextTarget) - currentUnfurl;
    float nextUnfurl = currentUnfurl + diff * speed;

    // Store in global state
    arpeggioTargetStep = nextTarget;
    arpeggioUnfurlStep = nextUnfurl;
}

EMSCRIPTEN_KEEPALIVE
int getArpeggioTargetStep_c() {
    return arpeggioTargetStep;
}

EMSCRIPTEN_KEEPALIVE
float getArpeggioUnfurlStep_c() {
    return arpeggioUnfurlStep;
}

} // extern "C"
