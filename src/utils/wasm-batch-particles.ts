import {
    wasmUpdateParticles,
    wasmSpawnBurst,
    cppBatchGroundHeightSimd,
    getEmscriptenInstance,
    emscriptenMemory
} from './wasm-loader-core.ts';

// =============================================================================
// PARTICLE FUNCTIONS FROM ASSEMBLY/PARTICLES.TS
// =============================================================================

/**
 * Update particles with physics
 * @param positions - Float32Array of particle positions [x0, y0, z0, x1, y1, z1, ...] or pointer offset
 * @param count - Number of particles
 * @param dt - Delta time
 * @param gravity - Gravity value
 */
export function updateParticles(
    positions: Float32Array | number,
    count: number,
    dt: number,
    gravity: number
): void {
    if (wasmUpdateParticles && typeof positions === 'number') {
        wasmUpdateParticles(positions, count, dt, gravity);
        return;
    }
    
    // JS fallback: Simple gravity update
    if (positions instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3 + 1; // Y component
            positions[idx] += gravity * dt;
        }
    }
}

/**
 * Spawn a burst of particles from a center point
 * @param output - Float32Array to write positions/velocities [x0, y0, z0, vx0, vy0, vz0, ...] or pointer offset
 * @param count - Number of particles to spawn
 * @param centerX - Center X position
 * @param centerY - Center Y position
 * @param centerZ - Center Z position
 * @param speed - Initial speed
 * @param time - Time value for randomization
 */
export function spawnBurst(
    output: Float32Array | number,
    count: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    speed: number,
    time: number
): void {
    if (wasmSpawnBurst && typeof output === 'number') {
        wasmSpawnBurst(output, count, centerX, centerY, centerZ, speed, time);
        return;
    }
    
    // JS fallback: Random burst pattern
    if (output instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 6;
            // Random direction on sphere
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const vx = Math.sin(phi) * Math.cos(theta) * speed;
            const vy = Math.sin(phi) * Math.sin(theta) * speed;
            const vz = Math.cos(phi) * speed;
            
            output[idx] = centerX;
            output[idx + 1] = centerY;
            output[idx + 2] = centerZ;
            output[idx + 3] = vx;
            output[idx + 4] = vy;
            output[idx + 5] = vz;
        }
    }
}

/**
 * Computes base ground height via WASM for an array of [x, z] coordinates.
 * Relies on the C++ export `batchGroundHeight_simd`.
 * @param coordinates Interleaved [x0, z0, x1, z1...]
 * @returns Array of height values [y0, y1, y2...]
 */
export function getHeightmapBatch(coordinates: Float32Array): Float32Array {
    if (!cppBatchGroundHeightSimd || !emscriptenMemory) {
        // Fallback if WASM function isn't ready
        console.warn("[WASM Batch] cppBatchGroundHeightSimd not found, using JS fallback");
        const count = coordinates.length / 2;
        const result = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const x = coordinates[i * 2];
            const z = coordinates[i * 2 + 1];
            result[i] = Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
                        Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
        }
        return result;
    }

    const count = coordinates.length / 2;
    const inputBytes = coordinates.length * 4;
    const outputBytes = count * 4;

    const emModule = getEmscriptenInstance() as any;

    // Allocate memory in WASM heap
    const inputPtr = emModule._malloc(inputBytes);
    const outputPtr = emModule._malloc(outputBytes);

    try {
        // Copy data to WASM memory
        const wasmHeap = new Float32Array(emscriptenMemory.buffer);
        wasmHeap.set(coordinates, inputPtr / 4);

        // Execute batch calculation
        cppBatchGroundHeightSimd(inputPtr, count, outputPtr);

        // Extract results
        const result = new Float32Array(count);
        const wasmView = new Float32Array(emscriptenMemory.buffer, outputPtr, count);
        result.set(wasmView);

        let hasNan = false;
        for (let i = 0; i < count; i++) {
            if (isNaN(result[i]) || Math.abs(result[i]) > 1000) {
                hasNan = true;
                const x = coordinates[i * 2];
                const z = coordinates[i * 2 + 1];
                result[i] = Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
                            Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
            }
        }

        if (hasNan) {
             console.warn("[WASM Batch] NaN or Out of Bounds detected in batch output, repaired with JS fallback");
        }

        return result;
    } finally {
        // Always free allocated memory
        emModule._free(inputPtr);
        emModule._free(outputPtr);
    }
}
