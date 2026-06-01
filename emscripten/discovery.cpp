/**
 * @file discovery.cpp
 * @brief C++/Emscripten spatial-grid flora discovery system
 *
 * SIMD-friendly SoA layout lets the compiler auto-vectorise the inner
 * distance loop.  Each cell uses a singly-linked list so insert is O(1)
 * and iteration touches only populated cells.
 *
 * Public API (all EMSCRIPTEN_KEEPALIVE):
 *   initDiscoveryGrid    – configure grid dimensions/origin/cell-size
 *   registerDiscoverable – insert one object at (x, z) with caller ID
 *   queryDiscoveries     – radius query → fills outIds, returns count
 *   clearDiscoveryGrid   – reset without realloc
 *
 * Mirrors constants in assembly/constants.ts (GRID_CELL_SIZE = 16,
 * GRID_COLS = 16, GRID_ROWS = 16, GRID_ORIGIN_X/Z = ±128,
 * MAX_DISCOVERY_OBJECTS = 3000).
 */

#include <emscripten.h>
#include <cmath>
#include <cstring>

extern "C" {

// =============================================================================
// CONSTANTS
// =============================================================================

static const int MAX_DISCOVERY_OBJECTS = 3000;
static const int MAX_GRID_CELLS        = 1024; // enough for up to 32×32

// =============================================================================
// SoA DATA (separate x/z arrays allow SIMD auto-vectorisation)
// =============================================================================

static float s_ox[MAX_DISCOVERY_OBJECTS]; // world X
static float s_oz[MAX_DISCOVERY_OBJECTS]; // world Z
static int   s_id[MAX_DISCOVERY_OBJECTS]; // caller-provided ID
static int   s_gridNext[MAX_DISCOVERY_OBJECTS]; // linked-list next pointer (-1 = end)
static int   s_gridHeads[MAX_GRID_CELLS];       // head of linked list per cell (-1 = empty)
static int   s_objectCount = 0;

// Grid configuration (written once by initDiscoveryGrid)
static int   s_cols        = 16;
static int   s_rows        = 16;
static float s_originX     = -128.0f;
static float s_originZ     = -128.0f;
static float s_cellSize    = 16.0f;
static float s_invCellSize = 1.0f / 16.0f;

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

static inline int cellOf(float x, float z) {
    int col = (int)((x - s_originX) * s_invCellSize);
    int row = (int)((z - s_originZ) * s_invCellSize);
    if (col < 0 || col >= s_cols || row < 0 || row >= s_rows) return -1;
    return row * s_cols + col;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Configure the spatial grid.  Must be called before any other function.
 * Matching defaults: cols=16, rows=16, originX=-128, originZ=-128, cellSize=16.
 */
EMSCRIPTEN_KEEPALIVE
void initDiscoveryGrid(int cols, int rows, float originX, float originZ, float cellSize) {
    s_cols        = cols  > 0 ? cols  : 16;
    s_rows        = rows  > 0 ? rows  : 16;
    s_originX     = originX;
    s_originZ     = originZ;
    s_cellSize    = cellSize > 0.0f ? cellSize : 16.0f;
    s_invCellSize = 1.0f / s_cellSize;
    s_objectCount = 0;

    const int cells = s_cols * s_rows;
    for (int i = 0; i < cells && i < MAX_GRID_CELLS; i++) {
        s_gridHeads[i] = -1;
    }
    for (int i = 0; i < MAX_DISCOVERY_OBJECTS; i++) {
        s_gridNext[i] = -1;
    }
}

/**
 * Register a discoverable object.
 * @param id    Caller-provided identifier (returned verbatim by queryDiscoveries).
 * @param x     World X position.
 * @param z     World Z position.
 */
EMSCRIPTEN_KEEPALIVE
void registerDiscoverable(int id, float x, float z) {
    if (s_objectCount >= MAX_DISCOVERY_OBJECTS) return;

    const int slot = s_objectCount++;
    s_ox[slot] = x;
    s_oz[slot] = z;
    s_id[slot] = id;

    const int cell = cellOf(x, z);
    if (cell >= 0) {
        s_gridNext[slot]  = s_gridHeads[cell];
        s_gridHeads[cell] = slot;
    }
}

/**
 * Return IDs of all objects within radiusSq of (px, pz).
 * The caller owns the outIds buffer and decides which returned IDs are
 * still undiscovered (state lives in TypeScript, not here).
 *
 * @param px         Player X.
 * @param pz         Player Z.
 * @param radiusSq   Squared discovery radius (e.g. 25.0 for r=5 m).
 * @param outIds     Pointer into Emscripten HEAP (int32, caller-allocated).
 * @param maxResults Maximum entries to write into outIds.
 * @returns          Number of IDs written.
 */
EMSCRIPTEN_KEEPALIVE
int queryDiscoveries(float px, float pz, float radiusSq, int* outIds, int maxResults) {
    if (maxResults <= 0 || s_objectCount == 0) return 0;

    const float radius = sqrtf(radiusSq);
    const float invCS  = s_invCellSize;

    // Cell range that can possibly intersect the circle
    const int c0 = (int)((px - radius - s_originX) * invCS);
    const int c1 = (int)((px + radius - s_originX) * invCS);
    const int r0 = (int)((pz - radius - s_originZ) * invCS);
    const int r1 = (int)((pz + radius - s_originZ) * invCS);

    const int cc0 = c0 < 0        ? 0        : c0;
    const int cc1 = c1 >= s_cols  ? s_cols-1 : c1;
    const int rr0 = r0 < 0        ? 0        : r0;
    const int rr1 = r1 >= s_rows  ? s_rows-1 : r1;

    int found = 0;
    for (int row = rr0; row <= rr1 && found < maxResults; row++) {
        for (int col = cc0; col <= cc1 && found < maxResults; col++) {
            int slot = s_gridHeads[row * s_cols + col];
            while (slot != -1 && found < maxResults) {
                const float dx = s_ox[slot] - px;
                const float dz = s_oz[slot] - pz;
                if (dx * dx + dz * dz <= radiusSq) {
                    outIds[found++] = s_id[slot];
                }
                slot = s_gridNext[slot];
            }
        }
    }
    return found;
}

/**
 * Clear all registered objects.  Grid dimensions are preserved.
 */
EMSCRIPTEN_KEEPALIVE
void clearDiscoveryGrid() {
    s_objectCount = 0;
    const int cells = s_cols * s_rows;
    for (int i = 0; i < cells && i < MAX_GRID_CELLS; i++) {
        s_gridHeads[i] = -1;
    }
    for (int i = 0; i < MAX_DISCOVERY_OBJECTS; i++) {
        s_gridNext[i] = -1;
    }
}

} // extern "C"
