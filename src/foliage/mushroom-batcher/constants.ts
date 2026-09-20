import * as THREE from 'three';
import { getCIAdjustedCount } from '../../core/config.ts';

export const MAX_MUSHROOMS = getCIAdjustedCount(1000, 0.1, 50); // Reduced from 4000 for WebGPU uniform buffer limits

// Scratch variables to prevent GC
export const _scratchMatrix = new THREE.Matrix4();
export const _scratchMatrix2 = new THREE.Matrix4(); // ⚡ OPTIMIZATION: Additional scratch matrix
export const _scratchPos = new THREE.Vector3();
export const _scratchScale = new THREE.Vector3();
export const _scratchQuat = new THREE.Quaternion();
export const _scratchColor = new THREE.Color();
// ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
export const _scratchCapCenter = new THREE.Vector3();
export const _scratchSpotScale = new THREE.Vector3();
export const _scratchUp = new THREE.Vector3(0, 1, 0);
export const _scratchEye = new THREE.Vector3();
export const _scratchDummyObj = new THREE.Object3D();

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
import { float } from 'three/tsl';
export const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};
