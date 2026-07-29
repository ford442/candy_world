/**
 * @file webgpu-limits.ts
 * @description WebGPU device limits detection and material fallback handling
 * 
 * Addresses the vertex buffer limit issue where complex TSL materials
 * with instancing can exceed device limits (typically 8 buffers).
 * 
 * @example
 * ```ts
 * import { getWebGPULimits, createMaterialWithFallback } from './webgpu-limits';
 * 
 * // Check limits
 * const limits = getWebGPULimits(renderer);
 * console.log(`Max vertex buffers: ${limits.maxVertexBuffers}`);
 * 
 * // Create material with automatic fallback
 * const material = createMaterialWithFallback(
 *     () => createComplexTSLMaterial(),  // Complex version
 *     () => createSimpleMaterial()        // Fallback version
 * );
 * ```
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { getGpuContextSync, GPU_REQUIRED_LIMITS } from './gpu-context.ts';

/**
 * WebGPU device limits
 *
 * Sourced from the single shared device owned by `gpu-context.ts`. Before that
 * device exists (or on the WebGL path) these are the WebGPU spec defaults,
 * which every conformant adapter guarantees.
 */
export interface WebGPULimits {
    maxVertexBuffers: number;
    maxVertexAttributes: number;
    maxBindGroups: number;
    /** Largest storage buffer a compute pass may bind, in bytes. */
    maxStorageBufferBindingSize: number;
    /** Largest workgroup X dimension a compute kernel may declare. */
    maxComputeWorkgroupSizeX: number;
    maxComputeInvocationsPerWorkgroup: number;
    isWebGPUAvailable: boolean;
}

/** WebGPU spec defaults — the floor every adapter must provide. */
const SPEC_DEFAULT_LIMITS: WebGPULimits = {
    maxVertexBuffers: 8,
    maxVertexAttributes: 16,
    maxBindGroups: 4,
    maxStorageBufferBindingSize: GPU_REQUIRED_LIMITS.maxStorageBufferBindingSize,
    maxComputeWorkgroupSizeX: GPU_REQUIRED_LIMITS.maxComputeWorkgroupSizeX,
    maxComputeInvocationsPerWorkgroup: GPU_REQUIRED_LIMITS.maxComputeInvocationsPerWorkgroup,
    isWebGPUAvailable: false
};

// Cached limits
let cachedLimits: WebGPULimits | null = null;

function readLimits(limits: Record<string, number> | GPUSupportedLimits): WebGPULimits {
    const get = (key: keyof WebGPULimits): number =>
        (limits as any)[key] || (SPEC_DEFAULT_LIMITS[key] as number);

    return {
        maxVertexBuffers: get('maxVertexBuffers'),
        maxVertexAttributes: get('maxVertexAttributes'),
        maxBindGroups: get('maxBindGroups'),
        maxStorageBufferBindingSize: get('maxStorageBufferBindingSize'),
        maxComputeWorkgroupSizeX: get('maxComputeWorkgroupSizeX'),
        maxComputeInvocationsPerWorkgroup: get('maxComputeInvocationsPerWorkgroup'),
        isWebGPUAvailable: true
    };
}

/**
 * Detect WebGPU device limits
 *
 * Prefers the shared context's device (the one device the renderer owns), then
 * a renderer passed in directly, then conservative spec defaults. Results are
 * only cached once a real device has been seen, so early callers do not pin
 * the defaults for the rest of the session.
 *
 * @param renderer Optional renderer; only consulted when the shared context
 *                 has not been armed yet.
 */
export function getWebGPULimits(renderer?: THREE.Renderer): WebGPULimits {
    if (cachedLimits) return cachedLimits;

    try {
        // Preferred source: the single shared device.
        const ctx = getGpuContextSync();
        if (ctx.available && ctx.limits) {
            cachedLimits = readLimits(ctx.limits);
            console.log('[WebGPULimits] Adopted shared device limits:', cachedLimits);
            return cachedLimits;
        }

        // Fallback: read straight off a renderer that has already initialised.
        const backend = (renderer as any)?.backend;
        if (backend?.device?.limits) {
            cachedLimits = readLimits(backend.device.limits);
            console.log('[WebGPULimits] Detected device limits:', cachedLimits);
            return cachedLimits;
        }

        if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
            // Device not up yet — do NOT cache, so a later call can adopt it.
            console.log('[WebGPULimits] WebGPU available, using spec defaults until device creation');
            return SPEC_DEFAULT_LIMITS;
        }
    } catch (e) {
        console.warn('[WebGPULimits] Could not detect WebGPU limits:', e);
    }

    cachedLimits = { ...SPEC_DEFAULT_LIMITS };
    return cachedLimits;
}

