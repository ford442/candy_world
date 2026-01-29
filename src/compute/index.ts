/**
 * @file index.ts
 * @description Barrel export for compute module
 */

// Compute particle system
export { ComputeParticleSystem } from './particle_compute.js';

// Procedural noise generation
export {
    ProceduralNoiseCompute,
    createCandySwirlTexture
} from './noise_generator.js';
export type { NoiseConfig } from './noise_generator.js';

// Mesh deformation
export {
    MeshDeformationCompute,
    DeformationType,
    createWaveDeformation,
    createJiggleDeformation,
    createWobbleDeformation
} from './mesh_deformation.js';
export type {
    DeformationTypeValue,
    DeformationConfig,
    DeformationAudioState
} from './mesh_deformation.js';
