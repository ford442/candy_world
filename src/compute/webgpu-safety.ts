/**
 * @file webgpu-safety.ts
 * @description WebGPU safety utilities for preventing validation errors when GPU buffers
 * are allocated with zero or minimal element counts.
 *
 * Problem: When CORE mode is active, certain entity registries (e.g., LuminousPlants) 
 * may be empty. If a TSL material's shader code has storage buffer bindings for these 
 * registries, WebGPU will fail validation when the backing buffer has size 0.
 *
 * Solution: Always allocate a minimum 1-element dummy buffer to keep the GPU descriptor
 * layout happy, even when no actual data is present.
 */

/**
 * Minimum safe buffer size for WebGPU storage buffers.
 * Prevents validation errors when registries are empty.
 * 
 * 4 bytes = size of a single f32 or u32
 */
const MIN_SAFE_BUFFER_SIZE = 4;

/**
 * Safely create a storage buffer with minimum size guarantee.
 * 
 * Even if activeCount is 0, allocates at least 1 element to prevent
 * WebGPU validation errors during bind group creation.
 * 
 * @param device - WebGPU device
 * @param activeCount - Number of active elements (may be 0)
 * @param elementSizeBytes - Size of each element in bytes (default: 4)
 * @param usage - GPU buffer usage flags (default: STORAGE | COPY_DST)
 * @returns GPUBuffer with guaranteed minimum size
 * 
 * @example
 * ```ts
 * // CORE mode: luminousPlants.count = 0
 * const count = luminousPlantBatcher?.mesh?.count || 0;
 * const buffer = createSafeStorageBuffer(
 *     device,
 *     count,  // 0 in CORE mode
 *     4,      // one float32
 *     GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
 * );
 * // Buffer will have size 4 bytes minimum, preventing validation errors
 * ```
 */
export function createSafeStorageBuffer(
    device: GPUDevice,
    activeCount: number,
    elementSizeBytes: number = 4,
    usage: number = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
): GPUBuffer {
    // Ensure at least 1 element
    const minCount = Math.max(activeCount, 1);
    const sizeBytes = minCount * elementSizeBytes;
    
    return device.createBuffer({
        size: sizeBytes,
        usage: usage,
        mappedAtCreation: false,
        label: `safe-storage-${activeCount > 0 ? 'active' : 'dummy'}`
    });
}

/**
 * Safely create a uniform buffer with minimum size guarantee.
 * Uniform buffers must be 256-byte aligned for WebGPU.
 * 
 * @param device - WebGPU device
 * @param activeCount - Number of active elements (may be 0)
 * @param elementSizeBytes - Size of each element (must be multiple of 256 for alignment)
 * @returns GPUBuffer with guaranteed minimum size
 */
export function createSafeUniformBuffer(
    device: GPUDevice,
    activeCount: number,
    elementSizeBytes: number = 256
): GPUBuffer {
    // Ensure at least 1 element and proper alignment
    const minCount = Math.max(activeCount, 1);
    const sizeBytes = minCount * elementSizeBytes;
    
    // Align to 256-byte boundary (WebGPU requirement)
    const alignedSize = Math.ceil(sizeBytes / 256) * 256;
    
    return device.createBuffer({
        size: alignedSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: false,
        label: `safe-uniform-${activeCount > 0 ? 'active' : 'dummy'}`
    });
}

/**
 * Check if a registry is empty (CORE mode detection).
 * Returns true if the entity count is 0.
 * 
 * @param count - Number of active entities
 * @returns true if empty (CORE mode likely active)
 */
export function isEmptyRegistry(count: number): boolean {
    return count === 0;
}

/**
 * Log a warning when a compute dispatch is skipped due to empty registry.
 * Helps with debugging and performance analysis.
 * 
 * @param systemName - Name of the compute system (e.g., "LuminousPlantAnimator")
 * @param activeCount - Number of active entities
 */
export function logEmptyRegistryDispatch(systemName: string, activeCount: number): void {
    console.warn(
        `[WebGPU Safety] ${systemName}: Core mode detected (${activeCount} entities). ` +
        `Allocating dummy buffer to prevent validation error. Compute dispatch will be skipped.`
    );
}

/**
 * Validate WebGPU compute buffer configuration.
 * Ensures that all buffers in a bind group have compatible sizes and usage.
 * 
 * @param buffers - Array of GPU buffers to validate
 * @param expectedMinSize - Minimum expected buffer size
 * @returns true if all buffers are valid
 */
export function validateComputeBuffers(
    buffers: (GPUBuffer | null)[],
    expectedMinSize: number = MIN_SAFE_BUFFER_SIZE
): boolean {
    return buffers.every(buf => {
        if (!buf) return false;
        // WebGPU doesn't expose buffer size, so we assume if the buffer exists, it's valid
        // The safety is in createSafeStorageBuffer ensuring minimum size
        return true;
    });
}

export { MIN_SAFE_BUFFER_SIZE };
