#include <emscripten.h>
#include <cmath>
#include <cstdlib>
#include <cstdint>

// Helper for random float [-0.5, 0.5]
float random_float() {
    return ((float)rand() / RAND_MAX) - 0.5f;
}

// Helper for positive random float [0, 1]
float random_float_pos() {
    return (float)rand() / RAND_MAX;
}

extern "C" {

EMSCRIPTEN_KEEPALIVE
void seedRandom(long seed) {
    srand(seed);
}

EMSCRIPTEN_KEEPALIVE
void initParticles(uintptr_t dataPtr, int count) {
    float* data = reinterpret_cast<float*>(dataPtr);
    for (int i = 0; i < count; i++) {
        int offset = i * 8;
        // 8 floats: x, y, z, life, vx, vy, vz, speed

        data[offset + 0] = random_float() * 50.0f;     // x: -25 to 25
        data[offset + 1] = random_float_pos() * 20.0f; // y: 0 to 20
        data[offset + 2] = random_float() * 50.0f;     // z: -25 to 25
        data[offset + 3] = random_float_pos();         // life: 0 to 1
        data[offset + 4] = random_float() * 2.0f;      // vx: -1 to 1
        data[offset + 5] = random_float_pos() * 5.0f;  // vy: 0 to 5
        data[offset + 6] = random_float() * 2.0f;      // vz: -1 to 1
        data[offset + 7] = 1.0f + random_float_pos();  // speed: 1 to 2
    }
}

EMSCRIPTEN_KEEPALIVE
void updateParticles(uintptr_t dataPtr, int count, float dt) {
    float* data = reinterpret_cast<float*>(dataPtr);

    for (int i = 0; i < count; i++) {
        int offset = i * 8;
        
        float* px = &data[offset + 0];
        float* py = &data[offset + 1];
        float* pz = &data[offset + 2];
        float* life = &data[offset + 3];
        float* vx = &data[offset + 4];
        float* vy = &data[offset + 5];
        float* vz = &data[offset + 6];
        float speed = data[offset + 7];

        *vy -= 2.0f * dt;
        *px += *vx * dt * speed;
        *py += *vy * dt * speed;
        *pz += *vz * dt * speed;
        *life -= dt * 0.2f;

        if (*life <= 0.0f) {
            *py = 10.0f;
            *life = 1.0f;
            *vy = 2.0f;
            *px = random_float() * 10.0f; // -5 to 5
            *pz = random_float() * 10.0f; // -5 to 5
            *vx = random_float() * 2.0f;
            *vz = random_float() * 2.0f;
        }
    }
}

EMSCRIPTEN_KEEPALIVE
void checkCollision(uintptr_t dataPtr, int count, float playerX, float playerZ, float radius) {
    float* data = reinterpret_cast<float*>(dataPtr);
    float rSq = radius * radius;

    for (int i = 0; i < count; i++) {
        int offset = i * 8;
        float* px = &data[offset + 0];
        float* py = &data[offset + 1];
        float* pz = &data[offset + 2];
        float* vy = &data[offset + 5];

        // Floor collision
        if (*py < 0.0f) {
            *py = 0.0f;
            *vy = -(*vy) * 0.5f; // Bounce with damping
        }

        // Player collision (Cylinder)
        float dx = *px - playerX;
        float dz = *pz - playerZ;
        float distSq = dx*dx + dz*dz;

        if (distSq < rSq) {
            // Simple push out
            float dist = sqrt(distSq);
            if (dist > 0.0001f) {
                float push = (radius - dist) / dist;
                *px += dx * push;
                *pz += dz * push;
            }
        }
    }
}

} // extern "C"

// Add main function to satisfy linker when using STANDALONE_WASM without --no-entry (or if checks fail)
int main() {
    return 0;
}
