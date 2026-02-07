/**
 * @file animation_batch.cpp
 * @brief SIMD-optimized batch animation processing - C++/Emscripten
 */

#include <emscripten.h>
#include <cmath>
#include <cstdint>
#include <algorithm>
#include "omp.h"

extern "C" {

constexpr int BATCH_SIZE = 4000;
constexpr int ENTRY_STRIDE = 6;
constexpr int RESULT_STRIDE = 4;

EMSCRIPTEN_KEEPALIVE
void batchSnareSnap_c(float* input, int count, float time, float snareTrigger, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float snapState = input[inBase + 4];
        
        if (snareTrigger > 0.2f) {
            if (snapState < 0.2f) snapState = 1.0f;
        } else {
            snapState = fmaxf(0.0f, snapState - 0.1f);
        }
        
        input[inBase + 4] = snapState;
        
        output[outBase] = 0.0f;
        output[outBase + 1] = snapState;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchAccordion_c(float* input, int count, float time, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float animTime = time + offset;
        float rawStretch = sinf(animTime * 10.0f);
        float stretchY = 1.0f + fmaxf(0.0f, rawStretch) * 0.31f * intensity;
        float widthXZ = 1.0f / sqrtf(stretchY);
        
        output[outBase] = stretchY;
        output[outBase + 1] = widthXZ;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchFiberWhip_c(float* input, int count, float time, float leadVol, int isActive, float* output) {
    float whip = leadVol * 2.0f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float branchIndex = input[inBase + 4];
        
        float baseRotY = sinf(time * 0.5f + offset) * 0.1f;
        float childOffset = branchIndex * 0.5f;
        float branchRotZ = 0.785398f + sinf(time * 2.0f + childOffset) * 0.1f;
        
        if (isActive) {
            branchRotZ += sinf(time * 10.0f + childOffset) * whip;
        }
        
        output[outBase] = baseRotY;
        output[outBase + 1] = branchRotZ;
        output[outBase + 2] = 0.0f;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchSpiralWave_c(float* input, int count, float time, float intensity, float groove, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float childIndex = (float)i;
        
        float animTime = time + offset + childIndex * 0.5f;
        float rotY = sinf(animTime * 2.0f) * 0.2f * intensity;
        float yOffset = sinf(animTime * 3.0f) * 0.1f * (1.0f + groove);
        float scale = 1.0f + sinf(animTime * 4.0f) * 0.05f * intensity;
        
        output[outBase] = rotY;
        output[outBase + 1] = yOffset;
        output[outBase + 2] = scale;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchVibratoShake_c(float* input, int count, float time, float vibratoAmount, float intensity, float* output) {
    float shakeSpeed = 50.0f + vibratoAmount * 100.0f;
    float shakeAmount = 0.05f + vibratoAmount * 0.25f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float phase = (float)i * 0.5f;
        
        float rotX = -1.5708f + sinf(time * shakeSpeed + phase) * shakeAmount;
        float rotY = cosf(time * shakeSpeed * 1.3f + phase) * shakeAmount * 0.8f;
        
        output[outBase] = rotX;
        output[outBase + 1] = rotY;
        output[outBase + 2] = shakeSpeed;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchTremoloPulse_c(float* input, int count, float time, float tremoloAmount, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        
        float pulseSpeed = 8.0f + tremoloAmount * 15.0f;
        float pulseAmount = 0.1f + tremoloAmount * 0.3f;
        float pulse = 1.0f + sinf(time * pulseSpeed + offset) * pulseAmount;
        
        float opacity = 0.7f + sinf(time * pulseSpeed + offset) * 0.2f * intensity;
        float emission = 0.3f + tremoloAmount * 0.7f;
        
        output[outBase] = pulse;
        output[outBase + 1] = opacity;
        output[outBase + 2] = emission;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchCymbalShake_c(float* input, int count, float time, float highFreq, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float rotZ = input[inBase + 4];
        float rotX = input[inBase + 5];
        
        if (highFreq > 0.05f) {
            float twitch = highFreq * 0.2f;
            float jitterSeed = time * 10.0f + (float)i;
            float jitterZ = sinf(jitterSeed) * twitch;
            float jitterX = cosf(jitterSeed * 1.3f) * twitch;
            rotZ = jitterZ;
            rotX = jitterX;
        } else {
            rotZ *= 0.9f;
            rotX *= 0.9f;
        }
        
        input[inBase + 4] = rotZ;
        input[inBase + 5] = rotX;
        
        float scale = 1.0f;
        if (highFreq > 0.4f) {
            scale = 1.0f + (highFreq - 0.4f) * 0.5f;
        }
        
        output[outBase] = rotZ;
        output[outBase + 1] = rotX;
        output[outBase + 2] = scale;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchPanningBob_c(float* input, int count, float time, float panActivity, float intensity, float* output) {
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float panBias = input[inBase + 4];
        
        float currentBob = input[inBase + 5];
        float nextBob = currentBob + (panActivity - currentBob) * 0.1f;
        input[inBase + 5] = nextBob;
        
        float bobHeight = nextBob * 1.5f * intensity;
        float posY = sinf(time * 2.0f + offset) * 0.1f + bobHeight;
        float rotZ = panBias * bobHeight * 0.2f;
        float glowIntensity = 0.6f + bobHeight * 0.8f;
        
        output[outBase] = posY;
        output[outBase + 1] = rotZ;
        output[outBase + 2] = glowIntensity;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchSpiritFade_c(float* input, int count, float time, float volume, float delta, float* output) {
    constexpr float threshold = 0.1f;
    
    #pragma omp parallel for schedule(static) if(count > 500)
    for (int i = 0; i < count; i++) {
        int inBase = i * ENTRY_STRIDE;
        int outBase = i * RESULT_STRIDE;
        
        float offset = input[inBase];
        float originalY = input[inBase + 2];
        
        float currentOpacity = input[inBase + 4];
        float fleeSpeed = input[inBase + 5];
        
        float targetOpacity = 0.0f;
        if (volume < threshold) {
            targetOpacity = 0.8f;
            fleeSpeed = fmaxf(0.0f, fleeSpeed - 0.01f);
        } else {
            targetOpacity = 0.0f;
            if (currentOpacity > 0.1f) {
                fleeSpeed = fminf(0.2f, fleeSpeed + 0.01f);
            }
        }
        
        currentOpacity = currentOpacity + (targetOpacity - currentOpacity) * 0.05f;
        
        input[inBase + 4] = currentOpacity;
        input[inBase + 5] = fleeSpeed;
        
        float posY = originalY + sinf(time * 1.5f + offset) * 0.2f;
        
        output[outBase] = currentOpacity;
        output[outBase + 1] = posY;
        output[outBase + 2] = fleeSpeed;
        output[outBase + 3] = 0.0f;
    }
}

EMSCRIPTEN_KEEPALIVE
void processBatchUniversal_c(
    int animType,
    float* input,
    int count,
    float time,
    float beatPhase,
    float kick,
    float groove,
    float audioParam,
    float* output
) {
    float animTime = time + beatPhase;
    float intensity = 1.0f + groove * 5.0f;
    
    switch (animType) {
        case 13:
            batchSnareSnap_c(input, count, time, audioParam, output);
            break;
        case 14:
            batchAccordion_c(input, count, time, intensity, output);
            break;
        case 15:
            batchFiberWhip_c(input, count, time, audioParam, 1, output);
            break;
        case 16:
            batchSpiralWave_c(input, count, time, intensity, groove, output);
            break;
        case 17:
            batchVibratoShake_c(input, count, time, audioParam, intensity, output);
            break;
        case 18:
            batchTremoloPulse_c(input, count, time, audioParam, intensity, output);
            break;
        case 19:
            batchCymbalShake_c(input, count, time, audioParam, intensity, output);
            break;
        case 20:
            batchPanningBob_c(input, count, time, audioParam, intensity, output);
            break;
        case 21:
            batchSpiritFade_c(input, count, time, audioParam, 0.016f, output);
            break;
    }
}

}
