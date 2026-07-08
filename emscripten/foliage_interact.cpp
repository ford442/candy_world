/**
 * @file foliage_interact.cpp
 * @brief Batch foliage ↔ player interaction checks (geysers, panning pads).
 *
 * Mirrors checkGeysers / checkPanningPads in physics-updates.ts.
 * Input arrays are packed Float32; outputs are small fixed-size result vectors.
 */
#include <emscripten.h>
#include <cmath>

extern "C" {

// -----------------------------------------------------------------------------
// Geyser launch — batch distance + height-band + velocity lerp
// Input per geyser (stride 5): x, y, z, eruptionStrength, maxHeight
// Output (4 floats): hit, vy, airJumpFlag, ungroundFlag
// -----------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void batchGeyserLaunch_c(
    float px, float py, float pz, float pvy, float delta,
    float* geysers, int count,
    float* out
) {
    float vy = pvy;
    int hit = 0;
    int airJump = 0;
    int unground = 0;

    const float radiusSq = 2.25f; // 1.5 * 1.5
    const float baseHeight = 0.5f;

    for (int i = 0; i < count; i++) {
        const int base = i * 5;
        const float gx = geysers[base];
        const float gy = geysers[base + 1];
        const float gz = geysers[base + 2];
        const float eruption = geysers[base + 3];
        const float maxHeight = geysers[base + 4];

        const float dx = px - gx;
        const float dz = pz - gz;
        const float distSq = dx * dx + dz * dz;
        if (distSq >= radiusSq) continue;

        const float activeHeight = maxHeight * eruption;
        const float minY = gy + baseHeight - 0.5f;
        const float maxY = gy + activeHeight + 1.0f;

        if (py < minY || py > maxY) continue;
        if (eruption <= 0.1f) continue;

        const float targetVel = 15.0f * eruption;
        if (vy < targetVel) {
            vy += (targetVel - vy) * 5.0f * delta;
        }
        hit = 1;
        airJump = 1;
        unground = 1;
    }

    out[0] = (float)hit;
    out[1] = vy;
    out[2] = (float)airJump;
    out[3] = (float)unground;
}

// -----------------------------------------------------------------------------
// Panning pad forces — first-match wins (matches TS early return)
// Input per pad (stride 6): x, y, z, scaleX, scaleY, currentBob
// Output (5 floats): hit, action (0=none 1=snap 2=launch), vy, snapY, padIndex
// -----------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void batchPadForces_c(
    float px, float py, float pz, float pvy,
    float* pads, int count,
    float* out
) {
    out[0] = 0.0f;
    out[1] = 0.0f;
    out[2] = pvy;
    out[3] = py;
    out[4] = -1.0f;

    for (int i = 0; i < count; i++) {
        const int base = i * 6;
        const float padX = pads[base];
        const float padY = pads[base + 1];
        const float padZ = pads[base + 2];
        const float scaleX = pads[base + 3];
        const float scaleY = pads[base + 4];
        const float currentBob = pads[base + 5];

        const float dx = px - padX;
        const float dz = pz - padZ;
        const float distSq = dx * dx + dz * dz;
        const float radius = 1.5f * scaleX;
        if (distSq >= radius * radius) continue;

        const float topY = padY + 0.1f * scaleY;
        if (pvy > 0.0f) continue;
        if (py < topY - 0.2f || py > topY + 0.5f) continue;

        out[0] = 1.0f;
        out[4] = (float)i;

        if (currentBob > 0.5f) {
            out[1] = 2.0f; // launch
            out[2] = 20.0f;
        } else {
            out[1] = 1.0f; // snap
            out[2] = 0.0f;
            out[3] = topY;
        }
        return;
    }
}

// -----------------------------------------------------------------------------
// Vine proximity — batch horizontal distance + vertical band (attach candidate)
// Input per vine (stride 4): anchorX, anchorY, anchorZ, length
// Output (3 floats): candidateIndex (-1 if none), nearestDistHSq, inAttachZone
// -----------------------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
void batchVineInteraction_c(
    float px, float py, float pz,
    float* vines, int count,
    float* out
) {
    float bestDistHSq = 1.0e30f;
    int bestIndex = -1;
    int inZone = 0;

    for (int i = 0; i < count; i++) {
        const int base = i * 4;
        const float ax = vines[base];
        const float ay = vines[base + 1];
        const float az = vines[base + 2];
        const float length = vines[base + 3];

        const float dx = px - ax;
        const float dz = pz - az;
        const float distHSq = dx * dx + dz * dz;
        const float tipY = ay - length;

        if (distHSq >= 4.0f) continue;
        if (py >= ay || py <= tipY) continue;

        if (distHSq < bestDistHSq) {
            bestDistHSq = distHSq;
            bestIndex = i;
            inZone = distHSq < 1.0f ? 1 : 0;
        }
    }

    out[0] = (float)bestIndex;
    out[1] = bestDistHSq;
    out[2] = (float)inZone;
}

}  // extern "C"
