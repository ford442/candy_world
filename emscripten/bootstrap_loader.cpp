// bootstrap_loader.cpp
// Pthread-based Bootstrap Loader for Candy World
// Pre-computes terrain heightmap and pre-warms physics system initialization

#include <emscripten.h>
#include <emscripten/threading.h>
#include <pthread.h>
#include <cmath>
#include <cstdlib>
#include <atomic>

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
    float heightmap[HEIGHTMAP_SIZE * HEIGHTMAP_SIZE]; // Pre-computed heightmap
};

static BootstrapState bootstrap = {
    .progress = 0,
    .complete = false,
    .started = false,
    .heightmap = {0}
};

// =============================================================================
// TERRAIN HEIGHTMAP PRE-COMPUTATION
// =============================================================================

// Compute heightmap for a region (used by worker threads)
void computeHeightmapRegion(int startRow, int endRow) {
    const float cellSize = (2.0f * SPAWN_AREA_RADIUS) / HEIGHTMAP_SIZE;
    
    for (int row = startRow; row < endRow; row++) {
        for (int col = 0; col < HEIGHTMAP_SIZE; col++) {
            // Convert grid coordinates to world coordinates
            float worldX = -SPAWN_AREA_RADIUS + col * cellSize;
            float worldZ = -SPAWN_AREA_RADIUS + row * cellSize;
            
            // Compute height using terrain generation algorithm
            // This should match the terrain generation in the main game
            float height = fbm(worldX * 0.05f, worldZ * 0.05f, 4);
            height += valueNoise2D(worldX * 0.1f, worldZ * 0.1f) * 0.5f;
            height *= 3.0f; // Scale factor
            
            // Store in heightmap
            int idx = row * HEIGHTMAP_SIZE + col;
            bootstrap.heightmap[idx] = height;
        }
        
        // Update progress (each row is ~1.5% of total work)
        int rowProgress = (row - startRow + 1) * 100 / (endRow - startRow);
        int oldProgress = bootstrap.progress.load();
        if (rowProgress > oldProgress) {
            bootstrap.progress.store(rowProgress);
        }
    }
}

// Worker thread entry point
void* bootstrapWorker(void* arg) {
    int threadId = (int)(long)arg;
    int numThreads = 4; // Match PTHREAD_POOL_SIZE from build.sh
    
    // Divide work among threads
    int rowsPerThread = HEIGHTMAP_SIZE / numThreads;
    int startRow = threadId * rowsPerThread;
    int endRow = (threadId == numThreads - 1) ? HEIGHTMAP_SIZE : (threadId + 1) * rowsPerThread;
    
    computeHeightmapRegion(startRow, endRow);
    
    return nullptr;
}

// =============================================================================
// PUBLIC API
// =============================================================================

// Start bootstrap initialization (spawns worker threads)
EMSCRIPTEN_KEEPALIVE
void startBootstrapInit() {
    if (bootstrap.started.load()) {
        return; // Already started
    }
    
    bootstrap.started.store(true);
    bootstrap.progress.store(0);
    bootstrap.complete.store(false);
    
    // Spawn worker threads for parallel heightmap computation
    pthread_t threads[4];
    for (int i = 0; i < 4; i++) {
        pthread_create(&threads[i], nullptr, bootstrapWorker, (void*)(long)i);
    }
    
    // Detach threads so they clean up automatically
    for (int i = 0; i < 4; i++) {
        pthread_detach(threads[i]);
    }
    
    // Mark completion in a separate callback after all threads finish
    // For simplicity, we'll poll progress in JS instead of using a join thread
}

// Get current bootstrap progress (0-100)
EMSCRIPTEN_KEEPALIVE
int getBootstrapProgress() {
    int progress = bootstrap.progress.load();
    
    // Mark complete when progress reaches 100
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

// Get pre-computed height at a specific point (faster than recalculating)
EMSCRIPTEN_KEEPALIVE
float getBootstrapHeight(float x, float z) {
    // Check if point is within pre-computed region
    if (std::abs(x) > SPAWN_AREA_RADIUS || std::abs(z) > SPAWN_AREA_RADIUS) {
        // Outside cached region, compute on the fly
        float height = fbm(x * 0.05f, z * 0.05f, 4);
        height += valueNoise2D(x * 0.1f, z * 0.1f) * 0.5f;
        height *= 3.0f;
        return height;
    }
    
    // Convert world coordinates to grid coordinates
    const float cellSize = (2.0f * SPAWN_AREA_RADIUS) / HEIGHTMAP_SIZE;
    int col = (int)((x + SPAWN_AREA_RADIUS) / cellSize);
    int row = (int)((z + SPAWN_AREA_RADIUS) / cellSize);
    
    // Clamp to valid range
    if (col < 0) col = 0;
    if (col >= HEIGHTMAP_SIZE) col = HEIGHTMAP_SIZE - 1;
    if (row < 0) row = 0;
    if (row >= HEIGHTMAP_SIZE) row = HEIGHTMAP_SIZE - 1;
    
    int idx = row * HEIGHTMAP_SIZE + col;
    return bootstrap.heightmap[idx];
}

// Reset bootstrap state (useful for testing)
EMSCRIPTEN_KEEPALIVE
void resetBootstrap() {
    bootstrap.started.store(false);
    bootstrap.progress.store(0);
    bootstrap.complete.store(false);
    
    for (int i = 0; i < HEIGHTMAP_SIZE * HEIGHTMAP_SIZE; i++) {
        bootstrap.heightmap[i] = 0.0f;
    }
}

} // extern "C"
