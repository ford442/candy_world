#include <emscripten.h>
#include <cmath>
#include <cstdlib>

// Import declaration for the function in math.cpp
extern "C" float fastInvSqrt(float x);

extern "C" {

EMSCRIPTEN_KEEPALIVE
float fastDistance(float x1, float y1, float z1, float x2, float y2, float z2) {
    float dx = x2 - x1;
    float dy = y2 - y1;
    float dz = z2 - z1;
    float distSq = dx * dx + dy * dy + dz * dz;
    if (distSq < 0.0001f) return 0.0f;
    return distSq * fastInvSqrt(distSq);
}

EMSCRIPTEN_KEEPALIVE
float smoothDamp(float current, float target, float* velocity, float smoothTime, float deltaTime) {
    float omega = 2.0f / smoothTime;
    float x = omega * deltaTime;
    float exp = 1.0f / (1.0f + x + 0.48f * x * x + 0.235f * x * x * x);
    float change = current - target;
    float temp = (*velocity + omega * change) * deltaTime;
    *velocity = (*velocity - omega * temp) * exp;
    return target + (change + temp) * exp;
}

// Particle system constants
#define MAX_PARTICLES 10000
// Data layout: x, y, z, life, vx, vy, vz, speed (8 floats per particle)
float particleData[MAX_PARTICLES * 8];

EMSCRIPTEN_KEEPALIVE
void updateParticles(float deltaTime, float globalTime) {
    for (int i = 0; i < MAX_PARTICLES; i++) {
        int base = i * 8;
        float life = particleData[base + 3];

        if (life > 0.0f) {
            // Update position
            particleData[base] += particleData[base + 4] * deltaTime;     // x += vx
            particleData[base + 1] += particleData[base + 5] * deltaTime; // y += vy
            particleData[base + 2] += particleData[base + 6] * deltaTime; // z += vz

            // Decrease life
            particleData[base + 3] -= deltaTime;

            // Reset if dead (optional logic)
            if (particleData[base + 3] <= 0.0f) {
                 // Reset logic could go here
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
int checkCollision(float px, float py, float pz, float radius) {
    for (int i = 0; i < MAX_PARTICLES; i++) {
        int base = i * 8;
        if (particleData[base + 3] > 0.0f) {
            float dx = px - particleData[base];
            float dy = py - particleData[base + 1];
            float dz = pz - particleData[base + 2];
            float distSq = dx*dx + dy*dy + dz*dz;
            if (distSq < radius * radius) {
                return 1;
            }
        }
    }
    return 0;
}

// Dummy main 
int main() {
    return 0;
}

}
