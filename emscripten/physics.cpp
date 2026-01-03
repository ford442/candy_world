#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include <vector>
#include "./omp.h"

extern "C" float fastInvSqrt(float x);

extern "C" {

// =============================================================================
// PLAYER & PHYSICS SYSTEM
// =============================================================================

struct Player {
    float x, y, z;
    float vx, vy, vz;
    float radius;
    float gravity;
    float energy;
    float maxEnergy;
};

struct Obstacle {
    int type; // 0: Mushroom, 1: Cloud, 2: Trampoline
    float x, y, z;
    float radius;
    float height; // For mushrooms (stem height) or cloud thickness
    float param1; // Stem Radius (mush) or Bounce Height
    float param2; // Cap Radius (mush) or Tier (cloud)
    float param3; // isTrampoline (bool)
};

// Global State
Player player = {0, 0, 0, 0, 0, 0, 0.5f, 20.0f, 0, 10.0f};
std::vector<Obstacle> obstacles;
// Simple grid for spatial hashing could be added here
// For now, vector iteration is O(N) but N is small (1000ish) which is fine for C++
// compared to JS overhead.

EMSCRIPTEN_KEEPALIVE
void initPhysics(float x, float y, float z) {
    player.x = x;
    player.y = y;
    player.z = z;
    obstacles.clear();
}

EMSCRIPTEN_KEEPALIVE
void addObstacle(int type, float x, float y, float z, float r, float h, float p1, float p2, float p3) {
    obstacles.push_back({type, x, y, z, r, h, p1, p2, p3});
}

EMSCRIPTEN_KEEPALIVE
void setPlayerState(float x, float y, float z, float vx, float vy, float vz) {
    player.x = x;
    player.y = y;
    player.z = z;
    player.vx = vx;
    player.vy = vy;
    player.vz = vz;
}

EMSCRIPTEN_KEEPALIVE
float getPlayerX() { return player.x; }
EMSCRIPTEN_KEEPALIVE
float getPlayerY() { return player.y; }
EMSCRIPTEN_KEEPALIVE
float getPlayerZ() { return player.z; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVX() { return player.vx; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVY() { return player.vy; }
EMSCRIPTEN_KEEPALIVE
float getPlayerVZ() { return player.vz; }

// Helper for ground height (simple flat plane for now, or imported)
// In real app, we might pass a pointer to heightmap or call JS.
// For now, assuming ground is at Y=0 (or we call out).
// Actually, `getGroundHeight` is WASM exported from here usually!
// But math.cpp likely has the noise function.
// We'll declare it:
extern float getGroundHeight(float x, float z);

EMSCRIPTEN_KEEPALIVE
int updatePhysicsCPP(float delta, float inputX, float inputZ, float speed, int jump, int sprint, int sneak, float grooveGravity) {
    // Apply Gravity (scaled by groove)
    float currentGravity = player.gravity * grooveGravity;
    player.vy -= currentGravity * delta;

    // Movement
    float targetVX = inputX * speed;
    float targetVZ = inputZ * speed;

    // Smoothing
    float smooth = 15.0f * delta;
    if (smooth > 1.0f) smooth = 1.0f;
    player.vx += (targetVX - player.vx) * smooth;
    player.vz += (targetVZ - player.vz) * smooth;

    // Predicted position
    float nextX = player.x + player.vx * delta;
    float nextY = player.y + player.vy * delta;
    float nextZ = player.z + player.vz * delta;

    int onGround = 0;

    // Obstacle Collision
    for (const auto& obj : obstacles) {
        float dx = nextX - obj.x;
        float dz = nextZ - obj.z;
        float distH = std::sqrt(dx*dx + dz*dz);

        if (obj.type == 0) { // Mushroom
            float stemR = obj.param1;
            float capR = obj.param2;
            float capH = obj.height; // Height of stem top relative to pos.y (which is base)
            float surfaceY = obj.y + capH;

            // Stem Collision
            if (nextY < surfaceY - 0.5f) {
                 float minDist = stemR + player.radius;
                 if (distH < minDist) {
                     float angle = std::atan2(dz, dx);
                     float pushX = std::cos(angle) * minDist;
                     float pushZ = std::sin(angle) * minDist;
                     nextX = obj.x + pushX;
                     nextZ = obj.z + pushZ;
                 }
            }
            // Cap Collision (Landing)
            else if (player.vy < 0 && distH < capR) {
                 if (nextY >= surfaceY - 0.5f && nextY <= surfaceY + 2.0f) {
                     if (obj.param3 > 0.5f) { // Trampoline
                         player.vy = 15.0f; // Bounce
                         onGround = 2; // Special Bounce State
                     } else {
                         nextY = surfaceY + 1.8f; // Land
                         player.vy = 0;
                         onGround = 1;
                     }
                 }
            }
        }
        else if (obj.type == 1) { // Cloud
            // Simple cloud floor logic
            if (obj.param2 < 1.5f) { // Tier 1
                float topY = obj.y + obj.height; // approximate
                float radius = obj.radius;
                if (distH < radius) {
                    if (player.vy < 0 && nextY >= topY - 0.5f && nextY < topY + 3.0f) {
                        nextY = topY + 1.8f;
                        player.vy = 0;
                        onGround = 1;
                    }
                }
            }
        }
        else if (obj.type == 2) { // Trampoline (Flower)
            float bounceTop = obj.y + obj.height;
            if (distH < obj.radius && nextY > bounceTop - 0.5f && nextY < bounceTop + 1.5f) {
                if (player.vy < 0) {
                     player.vy = obj.param1; // bounce force
                     onGround = 2;
                }
            }
        }
    }

    // Ground Collision - using getGroundHeight from math.cpp
    float groundY = getGroundHeight(nextX, nextZ);
    
    // Check if player is at or below ground level (1.8f is player eye height)
    if (nextY < groundY + 1.8f && player.vy <= 0) {
        nextY = groundY + 1.8f;
        player.vy = 0;
        onGround = 1;
    }

    // Apply
    player.x = nextX;
    player.y = nextY;
    player.z = nextZ;

    // Jump
    if (onGround == 1 && jump) {
        player.vy = 10.0f;
    }

    return onGround;
}


// =============================================================================
// LEGACY PARTICLE SYSTEM (Kept for compatibility)
// =============================================================================

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
    #pragma omp parallel for simd schedule(static)
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
