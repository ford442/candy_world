/**
 * @file index.ts
 * @description Barrel export for compute module
 */

// Compute particle system
export { ComputeParticleSystem } from './particle_compute.ts';

// Procedural noise generation
export {
    ProceduralNoiseCompute,
    createCandySwirlTexture
} from './noise_generator.ts';
export type { NoiseConfig } from './noise_generator.ts';

// Mesh deformation
export {
    MeshDeformationCompute,
    DeformationType,
    createWaveDeformation,
    createJiggleDeformation,
    createWobbleDeformation
} from './mesh_deformation.ts';
export type {
    DeformationTypeValue,
    DeformationConfig,
    DeformationAudioState
} from './mesh_deformation.ts';

// WASM-accelerated mesh deformation
export {
    WasmMeshDeformation,
    BatchMeshDeformation,
    createWasmWaveDeformation,
    createWasmJiggleDeformation,
    createWasmWobbleDeformation
} from './mesh_deformation_wasm.ts';
export type { WasmDeformationConfig } from './mesh_deformation_wasm.ts';
