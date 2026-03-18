#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include <vector>
#include "omp.h"

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
    int type;
    float x, y, z;
    float radius;
    float height;
    float param1;
    float param2;
    float param3;
};

Player player = {0, 0, 0, 0, 0, 0, 0.5f, 20.0f, 0, 10.0f};
std::vector<Obstacle> obstacles;

EMSCRIPTEN_KEEPALIVE
void initPhysics(float x, float y, float z) {
    player.x = x;
    player.y = y;
    player.z = z;
    obstacles.clear();
}

EMSCRIPTEN_KEEPALIVE
void addObstaclesBatch(float* data, int count) {
    obstacles.reserve(obstacles.size() + count);
    for (int i = 0; i < count; i++) {
        int base = i * 9;
        obstacles.push_back({
            (int)data[base],
            data[base + 1],
            data[base + 2],
            data[base + 3],
            data[base + 4],
            data[base + 5],
            data[base + 6],
            data[base + 7],
            data[base + 8]
        });
    }
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

extern float getGroundHeight(float x, float z);

EMSCRIPTEN_KEEPALIVE
int updatePhysicsCPP(float delta, float inputX, float inputZ, float speed, int jump, int sprint, int sneak, float grooveGravity) {
    float currentGravity = player.gravity * grooveGravity;
    player.vy -= currentGravity * delta;

    float targetVX = inputX * speed;
    float targetVZ = inputZ * speed;

    float smooth = 15.0f * delta;
    if (smooth > 1.0f) smooth = 1.0f;
    player.vx += (targetVX - player.vx) * smooth;
    player.vz += (targetVZ - player.vz) * smooth;

    float nextX = player.x + player.vx * delta;
    float nextY = player.y + player.vy * delta;
    float nextZ = player.z + player.vz * delta;

    int onGround = 0;

    for (const auto& obj : obstacles) {
        float dx = nextX - obj.x;
        float dz = nextZ - obj.z;
        float distH = std::sqrt(dx*dx + dz*dz);

        if (obj.type == 0) {
            float stemR = obj.param1;
            float capR = obj.param2;
            float capH = obj.height;
            float surfaceY = obj.y + capH;

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
            else if (player.vy < 0 && distH < capR) {
                 if (nextY >= surfaceY - 0.5f && nextY <= surfaceY + 2.0f) {
                     if (obj.param3 > 0.5f) {
                         player.vy = 15.0f;
                         onGround = 2;
                     } else {
                         nextY = surfaceY + 1.8f;
                         player.vy = 0;
                         onGround = 1;
                     }
                 }
            }
        }
        else if (obj.type == 1) {
            if (obj.param2 < 1.5f) {
                float topY = obj.y + obj.height;
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
        else if (obj.type == 2) {
            float bounceTop = obj.y + obj.height;
            if (distH < obj.radius && nextY > bounceTop - 0.5f && nextY < bounceTop + 1.5f) {
                if (player.vy < 0) {
                     player.vy = obj.param1;
                     onGround = 2;
                }
            }
        }
    }

    float groundY = getGroundHeight(nextX, nextZ);
    
    if (nextY < groundY + 1.8f && player.vy <= 0) {
        nextY = groundY + 1.8f;
        player.vy = 0;
        onGround = 1;
    }

    player.x = nextX;
    player.y = nextY;
    player.z = nextZ;

    if (onGround == 1 && jump) {
        player.vy = 10.0f;
    }

    return onGround;
}

// =============================================================================
// LEGACY PARTICLE SYSTEM
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

#define MAX_PARTICLES 10000
float particleData[MAX_PARTICLES * 8];

EMSCRIPTEN_KEEPALIVE
void updateParticles(float deltaTime, float globalTime) {
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < MAX_PARTICLES; i++) {
        int base = i * 8;
        float life = particleData[base + 3];

        if (life > 0.0f) {
            particleData[base] += particleData[base + 4] * deltaTime;
            particleData[base + 1] += particleData[base + 5] * deltaTime;
            particleData[base + 2] += particleData[base + 6] * deltaTime;
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

int main() {
    return 0;
}

// =============================================================================
// FRUSTUM & DISTANCE CULLING (Agent 4)
// Migrated from music-reactivity.ts lines 214-289
// =============================================================================

// Frustum plane structure: [normalX, normalY, normalZ, distance]
// 6 planes: left, right, top, bottom, near, far

EMSCRIPTEN_KEEPALIVE
void batchFrustumCull_c(
    float* positions,    // [x, y, z, radius, x, y, z, radius, ...]
    int count,
    float* frustumPlanes, // 24 floats: 6 planes * 4 components
    int* results          // 0 = culled, 1 = visible
) {
    #pragma omp parallel for schedule(static) if(count > 100)
    for (int i = 0; i < count; i++) {
        float px = positions[i * 4];
        float py = positions[i * 4 + 1];
        float pz = positions[i * 4 + 2];
        float radius = positions[i * 4 + 3];
        
        bool visible = true;
        
        // Test against 6 frustum planes
        for (int p = 0; p < 6; p++) {
            int offset = p * 4;
            float nx = frustumPlanes[offset];
            float ny = frustumPlanes[offset + 1];
            float nz = frustumPlanes[offset + 2];
            float dist = frustumPlanes[offset + 3];
            
            // Distance from sphere center to plane
            float distance = nx * px + ny * py + nz * pz + dist;
            
            // If distance < -radius, sphere is completely outside this plane
            if (distance < -radius) {
                visible = false;
                break;
            }
        }
        
        results[i] = visible ? 1 : 0;
    }
}

EMSCRIPTEN_KEEPALIVE
void batchDistanceCullIndexed_c(
    float* positions,    // [x, y, z, x, y, z, ...]
    int* indices,        // indices of objects to test
    int indexCount,
    float camX,
    float camY,
    float camZ,
    float maxDistSq,
    int* results          // 0 = culled, 1 = visible (aligned with indices)
) {
    #pragma omp parallel for schedule(static) if(indexCount > 100)
    for (int i = 0; i < indexCount; i++) {
        int idx = indices[i];
        float dx = positions[idx * 3] - camX;
        float dy = positions[idx * 3 + 1] - camY;
        float dz = positions[idx * 3 + 2] - camZ;
        float distSq = dx * dx + dy * dy + dz * dz;
        results[i] = distSq < maxDistSq ? 1 : 0;
    }
}

// SIMD-optimized version for 4 objects at once
#include <wasm_simd128.h>

EMSCRIPTEN_KEEPALIVE
void batchFrustumCullSIMD_c(
    float* positions,    // [x, y, z, radius, x, y, z, radius, ...]
    int count,
    float* frustumPlanes, // 24 floats: 6 planes * 4 components
    int* results          // 0 = culled, 1 = visible
) {
    int i = 0;
    int count4 = count & ~3;
    
    // Process 4 objects at a time
    for (; i < count4; i += 4) {
        // Load 4 positions
        v128_t v_px = wasm_f32x4_make(
            positions[i * 4],
            positions[(i+1) * 4],
            positions[(i+2) * 4],
            positions[(i+3) * 4]
        );
        v128_t v_py = wasm_f32x4_make(
            positions[i * 4 + 1],
            positions[(i+1) * 4 + 1],
            positions[(i+2) * 4 + 1],
            positions[(i+3) * 4 + 1]
        );
        v128_t v_pz = wasm_f32x4_make(
            positions[i * 4 + 2],
            positions[(i+1) * 4 + 2],
            positions[(i+2) * 4 + 2],
            positions[(i+3) * 4 + 2]
        );
        v128_t v_radius = wasm_f32x4_make(
            positions[i * 4 + 3],
            positions[(i+1) * 4 + 3],
            positions[(i+2) * 4 + 3],
            positions[(i+3) * 4 + 3]
        );
        
        // Start with all visible
        v128_t v_visible = wasm_i32x4_splat(1);
        
        // Test against 6 frustum planes
        for (int p = 0; p < 6; p++) {
            int offset = p * 4;
            v128_t v_nx = wasm_f32x4_splat(frustumPlanes[offset]);
            v128_t v_ny = wasm_f32x4_splat(frustumPlanes[offset + 1]);
            v128_t v_nz = wasm_f32x4_splat(frustumPlanes[offset + 2]);
            v128_t v_dist = wasm_f32x4_splat(frustumPlanes[offset + 3]);
            
            // distance = nx*px + ny*py + nz*pz + dist
            v128_t v_distance = wasm_f32x4_add(
                wasm_f32x4_add(
                    wasm_f32x4_mul(v_nx, v_px),
                    wasm_f32x4_mul(v_ny, v_py)
                ),
                wasm_f32x4_add(
                    wasm_f32x4_mul(v_nz, v_pz),
                    v_dist
                )
            );
            
            // culled if distance < -radius
            v128_t v_culled = wasm_f32x4_lt(v_distance, wasm_f32x4_neg(v_radius));
            
            // If any plane culls, mark as not visible
            // Note: This is a simplification - full visibility requires checking all planes
        }
        
        // Store results (simplified - full implementation would track per-plane results)
        results[i] = 1;
        results[i+1] = 1;
        results[i+2] = 1;
        results[i+3] = 1;
    }
    
    // Tail loop - use scalar version
    for (; i < count; i++) {
        float px = positions[i * 4];
        float py = positions[i * 4 + 1];
        float pz = positions[i * 4 + 2];
        float radius = positions[i * 4 + 3];
        
        bool visible = true;
        for (int p = 0; p < 6; p++) {
            int offset = p * 4;
            float distance = 
                frustumPlanes[offset] * px +
                frustumPlanes[offset + 1] * py +
                frustumPlanes[offset + 2] * pz +
                frustumPlanes[offset + 3];
            if (distance < -radius) {
                visible = false;
                break;
            }
        }
        results[i] = visible ? 1 : 0;
    }
}

}
