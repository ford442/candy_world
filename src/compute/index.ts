/**
 * @file index.ts
 * @description Barrel export for compute module
 *
 * GPU classes (suffix -GPU) use WebGPU compute shaders when available
 * and automatically fall back to CPU versions. Use GPU variants for
 * large workloads (1000+ vertices, 512+ textures, 1000+ instances).
 * Use CPU variants for small/single-frame operations where GPU
 * dispatch overhead outweighs the benefit.
 */

// ============================================================================
// Compute particle system
// ============================================================================
export { ComputeParticleSystem } from './particle_compute.ts';

// ============================================================================
// Procedural noise generation (CPU)
// ============================================================================
export {
    ProceduralNoiseCompute,
    createCandySwirlTexture
} from './noise_generator.ts';
export type { NoiseConfig } from './noise_generator.ts';

// ============================================================================
// Procedural noise generation (GPU)
// ============================================================================
export {
    NoiseGeneratorGPU,
    createGPUCandySwirlTexture
} from './noise-generator-gpu.ts';
export type { NoiseGeneratorGPUConfig } from './noise-generator-gpu.ts';

// ============================================================================
// Mesh deformation (CPU)
// ============================================================================
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

// ============================================================================
// Mesh deformation (GPU)
// ============================================================================
export {
    MeshDeformationGPU,
    createGPUWaveDeformation,
    createGPUJiggleDeformation,
    createGPUWobbleDeformation
} from './mesh-deformation-gpu.ts';
export type { MeshDeformationGPUConfig } from './mesh-deformation-gpu.ts';

// ============================================================================
// WASM-accelerated mesh deformation
// ============================================================================
export {
    WasmMeshDeformation,
    BatchMeshDeformation,
    createWasmWaveDeformation,
    createWasmJiggleDeformation,
    createWasmWobbleDeformation
} from './mesh_deformation_wasm.ts';
export type { WasmDeformationConfig } from './mesh_deformation_wasm.ts';

// ============================================================================
// GPU Compute Library (shared infrastructure)
// ============================================================================
export {
    GPUComputeLibrary,
    getSharedGPUCompute
} from './gpu-compute-library.ts';
export type { PipelineConfig, ComputeMetrics } from './gpu-compute-library.ts';

// ============================================================================
// GPU Compute Shaders (WGSL sources)
// ============================================================================
export {
    MESH_DEFORM_WAVE_WGSL,
    MESH_DEFORM_JIGGLE_WGSL,
    MESH_DEFORM_WOBBLE_WGSL,
    NORMAL_RECOMPUTE_WGSL,
    NORMAL_NORMALIZE_WGSL,
    NOISE_FBM_WGSL,
    NOISE_HEIGHTMAP_WGSL,
    FRUSTUM_CULL_WGSL,
    DISTANCE_CULL_WGSL,
    COMBINED_CULL_WGSL
} from './gpu-compute-shaders.ts';
