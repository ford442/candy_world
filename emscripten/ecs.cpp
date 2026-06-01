/**
 * @file ecs.cpp
 * @brief C++/Emscripten Entity-Component System
 *
 * Mirrors assembly/ecs.ts semantics with a generational index and fixed-stride
 * slab allocators.  Entity IDs encode both a slot index and a generation counter
 * so stale references can be detected cheaply.
 *
 * ID encoding:
 *   entity_id = (generation << 16) | slotIndex
 *   slot: 0 … MAX_ENTITIES-1
 *   generation: 1 … 0xFFFF (0 = never used / tombstone)
 *
 * Component storage:
 *   Each registered component type gets a flat byte slab:
 *     slab[slotIndex * strideBytes .. (slotIndex+1)*strideBytes)
 *   Presence is tracked with a per-entity bitmask (uint32_t → up to 32 types).
 *
 * Batch query:
 *   ecsQueryComponents(mask) iterates alive entities and emits those whose
 *   component mask is a superset of the requested mask.  This inner loop is
 *   SIMD-friendly (no indirection, sequential memory).
 *
 * Public API (all EMSCRIPTEN_KEEPALIVE):
 *   ecsInit             – reset world state (optional, called automatically)
 *   ecsCreateEntity     – allocate entity, return generational ID
 *   ecsDestroyEntity    – release slot, bump generation
 *   ecsIsAlive          – validate generational ID
 *   ecsGetEntityCount   – number of currently alive entities
 *   ecsRegisterComponent– allocate a slab, return component-type index (0-31)
 *   ecsGetComponent     – pointer into slab for (entity, type)
 *   ecsSetComponent     – memcpy into slab
 *   ecsAddComponent     – mark component present + optionally write data
 *   ecsRemoveComponent  – clear component bit
 *   ecsHasComponent     – test presence
 *   ecsQueryComponents  – batch query by bitmask → fills outIds, returns count
 *   ecsGetComponentMask – raw bitmask for an entity
 */

#include <emscripten.h>
#include <cstring>
#include <cstdint>
#include <cstdlib>

