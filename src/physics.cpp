#include <emscripten.h>
#include <cmath>
#include <cstdlib> // for rand()

extern "C" {

// Helper for random float between -0.5 and 0.5
float random_float() {
    return ((float)rand() / RAND_MAX) - 0.5f;
}

EMSCRIPTEN_KEEPALIVE
void updateParticles(float* data, int count, float dt) {
    // Each particle has 8 floats (x, y, z, life, vx, vy, vz, speed)
    // Stride = 8
    for (int i = 0; i < count; i++) {
        int offset = i * 8;

        // Load values
        float px = data[offset + 0];
        float py = data[offset + 1];
        float pz = data[offset + 2];
        float life = data[offset + 3];
        float vx = data[offset + 4];
        float vy = data[offset + 5];
        float vz = data[offset + 6];
        float speed = data[offset + 7];

        // Update Physics
        vy -= 2.0f * dt; // Gravity
        px += vx * dt * speed;
        py += vy * dt * speed;
        pz += vz * dt * speed;
        life -= dt * 0.2f;

        // Reset if dead
        if (life <= 0.0f) {
            py = 10.0f;
            life = 1.0f;
            vy = 2.0f;
            px = random_float() * 10.0f; // Adjusted scale matching TS
            pz = random_float() * 10.0f;
            vx = random_float() * 2.0f;
            vz = random_float() * 2.0f;
        }

        // Store values back
        data[offset + 0] = px;
        data[offset + 1] = py;
        data[offset + 2] = pz;
        data[offset + 3] = life;
        data[offset + 4] = vx;
        data[offset + 5] = vy;
        data[offset + 6] = vz;
        // speed (index 7) doesn't change
    }
}

EMSCRIPTEN_KEEPALIVE
int checkCollision(float playerX, float playerZ, float radius, int count) {
    return 0; // Placeholder logic from your TS file
}

}