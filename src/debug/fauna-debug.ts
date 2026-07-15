/**
 * Fauna debug visualizer — ?debugFauna=1
 * Draws velocity arrows + ground contact rings for each critter.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { FAUNA_BOID_STRIDE, type FaunaSpawnEntry } from '../systems/fauna/types.ts';

const _hasFlag = (key: string): boolean => {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
};

const DEBUG_FAUNA = _hasFlag('debugFauna');

let _scene: THREE.Scene | null = null;
let _arrows: THREE.LineSegments | null = null;
let _rings: THREE.InstancedMesh | null = null;
let _enabled = DEBUG_FAUNA;
let _maxCount = 128;

const _ringMat = new THREE.MeshBasicMaterial({
    color: 0xff69b4,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
});
const _arrowMat = new THREE.LineBasicMaterial({ color: 0x87cefa });

export function isFaunaDebugEnabled(): boolean {
    return _enabled;
}

export function initFaunaDebug(scene: THREE.Scene): void {
    if (!_enabled) return;
    _scene = scene;
    _maxCount = CONFIG.fauna?.maxInstances ?? 96;

    const ringGeo = new THREE.RingGeometry(0.12, 0.18, 12);
    ringGeo.rotateX(-Math.PI / 2);
    _rings = new THREE.InstancedMesh(ringGeo, _ringMat, _maxCount);
    _rings.count = 0;
    _rings.frustumCulled = false;
    scene.add(_rings);

    const arrowPositions = new Float32Array(_maxCount * 6);
    const arrowGeo = new THREE.BufferGeometry();
    arrowGeo.setAttribute('position', new THREE.BufferAttribute(arrowPositions, 3));
    _arrows = new THREE.LineSegments(arrowGeo, _arrowMat);
    _arrows.frustumCulled = false;
    scene.add(_arrows);

    console.log('[fauna-debug] Enabled — velocity arrows + ground rings');
}

export function updateFaunaDebug(
    heap: Float32Array,
    byteOffset: number,
    count: number,
    _entries: FaunaSpawnEntry[]
): void {
    if (!_enabled || !_rings || !_arrows) return;

    const base = byteOffset >> 2;
    const posAttr = _arrows.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const m = new THREE.Matrix4();
    const up = new THREE.Vector3(0, 1, 0);

    _rings.count = count;
    for (let i = 0; i < count; i++) {
        const b = base + i * FAUNA_BOID_STRIDE;
        const x = heap[b];
        const y = heap[b + 1];
        const z = heap[b + 2];
        const vx = heap[b + 3];
        const vz = heap[b + 5];

        m.makeTranslation(x, y + 0.02, z);
        _rings.setMatrixAt(i, m);

        const o = i * 6;
        arr[o] = x;
        arr[o + 1] = y + 0.1;
        arr[o + 2] = z;
        arr[o + 3] = x + vx * 0.5;
        arr[o + 4] = y + 0.1;
        arr[o + 5] = z + vz * 0.5;
    }

    _rings.instanceMatrix.needsUpdate = true;
    posAttr.needsUpdate = true;
}

export function setFaunaDebugScene(scene: THREE.Scene): void {
    if (_enabled && !_scene) initFaunaDebug(scene);
}
