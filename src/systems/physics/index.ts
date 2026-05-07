// src/systems/physics/index.ts
// Barrel file for physics system exports

// Main exports from physics.ts
export {
    populatePhysicsGrids,
    updatePhysics,
    grantInvisibility,
    registerPhysicsCave,
    triggerHarpoon,
    player,
    PlayerState
} from './physics.js';

// Type exports
export type {
    AudioState,
    PlayerExtended,
    KeyStates
} from './physics-types.js';

// Re-export specific types/constants if needed by external modules
export {
    GRAVITY,
    SWIMMING_GRAVITY,
    SWIMMING_DRAG,
    PLAYER_HEIGHT_OFFSET,
    DANCE_KICK_THRESHOLD,
    bpmWind,
    grooveGravity
} from './physics-types.js';