/**
 * Clamp a desired storage-buffer size to what the shared device actually
 * granted. Compute consumers call this instead of assuming 128 MB.
 */
export function clampStorageBufferSize(desiredBytes: number): number {
    return Math.min(desiredBytes, getWebGPULimits().maxStorageBufferBindingSize);
}

/**
 * Clamp a desired compute workgroup X size to the shared device's ceiling.
 */
export function clampWorkgroupSizeX(desired: number): number {
    const limits = getWebGPULimits();
    return Math.min(desired, limits.maxComputeWorkgroupSizeX, limits.maxComputeInvocationsPerWorkgroup);
}

/**
 * Clear cached limits (call after device recreation)
 */
export function clearWebGPULimitsCache(): void {
    cachedLimits = null;
}

/**
 * Check if complex instancing is supported
 * Complex instancing needs:
 * - position, normal, uv (3 buffers)
 * - instanceMatrix (4 buffers - mat4x4)
 * - instanceColor (1 buffer)
 * - Plus any custom TSL attributes
 * 
 * Total: 8+ buffers for complex materials
 */
export function supportsComplexInstancing(renderer?: THREE.Renderer): boolean {
    const limits = getWebGPULimits(renderer);
    return limits.maxVertexBuffers >= 16; // Need 16 for complex TSL + instancing
}

/**
 * Check if basic instancing is supported
 * Basic instancing needs:
 * - position, normal, uv (3 buffers)
 * - instanceMatrix (4 buffers)
 * Total: 7 buffers
 */
export function supportsBasicInstancing(renderer?: THREE.Renderer): boolean {
    const limits = getWebGPULimits(renderer);
    return limits.maxVertexBuffers >= 8;
}

/**
 * Material creation options with fallback
 */
export interface MaterialFallbackOptions<T> {
    // Function to create the complex (preferred) material
    createComplex: () => T;
    // Function to create the simple (fallback) material
    createSimple: () => T;
    // Renderer instance for limit detection
    renderer?: THREE.Renderer;
    // Force simple material (for testing)
    forceSimple?: boolean;
}

/**
 * Create a material with automatic fallback based on device limits
 * 
 * @example
 * ```ts
 * const material = createMaterialWithFallback({
 *     createComplex: () => {
 *         const mat = new MeshStandardNodeMaterial({ color: 0xFF0000 });
 *         mat.colorNode = someComplexTSLNode;
 *         return mat;
 *     },
 *     createSimple: () => new MeshStandardMaterial({ color: 0xFF0000 }),
 *     renderer: webGPURenderer
 * });
 * ```
 */
export function createMaterialWithFallback<T>(
    options: MaterialFallbackOptions<T>
): T {
    const { createComplex, createSimple, renderer, forceSimple } = options;

    // Force simple if requested
    if (forceSimple) {
        console.log('[WebGPULimits] Using simple material (forced)');
        return createSimple();
    }

    // Check if we can use complex materials
    if (!supportsComplexInstancing(renderer)) {
        console.log('[WebGPULimits] Using simple material fallback (complex instancing not supported)');
        return createSimple();
    }

    try {
        const material = createComplex();
        console.log('[WebGPULimits] Using complex TSL material');
        return material;
    } catch (e) {
        console.warn('[WebGPULimits] Complex material creation failed, using fallback:', e);
        return createSimple();
    }
}

/**
 * Simplify an existing material by removing TSL nodes
 * Useful for dynamically downgrading materials when pipeline creation fails
 */
export function simplifyMaterial(
    material: MeshStandardNodeMaterial
): MeshStandardNodeMaterial {
    // Clone the material
    const simple = material.clone();
    
    // Remove TSL nodes that add vertex buffer requirements
    simple.colorNode = undefined;
    simple.emissiveNode = undefined;
    simple.normalNode = undefined;
    simple.opacityNode = undefined;
    simple.roughnessNode = undefined;
    simple.metalnessNode = undefined;
    
    // Keep basic properties
    simple.color = material.color;
    simple.emissive = material.emissive;
    simple.emissiveIntensity = material.emissiveIntensity;
    simple.roughness = material.roughness;
    simple.metalness = material.metalness;
    simple.transparent = material.transparent;
    simple.opacity = material.opacity;
    simple.side = material.side;
    
    console.log('[WebGPULimits] Simplified material:', material.name || 'unnamed');
    
    return simple;
}

