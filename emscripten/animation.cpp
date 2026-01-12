#include <emscripten.h>
#include <cmath>
#include <algorithm>

// =================================================================================
// GLOBAL STATE FOR RESULTS
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

extern "C" {

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

} // extern "C"
