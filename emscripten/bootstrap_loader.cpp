// bootstrap_loader.cpp
// Pthread & OpenMP-based Bootstrap Loader for Candy World
// Pre-computes terrain heightmap and pre-warms physics system initialization

#include <emscripten.h>
#include <emscripten/threading.h>
#include <pthread.h>
#include <cmath>
#include <cstdlib>
#include <cstdint>
#include <atomic>


// Define OMP pragmas as no-ops when not available
#ifndef _OPENMP
#define omp_get_thread_num() 0
#define omp_get_num_threads() 1
#endif

extern "C" {

// Forward declare noise function from math.cpp
extern float valueNoise2D(float x, float y);
extern float fbm(float x, float y, int octaves);

// =============================================================================
// BOOTSTRAP STATE
// =============================================================================

#define HEIGHTMAP_SIZE 64      // 64x64 grid for spawn area heightmap
#define SPAWN_AREA_RADIUS 32.0f // Cover -32 to +32 in world coordinates

struct BootstrapState {
    std::atomic<int> progress;      // 0-100
    std::atomic<bool> complete;     // Whether bootstrap is complete
    std::atomic<bool> started;      // Whether bootstrap has started
    std::atomic<int> completedRows; // Number of completed rows (for progress tracking)
    float heightmap[HEIGHTMAP_SIZE * HEIGHTMAP_SIZE]; // Pre-computed heightmap
};

static BootstrapState bootstrap = {
    .progress = 0,
    .complete = false,
    .started = false,
    .completedRows = 0,
    .heightmap = {0}
};

// =============================================================================
// WARMUP STATE (Simulated Shader Compilation)
// =============================================================================

struct WarmupState {
    std::atomic<int> progress;
    std::atomic<bool> complete;
    std::atomic<bool> started;
    std::atomic<int> completedChunks;
};

static WarmupState warmup = {
    .progress = 0,
    .complete = false,
    .started = false,
    .completedChunks = 0
};

// =============================================================================
// WORKER FUNCTIONS
// =============================================================================

// Master worker that uses OpenMP to parallelize heightmap generation
void* bootstrapMasterWorker(void* arg) {
    const float cellSize = (2.0f * SPAWN_AREA_RADIUS) / HEIGHTMAP_SIZE;
    
    // Reset counters
    bootstrap.completedRows.store(0);
    bootstrap.progress.store(0);

    
    for (int row = 0; row < HEIGHTMAP_SIZE; row++) {
        for (int col = 0; col < HEIGHTMAP_SIZE; col++) {
            // Convert grid coordinates to world coordinates
            float worldX = -SPAWN_AREA_RADIUS + col * cellSize;
            float worldZ = -SPAWN_AREA_RADIUS + row * cellSize;
            
            // Compute height using terrain generation algorithm
            float height = fbm(worldX * 0.05f, worldZ * 0.05f, 4);
            height += valueNoise2D(worldX * 0.1f, worldZ * 0.1f) * 0.5f;
            height *= 3.0f; // Scale factor
            
            // Store in heightmap
            int idx = row * HEIGHTMAP_SIZE + col;
            bootstrap.heightmap[idx] = height;
        }
        
        // Update global progress counter (atomic increment)
        int completedCount = bootstrap.completedRows.fetch_add(1) + 1;
        int newProgress = (completedCount * 100) / HEIGHTMAP_SIZE;
        
        // Update progress atomically if it increased
        int oldProgress = bootstrap.progress.load();
        while (newProgress > oldProgress && 
               !bootstrap.progress.compare_exchange_weak(oldProgress, newProgress)) {
            // CAS loop
        }
    }

    bootstrap.progress.store(100);
    bootstrap.complete.store(true);
    return nullptr;
}

// Master worker for shader warmup simulation
void* warmupMasterWorker(void* arg) {
    const int total_iterations = 1000000;
    const int chunk_size = 1000;
    const int num_chunks = total_iterations / chunk_size;
    
    warmup.completedChunks.store(0);
    warmup.progress.store(0);
    
    
    for (int c = 0; c < num_chunks; c++) {
        // Perform a chunk of heavy work
        for (int i = 0; i < chunk_size; i++) {
            float x = (float)(c * chunk_size + i) * 0.001f;
            volatile float y = sinf(x) * cosf(x * 1.5f) + tanf(x * 0.1f);
            (void)y;
        }

        // Atomically update completed chunks count
        int finished = warmup.completedChunks.fetch_add(1) + 1;

        // Update progress percentage monotonically
        int p = (finished * 100) / num_chunks;
        int oldP = warmup.progress.load();
        while (p > oldP && !warmup.progress.compare_exchange_weak(oldP, p)) {
            // spin until updated or p <= oldP
        }
    }
    
    warmup.progress.store(100);
    warmup.complete.store(true);
    return nullptr;
}

// =============================================================================
// PUBLIC API
// =============================================================================

// Start bootstrap initialization (spawns one master thread which uses OpenMP)
EMSCRIPTEN_KEEPALIVE
void startBootstrapInit() {
    if (bootstrap.started.load()) {
        return; // Already started
    }
    
    bootstrap.started.store(true);
    bootstrap.progress.store(0);
    bootstrap.complete.store(false);
    bootstrap.completedRows.store(0);
    
    // Spawn ONE master thread to manage OpenMP pool
    pthread_t thread;
    pthread_create(&thread, nullptr, bootstrapMasterWorker, nullptr);
    pthread_detach(thread);
}

// Start shader warmup (spawns one master thread which uses OpenMP)
EMSCRIPTEN_KEEPALIVE
void startShaderWarmup() {
    if (warmup.started.load()) return;
    
    warmup.started.store(true);
    warmup.progress.store(0);
    warmup.complete.store(false);
    
    pthread_t thread;
    pthread_create(&thread, nullptr, warmupMasterWorker, nullptr);
    pthread_detach(thread);
}

EMSCRIPTEN_KEEPALIVE
int getShaderWarmupProgress() {
    return warmup.progress.load();
}

// Get current bootstrap progress (0-100)
EMSCRIPTEN_KEEPALIVE
int getBootstrapProgress() {
    int progress = bootstrap.progress.load();
    if (progress >= 100 && !bootstrap.complete.load()) {
        bootstrap.complete.store(true);
    }
    return progress;
}

// Check if bootstrap is complete
EMSCRIPTEN_KEEPALIVE
int isBootstrapComplete() {
    return bootstrap.complete.load() ? 1 : 0;
}

// Get pre-computed height at a specific point
EMSCRIPTEN_KEEPALIVE
float getBootstrapHeight(float x, float z) {
    if (std::abs(x) > SPAWN_AREA_RADIUS || std::abs(z) > SPAWN_AREA_RADIUS) {
        float height = fbm(x * 0.05f, z * 0.05f, 4);
        height += valueNoise2D(x * 0.1f, z * 0.1f) * 0.5f;
        height *= 3.0f;
        return height;
    }
    
    const float cellSize = (2.0f * SPAWN_AREA_RADIUS) / HEIGHTMAP_SIZE;
    int col = (int)((x + SPAWN_AREA_RADIUS) / cellSize);
    int row = (int)((z + SPAWN_AREA_RADIUS) / cellSize);
    
    if (col < 0) col = 0;
    if (col >= HEIGHTMAP_SIZE) col = HEIGHTMAP_SIZE - 1;
    if (row < 0) row = 0;
    if (row >= HEIGHTMAP_SIZE) row = HEIGHTMAP_SIZE - 1;
    
    int idx = row * HEIGHTMAP_SIZE + col;
    return bootstrap.heightmap[idx];
}

EMSCRIPTEN_KEEPALIVE
void resetBootstrap() {
    bootstrap.started.store(false);
    bootstrap.progress.store(0);
    bootstrap.complete.store(false);
    bootstrap.completedRows.store(0);
    
    warmup.started.store(false);
    warmup.progress.store(0);
    warmup.complete.store(false);
    warmup.completedChunks.store(0);

    for (int i = 0; i < HEIGHTMAP_SIZE * HEIGHTMAP_SIZE; i++) {
        bootstrap.heightmap[i] = 0.0f;
    }
}

} // extern "C"