extern "C" {

// =============================================================================
// CONSTANTS
// =============================================================================

static const int MAX_ENTITIES        = 65536;
static const int MAX_COMPONENT_TYPES = 32;    // fits in uint32_t bitmask

// =============================================================================
// ENTITY SLOT TABLE
// =============================================================================

struct Slot {
    uint16_t generation; // 0 = never used
    bool     alive;
};

static Slot     s_slots[MAX_ENTITIES];
static int      s_freeList[MAX_ENTITIES];
static int      s_freeCount = 0;
static uint16_t s_nextSlot  = 1; // slot 0 is reserved (null entity)
static int      s_aliveCount = 0;

// Per-entity bitmask of which component types are present
static uint32_t s_componentMask[MAX_ENTITIES];

// =============================================================================
// COMPONENT SLABS
// =============================================================================

struct Slab {
    uint8_t* data;
    int      strideBytes;
    int      maxEntities;
    bool     registered;
};

static Slab s_slabs[MAX_COMPONENT_TYPES];
static int  s_slabCount = 0;

// =============================================================================
// HELPERS
// =============================================================================

static inline uint16_t slotOf(uint32_t id) {
    return (uint16_t)(id & 0xFFFF);
}
static inline uint16_t genOf(uint32_t id) {
    return (uint16_t)(id >> 16);
}
static inline uint32_t makeId(uint16_t slot, uint16_t gen) {
    return ((uint32_t)gen << 16) | slot;
}

static bool validId(uint32_t id) {
    uint16_t slot = slotOf(id);
    uint16_t gen  = genOf(id);
    if (slot == 0 || slot >= MAX_ENTITIES) return false;
    return s_slots[slot].alive && s_slots[slot].generation == gen;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Reset the entire ECS world (called once at startup; safe to call again for tests).
 */
EMSCRIPTEN_KEEPALIVE
void ecsInit() {
    for (int i = 0; i < MAX_ENTITIES; i++) {
        s_slots[i].generation = 0;
        s_slots[i].alive      = false;
        s_componentMask[i]    = 0;
    }
    s_freeCount  = 0;
    s_nextSlot   = 1;
    s_aliveCount = 0;

    for (int i = 0; i < MAX_COMPONENT_TYPES; i++) {
        if (s_slabs[i].registered && s_slabs[i].data) {
            free(s_slabs[i].data);
            s_slabs[i].data       = nullptr;
            s_slabs[i].registered = false;
        }
    }
    s_slabCount = 0;
}

/**
 * Create a new entity and return its generational ID.
 * Returns 0 (null entity) if the world is full.
 */
EMSCRIPTEN_KEEPALIVE
uint32_t ecsCreateEntity() {
    uint16_t slot;
    if (s_freeCount > 0) {
        slot = (uint16_t)s_freeList[--s_freeCount];
    } else {
        if (s_nextSlot >= MAX_ENTITIES) return 0;
        slot = s_nextSlot++;
        s_slots[slot].generation = 0;
    }

    uint16_t gen = s_slots[slot].generation + 1;
    if (gen == 0) gen = 1; // avoid 0-generation IDs (null sentinel)
    s_slots[slot].generation = gen;
    s_slots[slot].alive      = true;
    s_componentMask[slot]    = 0;
    s_aliveCount++;

    return makeId(slot, gen);
}

/**
 * Destroy an entity.  Bumps the generation so old IDs become stale.
 */
EMSCRIPTEN_KEEPALIVE
void ecsDestroyEntity(uint32_t id) {
    if (!validId(id)) return;
    uint16_t slot         = slotOf(id);
    s_slots[slot].alive   = false;
    s_componentMask[slot] = 0;
    s_freeList[s_freeCount++] = slot;
    s_aliveCount--;
}

/**
 * Returns true if id refers to a live entity.
 */
EMSCRIPTEN_KEEPALIVE
bool ecsIsAlive(uint32_t id) {
    return validId(id);
}

/**
 * Number of alive entities.
 */
EMSCRIPTEN_KEEPALIVE
int ecsGetEntityCount() {
    return s_aliveCount;
}

/**
 * Register a component type with a fixed per-entity stride.
 * @param strideBytes  Bytes per entity for this component.
 * @param maxEntities  Max entities that can carry this component (≤ MAX_ENTITIES).
 * @returns Component-type index (0–31), or -1 if out of slots.
 */
EMSCRIPTEN_KEEPALIVE
int ecsRegisterComponent(int strideBytes, int maxEntities) {
    if (s_slabCount >= MAX_COMPONENT_TYPES) return -1;
    if (strideBytes <= 0 || maxEntities <= 0) return -1;

    const int cap = maxEntities < MAX_ENTITIES ? maxEntities : MAX_ENTITIES;
    uint8_t*  mem = (uint8_t*)calloc(cap, strideBytes);
    if (!mem) return -1;

    const int type        = s_slabCount++;
    s_slabs[type].data       = mem;
    s_slabs[type].strideBytes = strideBytes;
    s_slabs[type].maxEntities = cap;
    s_slabs[type].registered  = true;
    return type;
}

/**
 * Get a pointer to the component data for (entity, componentType).
 * Returns null if the entity is invalid, the component type is unregistered,
 * or the entity does not have this component.
 * The pointer is valid until the next call that modifies the slab.
 */
EMSCRIPTEN_KEEPALIVE
void* ecsGetComponent(uint32_t entityId, int componentType) {
    if (!validId(entityId)) return nullptr;
    if (componentType < 0 || componentType >= s_slabCount) return nullptr;
    if (!s_slabs[componentType].registered) return nullptr;

    uint16_t slot = slotOf(entityId);
    if (!(s_componentMask[slot] & (1u << componentType))) return nullptr;
    if (slot >= (uint16_t)s_slabs[componentType].maxEntities) return nullptr;

    return s_slabs[componentType].data + (slot * s_slabs[componentType].strideBytes);
}

/**
 * Write component data for (entity, componentType).
 * @param data  Pointer to strideBytes of data to copy.
 * Marks the component as present on the entity.
 */
EMSCRIPTEN_KEEPALIVE
void ecsSetComponent(uint32_t entityId, int componentType, void* data) {
    if (!validId(entityId)) return;
    if (componentType < 0 || componentType >= s_slabCount) return;
    if (!s_slabs[componentType].registered || !data) return;

    uint16_t slot = slotOf(entityId);
    if (slot >= (uint16_t)s_slabs[componentType].maxEntities) return;

    uint8_t* dest = s_slabs[componentType].data + (slot * s_slabs[componentType].strideBytes);
    memcpy(dest, data, s_slabs[componentType].strideBytes);
    s_componentMask[slot] |= (1u << componentType);
}

/**
 * Mark a component present without writing data (caller writes via pointer).
 */
EMSCRIPTEN_KEEPALIVE
void ecsAddComponent(uint32_t entityId, int componentType) {
    if (!validId(entityId)) return;
    if (componentType < 0 || componentType >= s_slabCount) return;
    uint16_t slot = slotOf(entityId);
    s_componentMask[slot] |= (1u << componentType);
}

/**
 * Remove a component from an entity (clears the presence bit).
 */
EMSCRIPTEN_KEEPALIVE
void ecsRemoveComponent(uint32_t entityId, int componentType) {
    if (!validId(entityId)) return;
    if (componentType < 0 || componentType >= MAX_COMPONENT_TYPES) return;
    uint16_t slot = slotOf(entityId);
    s_componentMask[slot] &= ~(1u << componentType);
}

/**
 * Test whether an entity has a component.
 */
EMSCRIPTEN_KEEPALIVE
bool ecsHasComponent(uint32_t entityId, int componentType) {
    if (!validId(entityId)) return false;
    if (componentType < 0 || componentType >= MAX_COMPONENT_TYPES) return false;
    uint16_t slot = slotOf(entityId);
    return (s_componentMask[slot] & (1u << componentType)) != 0;
}

/**
 * Batch query: fill outIds with entity IDs that have ALL components in
 * componentTypeMask.  Returns the number of results written.
 *
 * The inner loop is sequential across s_slots[] so the CPU prefetcher and
 * SIMD auto-vectoriser can work effectively.
 *
 * @param componentTypeMask  Bitmask of required component types (bit i = type i).
 * @param outIds             Caller-allocated array (int32, len ≥ maxResults).
 * @param maxResults         Maximum IDs to write.
 * @returns                  Number of IDs written.
 */
EMSCRIPTEN_KEEPALIVE
int ecsQueryComponents(int componentTypeMask, uint32_t* outIds, int maxResults) {
    if (maxResults <= 0) return 0;
    const uint32_t mask = (uint32_t)componentTypeMask;
    int found = 0;

    // Iterate over all allocated slots (1 … s_nextSlot-1)
    const int limit = (int)s_nextSlot;
    for (int i = 1; i < limit && found < maxResults; i++) {
        if (!s_slots[i].alive) continue;
        if ((s_componentMask[i] & mask) == mask) {
            outIds[found++] = makeId((uint16_t)i, s_slots[i].generation);
        }
    }
    return found;
}

/**
 * Raw component bitmask for an entity (useful for debugging / archetype systems).
 */
EMSCRIPTEN_KEEPALIVE
uint32_t ecsGetComponentMask(uint32_t entityId) {
    if (!validId(entityId)) return 0;
    return s_componentMask[slotOf(entityId)];
}

} // extern "C"
