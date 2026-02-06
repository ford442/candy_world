#include <emscripten.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdint>

// Define grid size (fixed for now to avoid dynamic resizing complexity in WASM memory)
// 128x128 = 16384 cells
#define GRID_SIZE 128
#define GRID_SIZE_SQ (GRID_SIZE * GRID_SIZE)

// Simulation arrays
std::vector<float> u(GRID_SIZE_SQ, 0.0f);       // Velocity X
std::vector<float> v(GRID_SIZE_SQ, 0.0f);       // Velocity Y
std::vector<float> u_prev(GRID_SIZE_SQ, 0.0f);
std::vector<float> v_prev(GRID_SIZE_SQ, 0.0f);
std::vector<float> dens(GRID_SIZE_SQ, 0.0f);    // Density
std::vector<float> dens_prev(GRID_SIZE_SQ, 0.0f);

// Helper macro for 2D indexing
#define IX(x, y) ((x) + (y) * GRID_SIZE)

// --- Fluid Solver Core ---

void set_bnd(int b, std::vector<float>& x) {
    for (int i = 1; i < GRID_SIZE - 1; i++) {
        x[IX(i, 0)]             = b == 2 ? -x[IX(i, 1)] : x[IX(i, 1)];
        x[IX(i, GRID_SIZE - 1)] = b == 2 ? -x[IX(i, GRID_SIZE - 2)] : x[IX(i, GRID_SIZE - 2)];
    }
    for (int j = 1; j < GRID_SIZE - 1; j++) {
        x[IX(0, j)]             = b == 1 ? -x[IX(1, j)] : x[IX(1, j)];
        x[IX(GRID_SIZE - 1, j)] = b == 1 ? -x[IX(GRID_SIZE - 2, j)] : x[IX(GRID_SIZE - 2, j)];
    }

    x[IX(0, 0)]                         = 0.5f * (x[IX(1, 0)] + x[IX(0, 1)]);
    x[IX(0, GRID_SIZE - 1)]             = 0.5f * (x[IX(1, GRID_SIZE - 1)] + x[IX(0, GRID_SIZE - 2)]);
    x[IX(GRID_SIZE - 1, 0)]             = 0.5f * (x[IX(GRID_SIZE - 2, 0)] + x[IX(GRID_SIZE - 1, 1)]);
    x[IX(GRID_SIZE - 1, GRID_SIZE - 1)] = 0.5f * (x[IX(GRID_SIZE - 2, GRID_SIZE - 1)] + x[IX(GRID_SIZE - 1, GRID_SIZE - 2)]);
}

void lin_solve(int b, std::vector<float>& x, std::vector<float>& x0, float a, float c) {
    float cRecip = 1.0f / c;
    for (int k = 0; k < 20; k++) { // Gauss-Seidel iterations
        #pragma omp parallel for collapse(2) schedule(static)
        for (int j = 1; j < GRID_SIZE - 1; j++) {
            for (int i = 1; i < GRID_SIZE - 1; i++) {
                x[IX(i, j)] = (x0[IX(i, j)] + a * (
                    x[IX(i + 1, j)] +
                    x[IX(i - 1, j)] +
                    x[IX(i, j + 1)] +
                    x[IX(i, j - 1)]
                )) * cRecip;
            }
        }
        set_bnd(b, x);
    }
}

void diffuse(int b, std::vector<float>& x, std::vector<float>& x0, float diff, float dt) {
    float a = dt * diff * (GRID_SIZE - 2) * (GRID_SIZE - 2);
    // Use 1+4a for 2D diffusion
    lin_solve(b, x, x0, a, 1 + 4 * a);
}