/**
 * Check if a pipeline error is related to vertex buffer limits
 */
export function isVertexBufferLimitError(error: any): boolean {
    if (!error) return false;
    
    const message = error.message || String(error);
    return (
        message.includes('vertex buffer') &&
        (message.includes('exceeds') || message.includes('limit') || message.includes('maximum'))
    );
}

/**
 * Global error handler for WebGPU pipeline errors
 * Can be used to automatically downgrade materials
 */
export class WebGPUPipelineErrorHandler {
    private failedMaterials = new Set<string>();
    private materialCache = new Map<string, THREE.Material>();

    /**
     * Handle a pipeline error for a specific material
     * Returns a simplified material if possible
     */
    handleError(
        material: THREE.Material,
        error: any,
        meshIdentifier?: string
    ): THREE.Material | null {
        const id = material.uuid || meshIdentifier || 'unknown';
        
        if (this.failedMaterials.has(id)) {
            // Already failed once, don't retry
            return null;
        }

        if (isVertexBufferLimitError(error)) {
            console.warn(`[WebGPUPipelineErrorHandler] Vertex buffer limit hit for material ${id}, simplifying...`);
            
            this.failedMaterials.add(id);
            
            // Try to simplify the material
            if (material instanceof MeshStandardNodeMaterial) {
                const simplified = simplifyMaterial(material);
                this.materialCache.set(id, simplified);
                return simplified;
            }
        }

        return null;
    }

    /**
     * Get a cached simplified material
     */
    getSimplifiedMaterial(originalId: string): THREE.Material | undefined {
        return this.materialCache.get(originalId);
    }

    /**
     * Clear all cached materials
     */
    clear(): void {
        this.failedMaterials.clear();
        this.materialCache.clear();
    }
}

// Global error handler instance
export const pipelineErrorHandler = new WebGPUPipelineErrorHandler();

/**
 * Vertex buffer usage estimator
 * Estimates how many vertex buffers a material will use
 */
export function estimateVertexBufferUsage(
    geometry?: THREE.BufferGeometry,
    material?: THREE.Material,
    instanced?: boolean
): number {
    let count = 0;

    // Base geometry attributes
    if (geometry) {
        if (geometry.attributes.position) count += 1;
        if (geometry.attributes.normal) count += 1;
        if (geometry.attributes.uv) count += 1;
        if (geometry.attributes.uv2) count += 1;
        if (geometry.attributes.color) count += 1;
        if (geometry.attributes.tangent) count += 1;
    } else {
        // Assume basic geometry needs at least position + normal
        count += 2;
    }

    // Instancing attributes
    if (instanced) {
        // instanceMatrix takes 4 slots (vec4 x 4)
        count += 4;
        // instanceColor takes 1 slot
        count += 1;
    }

    // Material-specific attributes
    if (material instanceof MeshStandardNodeMaterial) {
        // TSL materials may add custom attributes
        // This is a rough estimate
        if (material.colorNode) count += 0; // Usually doesn't add buffers
        if (material.normalNode) count += 0; // Transform only
        // Note: Actual buffer count depends on TSL node complexity
    }

    return count;
}

/**
 * Log vertex buffer usage for debugging
 */
export function logVertexBufferUsage(
    name: string,
    geometry?: THREE.BufferGeometry,
    material?: THREE.Material,
    instanced?: boolean
): void {
    const usage = estimateVertexBufferUsage(geometry, material, instanced);
    const limits = getWebGPULimits();
    const percent = (usage / limits.maxVertexBuffers) * 100;
    
    console.log(
        `[WebGPULimits] ${name}: ~${usage}/${limits.maxVertexBuffers} vertex buffers (${percent.toFixed(1)}%)`
    );
    
    if (usage > limits.maxVertexBuffers) {
        console.warn(`[WebGPULimits] ${name} exceeds vertex buffer limit!`);
    }
}
