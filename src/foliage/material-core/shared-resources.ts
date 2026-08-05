import * as THREE from 'three';
import { vec3, uniform } from 'three/tsl';
import { CommonGeometries } from '../../utils/geometry-dedup.ts';

export const sharedGeometries: { [key: string]: THREE.BufferGeometry } = {
    get unitSphere() {
        return CommonGeometries.unitSphere;
    },
    get unitCylinder() {
        return CommonGeometries.unitCylinder;
    },
    get unitCone() {
        return CommonGeometries.unitCone;
    },
    get quad() {
        return CommonGeometries.unitPlane;
    },
    get sphere() {
        return CommonGeometries.unitSphere;
    },
    get sphereLow() {
        return CommonGeometries.unitSphereLow;
    },
    get cylinder() {
        return CommonGeometries.unitCylinder;
    },
    get cylinderLow() {
        return CommonGeometries.unitCylinderLow;
    },
    get capsule() {
        return CommonGeometries.capsule;
    },
    get eye() {
        return CommonGeometries.eye;
    },
    get pupil() {
        return CommonGeometries.pupil;
    },
    get mushroomCap() {
        return CommonGeometries.mushroomCap;
    },
    get mushroomGillCenter() {
        return CommonGeometries.mushroomGillCenter;
    },
    get mushroomSmile() {
        return CommonGeometries.mushroomSmile;
    },
};

export const eyeGeo = sharedGeometries.eye;
export const pupilGeo = sharedGeometries.pupil;

export const _scratchVec1 = new THREE.Vector3();
export const _scratchVec2 = new THREE.Vector3();
export const _scratchVec3 = new THREE.Vector3();

export const uWindSpeed = uniform(0.0);
export const uWindDirection = uniform(vec3(1, 0, 0));
export const uTime = uniform(0.0);
export const uGlitchIntensity = uniform(0.0);
export const uGlitchExplosionCenter = uniform(vec3(0, 0, 0));
export const uGlitchExplosionRadius = uniform(0.0);
export const uAudioLow = uniform(0.0);
export const uAudioHigh = uniform(0.0);
export const uPlayerPosition = uniform(vec3(0, 0, 0));
export const uPlayerVelocity = uniform(vec3(0, 0, 0));

const materialCache = new Map<string, THREE.Material>();

export function getCachedProceduralMaterial(
    key: string,
    colorHint: number | string | THREE.Color,
    factory: () => THREE.Material
): THREE.Material {
    if (materialCache.has(key)) {
        return materialCache.get(key)!;
    }
    const material = factory();
    materialCache.set(key, material);
    return material;
}

const _medianScratch = new Float32Array(64);

export function median(arr: number[]): number {
    const len = arr.length;
    if (len === 0) return 0;

    if (len > _medianScratch.length) {
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(len / 2);
        return len % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    for (let i = 0; i < len; i++) {
        _medianScratch[i] = arr[i];
    }

    _medianScratch.subarray(0, len).sort();

    const mid = Math.floor(len / 2);
    return len % 2 !== 0 ? _medianScratch[mid] : (_medianScratch[mid - 1] + _medianScratch[mid]) / 2;
}

export function generateNoiseTexture(size = 256): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size * 4; i++) {
        data[i] = Math.random() * 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
}
