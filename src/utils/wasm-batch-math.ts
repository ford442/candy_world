import { getEmscriptenInstance } from "./wasm-loader-cpp.ts";
import {

    cppValueNoise2DSimd4,
    cppFbm2DSimd4,
    cppBatchGroundHeightSimd,
    cppBatchValueNoiseOmp,
    cppBatchFbmOmp,
    cppBatchDistSq3DOmp,
    cppFastSin,
    cppFastCos,
    cppFastPow2,
    wasmBatchHslToRgb,
    wasmBatchSphereCull,
    wasmBatchLerp
} from './wasm-loader-core.ts';

const MATH_STRIDE = 4; // 4 floats per result (rotX, rotY, rotZ, scale)

// =============================================================================
// UTILITY FALLBACK FUNCTIONS
// =============================================================================

/**
 * JS fallback for valueNoise2D_simd4
 */
function valueNoise2DJS(x: number, y: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const u = x - fx;
    const v = y - fy;
    
    const hash = (x: number, y: number): number => {
        let n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    };
    
    const n00 = hash(fx, fy);
    const n10 = hash(fx + 1, fy);
    const n01 = hash(fx, fy + 1);
    const n11 = hash(fx + 1, fy + 1);
    
    // Smooth interpolation
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    
    return n00 * (1 - su) * (1 - sv) +
           n10 * su * (1 - sv) +
           n01 * (1 - su) * sv +
           n11 * su * sv;
}

/**
 * JS fallback for fbm2D
 */
function fbm2DJS(x: number, y: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    
    for (let i = 0; i < octaves; i++) {
        value += valueNoise2DJS(x * frequency, y * frequency) * amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    
    return value;
}

// =============================================================================
// BATCH COLOR/GEOMETRY FUNCTIONS
// =============================================================================

/**
 * Batch HSL to RGB conversion
 * Input format: [h0, s0, l0, h1, s1, l1, ...] (3 floats per color)
 * Output format: [r0, g0, b0, r1, g1, b1, ...] written in-place as integers packed into floats
 * @param hslData - Float32Array of HSL values (3 floats per color) or pointer offset
 * @param count - Number of colors to convert
 */
export function batchHslToRgb(hslData: Float32Array | number, count: number): void {
    if (wasmBatchHslToRgb && typeof hslData === 'number') {
        // Use WASM batch function with pointer
        wasmBatchHslToRgb(hslData, count);
        return;
    }
    
    // JS fallback: Convert HSL to RGB in-place
    if (hslData instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const h = hslData[idx];
            const s = hslData[idx + 1];
            const l = hslData[idx + 2];
            
            const hue2rgb = (p: number, q: number, t: number): number => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };

            let r: number, g: number, b: number;
            if (s === 0) {
                r = g = b = l;
            } else {
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r = hue2rgb(p, q, h + 1/3);
                g = hue2rgb(p, q, h);
                b = hue2rgb(p, q, h - 1/3);
            }
            
            hslData[idx] = r;
            hslData[idx + 1] = g;
            hslData[idx + 2] = b;
        }
    }
}

/**
 * Batch sphere culling - cull objects based on distance from camera
 * @param positions - Float32Array of positions [x0, y0, z0, x1, y1, z1, ...] or pointer offset
 * @param count - Number of positions
 * @param camX - Camera X position
 * @param camY - Camera Y position
 * @param camZ - Camera Z position
 * @param maxDist - Maximum distance
 * @param output - Output array for visibility flags (1 = visible, 0 = culled) or pointer offset
 */
export function batchSphereCull(
    positions: Float32Array | number,
    count: number,
    camX: number,
    camY: number,
    camZ: number,
    maxDist: number,
    output: Float32Array | number
): void {
    if (wasmBatchSphereCull && typeof positions === 'number' && typeof output === 'number') {
        wasmBatchSphereCull(positions, count, camX, camY, camZ, maxDist, output);
        return;
    }
    
    // JS fallback
    if (positions instanceof Float32Array && output instanceof Float32Array) {
        const maxDistSq = maxDist * maxDist;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const dx = positions[idx] - camX;
            const dy = positions[idx + 1] - camY;
            const dz = positions[idx + 2] - camZ;
            const distSq = dx * dx + dy * dy + dz * dz;
            output[i] = distSq <= maxDistSq ? 1 : 0;
        }
    }
}

