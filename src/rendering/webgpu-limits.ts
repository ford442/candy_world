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

/**
 * WebGPU device limits
 */
export interface WebGPULimits {
    maxVertexBuffers: number;
    maxVertexAttributes: number;
    maxBindGroups: number;
    isWebGPUAvailable: boolean;
}

// Cached limits
let cachedLimits: WebGPULimits | null = null;

/**
 * Detect WebGPU device limits
 * Returns conservative defaults if WebGPU is not available
 */
export function getWebGPULimits(renderer?: THREE.Renderer): WebGPULimits {
    if (cachedLimits) return cachedLimits;

    // Default conservative limits (guaranteed by WebGPU spec)
    const defaults: WebGPULimits = {
        maxVertexBuffers: 8,
        maxVertexAttributes: 16,
        maxBindGroups: 4,
        isWebGPUAvailable: false
    };

    try {
        // Try to access WebGPU backend through the renderer
        if (renderer && (renderer as any).backend) {
            const backend = (renderer as any).backend;
            
            // Check if it's WebGPU backend
            if (backend.adapter && backend.device) {
                const device = backend.device;
                const limits = device.limits;
                
                cachedLimits = {
                    maxVertexBuffers: limits.maxVertexBuffers || 8,
                    maxVertexAttributes: limits.maxVertexAttributes || 16,
                    maxBindGroups: limits.maxBindGroups || 4,
                    isWebGPUAvailable: true
                };
                
                console.log('[WebGPULimits] Detected device limits:', cachedLimits);
                return cachedLimits;
            }
        }
        
        // Try to get limits from navigator.gpu
        if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
            // We'll get actual limits when device is created
            console.log('[WebGPULimits] WebGPU available, using conservative defaults until device creation');
        }
    } catch (e) {
        console.warn('[WebGPULimits] Could not detect WebGPU limits:', e);
    }

    cachedLimits = defaults;
    return defaults;
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