void advect(int b, std::vector<float>& d, std::vector<float>& d0, std::vector<float>& u, std::vector<float>& v, float dt) {
    float dt0 = dt * (GRID_SIZE - 2);

    #pragma omp parallel for collapse(2) schedule(static)
    for (int j = 1; j < GRID_SIZE - 1; j++) {
        for (int i = 1; i < GRID_SIZE - 1; i++) {
            float x = i - dt0 * u[IX(i, j)];
            float y = j - dt0 * v[IX(i, j)];

            if (x < 0.5f) x = 0.5f;
            if (x > GRID_SIZE - 1.5f) x = GRID_SIZE - 1.5f;
            float i0 = floorf(x);
            float i1 = i0 + 1.0f;

            if (y < 0.5f) y = 0.5f;
            if (y > GRID_SIZE - 1.5f) y = GRID_SIZE - 1.5f;
            float j0 = floorf(y);
            float j1 = j0 + 1.0f;

            float s1 = x - i0;
            float s0 = 1.0f - s1;
            float t1 = y - j0;
            float t0 = 1.0f - t1;

            int i0i = (int)i0;
            int i1i = (int)i1;
            int j0i = (int)j0;
            int j1i = (int)j1;

            d[IX(i, j)] =
                s0 * (t0 * d0[IX(i0i, j0i)] + t1 * d0[IX(i0i, j1i)]) +
                s1 * (t0 * d0[IX(i1i, j0i)] + t1 * d0[IX(i1i, j1i)]);
        }
    }
    set_bnd(b, d);
}

void project(std::vector<float>& u, std::vector<float>& v, std::vector<float>& p, std::vector<float>& div) {
    float h = 1.0f / GRID_SIZE;

    #pragma omp parallel for collapse(2) schedule(static)
    for (int j = 1; j < GRID_SIZE - 1; j++) {
        for (int i = 1; i < GRID_SIZE - 1; i++) {
            div[IX(i, j)] = -0.5f * h * (
                u[IX(i + 1, j)] - u[IX(i - 1, j)] +
                v[IX(i, j + 1)] - v[IX(i, j - 1)]
            );
            p[IX(i, j)] = 0;
        }
    }
    set_bnd(0, div);
    set_bnd(0, p);

    lin_solve(0, p, div, 1, 4);

    #pragma omp parallel for collapse(2) schedule(static)
    for (int j = 1; j < GRID_SIZE - 1; j++) {
        for (int i = 1; i < GRID_SIZE - 1; i++) {
            u[IX(i, j)] -= 0.5f * (p[IX(i + 1, j)] - p[IX(i - 1, j)]) / h;
            v[IX(i, j)] -= 0.5f * (p[IX(i, j + 1)] - p[IX(i, j - 1)]) / h;
        }
    }
    set_bnd(1, u);
    set_bnd(2, v);
}

// --- Exports ---

extern "C" {

EMSCRIPTEN_KEEPALIVE
void fluidInit(int size) {
    // We ignore size for now and use fixed GRID_SIZE 128
    // Reset arrays
    std::fill(u.begin(), u.end(), 0.0f);
    std::fill(v.begin(), v.end(), 0.0f);
    std::fill(dens.begin(), dens.end(), 0.0f);
}

EMSCRIPTEN_KEEPALIVE
void fluidAddDensity(int x, int y, float amount) {
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    dens[IX(x, y)] += amount;
}

EMSCRIPTEN_KEEPALIVE
void fluidAddVelocity(int x, int y, float amountX, float amountY) {
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return;
    u[IX(x, y)] += amountX;
    v[IX(x, y)] += amountY;
}

EMSCRIPTEN_KEEPALIVE
void fluidStep(float dt, float visc, float diff) {
    // Velocity Step
    std::swap(u_prev, u);
    std::swap(v_prev, v);

    diffuse(1, u, u_prev, visc, dt);
    diffuse(2, v, v_prev, visc, dt);

    project(u, v, u_prev, v_prev);

    std::swap(u_prev, u);
    std::swap(v_prev, v);

    advect(1, u, u_prev, u_prev, v_prev, dt);
    advect(2, v, v_prev, u_prev, v_prev, dt);

    project(u, v, u_prev, v_prev);

    // Density Step
    std::swap(dens_prev, dens);
    diffuse(0, dens, dens_prev, diff, dt);
    std::swap(dens_prev, dens);
    advect(0, dens, dens_prev, u, v, dt);

    // Decay
    #pragma omp parallel for schedule(static)
    for (int i = 0; i < GRID_SIZE_SQ; i++) {
        dens[i] *= 0.99f; // Fade out
    }
}

EMSCRIPTEN_KEEPALIVE
uintptr_t fluidGetDensityPtr() {
    return (uintptr_t)dens.data();
}

}