/**
 * Batch linear interpolation
 * Input format: [a0, b0, t0, a1, b1, t1, ...] (3 floats per lerp)
 * Output: Results written back to the array [result0, result1, ...]
 * @param data - Float32Array of [a, b, t] triplets or pointer offset
 * @param count - Number of lerp operations
 */
export function batchLerp(data: Float32Array | number, count: number): void {
    if (wasmBatchLerp && typeof data === 'number') {
        wasmBatchLerp(data, count);
        return;
    }
    
    // JS fallback
    if (data instanceof Float32Array) {
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const a = data[idx];
            const b = data[idx + 1];
            const t = data[idx + 2];
            data[i] = a + (b - a) * t;
        }
    }
}

// =============================================================================
// C++ NOISE AND SIMD FUNCTIONS
// =============================================================================

/**
 * Batch value noise calculation using SIMD4 C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @returns Float32Array of noise values
 */
export function batchValueNoiseSimd4(x: Float32Array, y: Float32Array): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppValueNoise2DSimd4 && getEmscriptenInstance()) {
        const xPtr = getEmscriptenInstance()._malloc!(count * 4);
        const yPtr = getEmscriptenInstance()._malloc!(count * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(x, xPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(y, yPtr >> 2);
        
        cppValueNoise2DSimd4(xPtr, yPtr, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(xPtr);
        getEmscriptenInstance()._free!(yPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = valueNoise2DJS(x[i], y[i]);
    }
    return output;
}

/**
 * Batch FBM calculation using SIMD4 C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @param octaves - Number of octaves
 * @returns Float32Array of FBM values
 */
export function batchFbmSimd4(x: Float32Array, y: Float32Array, octaves: number): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppFbm2DSimd4 && getEmscriptenInstance()) {
        const xPtr = getEmscriptenInstance()._malloc!(count * 4);
        const yPtr = getEmscriptenInstance()._malloc!(count * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(x, xPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(y, yPtr >> 2);
        
        cppFbm2DSimd4(xPtr, yPtr, octaves, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(xPtr);
        getEmscriptenInstance()._free!(yPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = fbm2DJS(x[i], y[i], octaves);
    }
    return output;
}

/**
 * Batch ground height calculation using SIMD C++ function
 * @param positions - Float32Array of positions [x0, z0, x1, z1, ...]
 * @returns Float32Array of heights
 */
export function batchGroundHeightSimd(positions: Float32Array): Float32Array {
    const count = positions.length / 2;
    const output = new Float32Array(count);
    
    if (cppBatchGroundHeightSimd && getEmscriptenInstance()) {
        const posPtr = getEmscriptenInstance()._malloc!(positions.length * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!posPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(positions, posPtr >> 2);
        
        cppBatchGroundHeightSimd(posPtr, count, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(posPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback — inline getGroundHeight formula (NOT fbm)
    for (let i = 0; i < count; i++) {
        const x = positions[i * 2];
        const z = positions[i * 2 + 1];
        if (isNaN(x) || isNaN(z)) {
            output[i] = 0;
            continue;
        }
        output[i] = Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2 +
                    Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
    }
    return output;
}

/**
 * Batch value noise using OpenMP C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @returns Float32Array of noise values
 */
export function batchValueNoiseOmp(x: Float32Array, y: Float32Array): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppBatchValueNoiseOmp && getEmscriptenInstance()) {
        const xPtr = getEmscriptenInstance()._malloc!(count * 4);
        const yPtr = getEmscriptenInstance()._malloc!(count * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(x, xPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(y, yPtr >> 2);
        
        cppBatchValueNoiseOmp(xPtr, yPtr, count, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(xPtr);
        getEmscriptenInstance()._free!(yPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = valueNoise2DJS(x[i], y[i]);
    }
    return output;
}

/**
 * Batch FBM using OpenMP C++ function
 * @param x - Float32Array of X coordinates
 * @param y - Float32Array of Y coordinates
 * @param octaves - Number of octaves
 * @returns Float32Array of FBM values
 */
export function batchFbmOmp(x: Float32Array, y: Float32Array, octaves: number): Float32Array {
    const count = x.length;
    const output = new Float32Array(count);
    
    if (cppBatchFbmOmp && getEmscriptenInstance()) {
        const xPtr = getEmscriptenInstance()._malloc!(count * 4);
        const yPtr = getEmscriptenInstance()._malloc!(count * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!xPtr || !yPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(x, xPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(y, yPtr >> 2);
        
        cppBatchFbmOmp(xPtr, yPtr, count, octaves, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(xPtr);
        getEmscriptenInstance()._free!(yPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        output[i] = fbm2DJS(x[i], y[i], octaves);
    }
    return output;
}

/**
 * Batch distance squared calculation using OpenMP C++ function
 * @param ax - Float32Array of A X coordinates
 * @param ay - Float32Array of A Y coordinates
 * @param az - Float32Array of A Z coordinates
 * @param bx - B X coordinate
 * @param by - B Y coordinate
 * @param bz - B Z coordinate
 * @returns Float32Array of distances squared
 */
export function batchDistSq3DOmp(
    ax: Float32Array,
    ay: Float32Array,
    az: Float32Array,
    bx: number,
    by: number,
    bz: number
): Float32Array {
    const count = ax.length;
    const output = new Float32Array(count);
    
    if (cppBatchDistSq3DOmp && getEmscriptenInstance()) {
        const axPtr = getEmscriptenInstance()._malloc!(count * 4);
        const ayPtr = getEmscriptenInstance()._malloc!(count * 4);
        const azPtr = getEmscriptenInstance()._malloc!(count * 4);
        const outPtr = getEmscriptenInstance()._malloc!(count * 4);
        
        if (!axPtr || !ayPtr || !azPtr || !outPtr) return output;
        
        getEmscriptenInstance().HEAPF32!.set(ax, axPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(ay, ayPtr >> 2);
        getEmscriptenInstance().HEAPF32!.set(az, azPtr >> 2);
        
        cppBatchDistSq3DOmp(axPtr, ayPtr, azPtr, bx, by, bz, count, outPtr);
        
        output.set(getEmscriptenInstance().HEAPF32!.subarray(outPtr >> 2, (outPtr >> 2) + count));
        
        getEmscriptenInstance()._free!(axPtr);
        getEmscriptenInstance()._free!(ayPtr);
        getEmscriptenInstance()._free!(azPtr);
        getEmscriptenInstance()._free!(outPtr);
        
        return output;
    }
    
    // JS fallback
    for (let i = 0; i < count; i++) {
        const dx = ax[i] - bx;
        const dy = ay[i] - by;
        const dz = az[i] - bz;
        output[i] = dx * dx + dy * dy + dz * dz;
    }
    return output;
}

// =============================================================================
// FAST MATH FUNCTIONS
// =============================================================================

/**
 * Fast sine approximation using C++ function
 * @param x - Angle in radians
 * @returns Sine value
 */
export function fastSin(x: number): number {
    if (cppFastSin && getEmscriptenInstance()) {
        return cppFastSin(x);
    }
    return Math.sin(x);
}

/**
 * Fast cosine approximation using C++ function
 * @param x - Angle in radians
 * @returns Cosine value
 */
export function fastCos(x: number): number {
    if (cppFastCos && getEmscriptenInstance()) {
        return cppFastCos(x);
    }
    return Math.cos(x);
}

/**
 * Fast 2^x approximation using C++ function
 * @param x - Exponent
 * @returns 2^x value
 */
export function fastPow2(x: number): number {
    if (cppFastPow2 && getEmscriptenInstance()) {
        return cppFastPow2(x);
    }
    return Math.pow(2, x);
}
