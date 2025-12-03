#include <emscripten.h>
#include <cmath>
#include <cstdlib>

extern "C" {

// Helper for random float between -0.5 and 0.5
float random_float() {
    return ((float)rand() / RAND_MAX) - 0.5f;
}

EMSCRIPTEN_KEEPALIVE
void updateParticles(float* data, int count, float dt) {
    // 8 floats per particle: [x, y, z, life, vx, vy, vz, speed]
    for (int i = 0; i < count; i++) {
        int offset = i * 8;

        float px = data[offset + 0];
        float py = data[offset + 1];
        float pz = data[offset + 2];
        float life = data[offset + 3];
        float vx = data[offset + 4];
        float vy = data[offset + 5];
        float vz = data[offset + 6];
        float speed = data[offset + 7];

        vy -= 2.0f * dt; // Gravity
        px += vx * dt * speed;
        py += vy * dt * speed;
        pz += vz * dt * speed;
        life -= dt * 0.2f;

        if (life <= 0.0f) {
            py = 10.0f;
            life = 1.0f;
            vy = 2.0f;
            px = random_float() * 10.0f;
            pz = random_float() * 10.0f;
            vx = random_float() * 2.0f;
            vz = random_float() * 2.0f;
        }

        data[offset + 0] = px;
        data[offset + 1] = py;
        data[offset + 2] = pz;
        data[offset + 3] = life;
        data[offset + 4] = vx;
        data[offset + 5] = vy;
        data[offset + 6] = vz;
    }
}

// New C++ Terrain Height function (can be used if you switch to C++ for logic)
EMSCRIPTEN_KEEPALIVE
float getTerrainHeight(float x, float z) {
    float h = 0.0f;
    h += sin(x * 0.05f) * 2.0f + cos(z * 0.05f) * 2.0f;
    h += sin(x * 0.1f) * 0.8f + cos(z * 0.1f) * 0.8f;
    h += sin(x * 0.2f) * 0.3f + cos(z * 0.2f) * 0.3f;
    return h;
}

}

