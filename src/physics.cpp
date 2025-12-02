#include <emscripten.h>
#include <emscripten/bind.h>
#include <cmath>
#include <cstdlib>
#include <cstdint>

using namespace emscripten;

// Helper for random float
float random_float() {
    return ((float)rand() / RAND_MAX) - 0.5f;
}

// Main update function
// We accept 'dataPtr' as a number (address) from JS
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
            *px = random_float() * 10.0f;
            *pz = random_float() * 10.0f;
            *vx = random_float() * 2.0f;
            *vz = random_float() * 2.0f;
        }
    }
}

// Bindings
EMSCRIPTEN_BINDINGS(physics_module) {
    function("updateParticles", &updateParticles);
}
