/**
 * physics.ts
 * 
 * Barrel export for physics modules.
 * Re-exports all public APIs from physics-core and physics-updates.
 */

export * from './physics-core.ts';
export * from './physics-updates.ts';
export { player, PlayerState } from './physics-core.ts';
export { 
    grantInvisibility, 
    registerPhysicsCave, 
    triggerHarpoon 
} from './physics-core.ts';
