import * as THREE from 'three';
import { DataUtils } from 'three';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.js';
import { getGroundHeight } from '../utils/wasm-loader.js';

export interface HeightmapTextures {
    heights: Float32Array;
    normals: Float32Array;
    heightTexture: THREE.DataTexture;
    normalTexture: THREE.DataTexture;
}

export async function generateGroundHeightmap(
    size: number = 400,
    resolution: number = 256
): Promise<HeightmapTextures> {
    const vertexCount = (resolution + 1) * (resolution + 1);
    const heights = new Float32Array(vertexCount);
    // Normals are RGB (3 floats per vertex)
    const normals = new Float32Array(vertexCount * 3);

    const step = size / resolution;
    const halfSize = size / 2;
    // Yield every 32 rows to keep the browser responsive during the ~330k height lookups
    const yieldEvery = 32;

    // First pass: Calculate heights
    for (let iy = 0; iy <= resolution; iy++) {
        for (let ix = 0; ix <= resolution; ix++) {
            const index = iy * (resolution + 1) + ix;

            // Map ix/iy to world coordinates
            const x = (ix * step) - halfSize;
            // Since geometry is PlaneGeometry rotated -90 on X, the Y grid maps to -Z in world space
            const zWorld = -((iy * step) - halfSize);

            const height = getUnifiedGroundHeightTyped(x, zWorld, getGroundHeight);
            heights[index] = height;
        }
        if (iy % yieldEvery === yieldEvery - 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }

    // Second pass: Calculate normals using central difference
    // Using a small delta for smooth normals
    const delta = step * 0.5;
    for (let iy = 0; iy <= resolution; iy++) {
        for (let ix = 0; ix <= resolution; ix++) {
            const index = (iy * (resolution + 1) + ix) * 3;

            const x = (ix * step) - halfSize;
            const zWorld = -((iy * step) - halfSize);

            // Sample adjacent points for central difference in world space
            const hL = getUnifiedGroundHeightTyped(x - delta, zWorld, getGroundHeight);
            const hR = getUnifiedGroundHeightTyped(x + delta, zWorld, getGroundHeight);
            const hD = getUnifiedGroundHeightTyped(x, zWorld - delta, getGroundHeight); // Z- (backward)
            const hU = getUnifiedGroundHeightTyped(x, zWorld + delta, getGroundHeight); // Z+ (forward)

            // Compute tangent vectors
            const tx = new THREE.Vector3(delta * 2, hR - hL, 0).normalize();
            // Important: we're evaluating Z+ to Z- here.
            // Plane is on XY but we sample world space. Let's just create world space normals
            const tz = new THREE.Vector3(0, hU - hD, delta * 2).normalize();

            // Normal is cross product of tangents
            const normal = new THREE.Vector3().crossVectors(tz, tx).normalize();

            normals[index] = normal.x;
            normals[index + 1] = normal.y;
            normals[index + 2] = normal.z;
        }
        if (iy % yieldEvery === yieldEvery - 1) {
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }

    // Create DataTextures
    // Height texture: RedFormat, HalfFloatType, NearestFilter
    // HalfFloat (f16) is filterable in WebGPU without extensions, avoiding the
    // 'textureLoad(texture_2d, vec2)' WGSL error caused by non-filterable f32 textures.
    const heightsHalf = new Uint16Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        heightsHalf[i] = DataUtils.toHalfFloat(heights[i]);
    }
    const heightTexture = new THREE.DataTexture(
        heightsHalf,
        resolution + 1,
        resolution + 1,
        THREE.RedFormat,
        THREE.HalfFloatType
    );
    heightTexture.minFilter = THREE.NearestFilter;
    heightTexture.magFilter = THREE.NearestFilter;
    heightTexture.needsUpdate = true;
    heightTexture.generateMipmaps = false;

    // Normal texture: RGBAFormat, HalfFloatType, LinearFilter
    // WebGPU does not support RGBFormat (3-channel) textures at all.
    // Using RGBAFormat (4-channel) with HalfFloatType so the texture is filterable,
    // allowing textureSample in WGSL instead of the broken textureLoad path.
    const normalsHalf = new Uint16Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i++) {
        normalsHalf[i * 4 + 0] = DataUtils.toHalfFloat(normals[i * 3 + 0]); // x
        normalsHalf[i * 4 + 1] = DataUtils.toHalfFloat(normals[i * 3 + 1]); // y
        normalsHalf[i * 4 + 2] = DataUtils.toHalfFloat(normals[i * 3 + 2]); // z
        normalsHalf[i * 4 + 3] = DataUtils.toHalfFloat(1.0);                // w (alpha, set to 1.0 for RGBA compatibility)
    }
    const normalTexture = new THREE.DataTexture(
        normalsHalf,
        resolution + 1,
        resolution + 1,
        THREE.RGBAFormat,
        THREE.HalfFloatType
    );
    normalTexture.minFilter = THREE.LinearFilter;
    normalTexture.magFilter = THREE.LinearFilter;
    normalTexture.needsUpdate = true;
    normalTexture.generateMipmaps = false;

    // The full-precision Float32 backing arrays are no longer needed now that the
    // GPU textures have been created from the half-float copies.  They are
    // returned as part of the struct for callers that need CPU-side sampling
    // (e.g., sampleHeightmapCPU).  Callers that don't need them should let them
    // fall out of scope so the GC can reclaim ~1 MB of heap as soon as possible.
    return { heights, normals, heightTexture, normalTexture };
}

export function sampleHeightmapCPU(
    heights: Float32Array,
    x: number,
    z: number,
    size: number = 400,
    resolution: number = 256
): number {
    const halfSize = size / 2;
    const step = size / resolution;

    // Convert world x,z to grid ix,iy
    // Since z in world is -y in grid: yGrid = -zWorld
    const fx = (x + halfSize) / step;
    const fy = (-z + halfSize) / step;

    const ix = Math.floor(fx);
    const iy = Math.floor(fy);

    // Bounds check
    if (ix < 0 || ix >= resolution || iy < 0 || iy >= resolution) {
        return 0; // Or whatever default
    }

    // Bi-linear interpolation
    const u = fx - ix;
    const v = fy - iy;

    const idx00 = iy * (resolution + 1) + ix;
    const idx10 = idx00 + 1;
    const idx01 = (iy + 1) * (resolution + 1) + ix;
    const idx11 = idx01 + 1;

    const h00 = heights[idx00];
    const h10 = heights[idx10];
    const h01 = heights[idx01];
    const h11 = heights[idx11];

    const h0 = h00 + u * (h10 - h00);
    const h1 = h01 + u * (h11 - h01);

    return h0 + v * (h1 - h0);
}

export function disposeHeightmap(textures: HeightmapTextures) {
    if (textures.heightTexture) {
        textures.heightTexture.dispose();
    }
    if (textures.normalTexture) {
        textures.normalTexture.dispose();
    }
}
