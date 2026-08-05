import * as THREE from 'three';
import { getCIAdjustedCount } from '../../core/config.ts';

export const _scratchTreeMatrix = new THREE.Matrix4();
export const _scratchTreeOriginalQuaternion = new THREE.Quaternion();
export const _scratchTreeFinalQuaternion = new THREE.Quaternion();
export const _scratchPosition = new THREE.Vector3();
export const _scratchScale = new THREE.Vector3();

// Zero-allocation static batch queue buffers
export const BATCH_QUEUE_LIMIT = 500 * 6; // MAX_INSTANCES * (trunks+spheres+capsules+helices+roses+leaves)
export const _batchPositions = new Float32Array(BATCH_QUEUE_LIMIT * 3);
export const _batchQuaternions = new Float32Array(BATCH_QUEUE_LIMIT * 4);
export const _batchScales = new Float32Array(BATCH_QUEUE_LIMIT * 3);
export const _batchOutputMatrices = new Float32Array(BATCH_QUEUE_LIMIT * 16);

export interface PendingInstance {
    mesh: THREE.InstancedMesh;
    index: number;
    color: THREE.Color;
    animType: number;
    animOffset: number;
}

export const _defaultColorWhite = new THREE.Color(0xFFFFFF);
export const _defaultColorOrange = new THREE.Color(0xFF4500);
export const _defaultColorGreen = new THREE.Color(0x00FA9A);

// Initial capacity - grows dynamically as needed (doubles each time, capped at MAX)
export const INITIAL_INSTANCES = getCIAdjustedCount(100, 0.5, 50);
export const MAX_INSTANCES = getCIAdjustedCount(500, 0.1, 50); // Cap to prevent WebGPU uniform buffer overflow (64KB limit)
