#include <emscripten.h>
#include <cmath>
#include <cstdlib> // for rand(), srand()

extern "C" {

// Helper for random float between -0.5 and 0.5
float random_float() {
    return ((float)rand() / RAND_MAX) - 0.5f;
}

// Helper for random float between 0.0 and 1.0
float random_float_positive() {
    return (float)rand() / RAND_MAX;
}

EMSCRIPTEN_KEEPALIVE
void seedRandom(int s) {
    srand(s);
}

EMSCRIPTEN_KEEPALIVE
void initParticles(float* data, int count) {
    // Each particle has 8 floats (x, y, z, life, vx, vy, vz, speed)
    for (int i = 0; i < count; i++) {
        int offset = i * 8;

        data[offset + 0] = random_float() * 50.0f;    // x
        data[offset + 1] = random_float_positive() * 20.0f; // y
        data[offset + 2] = random_float() * 50.0f;    // z
        data[offset + 3] = random_float_positive();   // life
        data[offset + 4] = random_float() * 2.0f;     // vx
        data[offset + 5] = random_float_positive() * 5.0f; // vy
        data[offset + 6] = random_float() * 2.0f;     // vz
        data[offset + 7] = 1.0f + random_float_positive(); // speed
    }
}

EMSCRIPTEN_KEEPALIVE
void updateParticles(float* data, int count, float dt) {
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

        // Reset if dead (floor bounce/reset logic)
        if (life <= 0.0f) {
            py = 10.0f;
            life = 1.0f;
            vy = 2.0f;
            px = random_float() * 10.0f;
            pz = random_float() * 10.0f;
            vx = random_float() * 2.0f;
            vz = random_float() * 2.0f;
        }

        // Simple floor collision (if desired, though "life" handles reset usually)
        if (py < 0.0f) {
             py = 0.0f;
             vy = -vy * 0.5f; // Dampened bounce
        }

        // Store values back
        data[offset + 0] = px;
        data[offset + 1] = py;
        data[offset + 2] = pz;
        data[offset + 3] = life;
        data[offset + 4] = vx;
        data[offset + 5] = vy;
        data[offset + 6] = vz;
    }
}

EMSCRIPTEN_KEEPALIVE
void checkCollision(float* data, int count, float playerX, float playerZ, float radius) {
    float radiusSq = radius * radius;

    for (int i = 0; i < count; i++) {
        int offset = i * 8;
        float px = data[offset + 0];
        float pz = data[offset + 2];

        float dx = px - playerX;
        float dz = pz - playerZ;
        float distSq = dx*dx + dz*dz;

        if (distSq < radiusSq) {
            // Collision detected! Bounce away.
            float dist = sqrt(distSq);
            if (dist > 0.0001f) {
                // Normalize normal
                float nx = dx / dist;
                float nz = dz / dist;

                // Push out
                float overlap = radius - dist;
                data[offset + 0] += nx * overlap;
                data[offset + 2] += nz * overlap;

                // Reflect velocity (simple bounce)
                // v' = v - 2(v.n)n
                float vx = data[offset + 4];
                float vz = data[offset + 6];

                float dot = vx * nx + vz * nz;

                // Only bounce if moving towards the player
                if (dot < 0.0f) {
                    data[offset + 4] = vx - 2.0f * dot * nx;
                    data[offset + 6] = vz - 2.0f * dot * nz;

                    // Add a little upward kick
                    data[offset + 5] += 2.0f;
                }
            }
        }
    }
}

}
