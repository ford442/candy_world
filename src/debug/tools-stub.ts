/**
 * Thin debug-tool stubs — stay in the `app` chunk so production boot never
 * sync-imports heavy debug modules. Real implementations load via dynamic import
 * when URL debug flags are active.
 */
import type * as THREE from 'three';

function urlFlag(key: string): boolean {
    try {
        return new URLSearchParams(window.location.search).get(key) === '1';
    } catch {
        return false;
    }
}

const groundFlags = () =>
    urlFlag('debugHeights') || urlFlag('debugPlayer') || urlFlag('debugClouds');
const cloudFlags = () => urlFlag('debugClouds') || urlFlag('debugHeights');

type GroundDebugMod = typeof import('./ground-debug.ts');
type PlaceDebugMod = typeof import('./debug-place.ts');
type CircadianDebugMod = typeof import('./circadian-debug.ts');
type FaunaDebugMod = typeof import('./fauna-debug.ts');

let _groundMod: GroundDebugMod | null = null;
let _groundLoad: Promise<GroundDebugMod | null> | null = null;
let _placeMod: PlaceDebugMod | null = null;
let _placeLoad: Promise<PlaceDebugMod | null> | null = null;
let _circadianMod: CircadianDebugMod | null = null;
let _circadianLoad: Promise<CircadianDebugMod | null> | null = null;
let _faunaMod: FaunaDebugMod | null = null;
let _faunaLoad: Promise<FaunaDebugMod | null> | null = null;

function loadGround(): Promise<GroundDebugMod | null> {
    if (!groundFlags()) return Promise.resolve(null);
    if (_groundMod) return Promise.resolve(_groundMod);
    if (!_groundLoad) {
        _groundLoad = import('./ground-debug.ts').then((m) => {
            _groundMod = m;
            return m;
        });
    }
    return _groundLoad;
}

function loadPlace(): Promise<PlaceDebugMod | null> {
    if (!urlFlag('debugPlace')) return Promise.resolve(null);
    if (_placeMod) return Promise.resolve(_placeMod);
    if (!_placeLoad) {
        _placeLoad = import('./debug-place.ts').then((m) => {
            _placeMod = m;
            return m;
        });
    }
    return _placeLoad;
}

function loadCircadian(): Promise<CircadianDebugMod | null> {
    if (!urlFlag('debugCircadian')) return Promise.resolve(null);
    if (_circadianMod) return Promise.resolve(_circadianMod);
    if (!_circadianLoad) {
        _circadianLoad = import('./circadian-debug.ts').then((m) => {
            _circadianMod = m;
            return m;
        });
    }
    return _circadianLoad;
}

function loadFauna(): Promise<FaunaDebugMod | null> {
    if (!urlFlag('debugFauna')) return Promise.resolve(null);
    if (_faunaMod) return Promise.resolve(_faunaMod);
    if (!_faunaLoad) {
        _faunaLoad = import('./fauna-debug.ts').then((m) => {
            _faunaMod = m;
            return m;
        });
    }
    return _faunaLoad;
}

export function isGroundDebugEnabled(): boolean {
    return groundFlags();
}

export function isPlacementDebugEnabled(): boolean {
    return urlFlag('debugPlace');
}

export function isCircadianDebugEnabled(): boolean {
    return urlFlag('debugCircadian');
}

export function isFaunaDebugEnabled(): boolean {
    return urlFlag('debugFauna');
}

export function initGroundDebug(scene: THREE.Scene): void {
    void loadGround().then((m) => m?.initGroundDebug(scene));
}

export function initPlacementDebug(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    void loadPlace().then((m) => m?.initPlacementDebug(scene, camera));
}

export function initCircadianDebug(opts?: {
    timeOffset: { value: number };
    getGameTime: () => number;
}): void {
    void loadCircadian().then((m) => m?.initCircadianDebug(opts));
}

export function initFaunaDebug(scene: THREE.Scene): void {
    void loadFauna().then((m) => m?.initFaunaDebug(scene));
}

export function registerPlantedInstance(
    x: number,
    y: number,
    z: number,
    type?: string,
    footprintRadius?: number,
    normal?: THREE.Vector3
): void {
    if (!urlFlag('debugHeights')) return;
    void loadGround().then((m) => m?.registerPlantedInstance(x, y, z, type, footprintRadius, normal));
}

export function registerCloudPlatform(cloud: THREE.Object3D): void {
    if (!cloudFlags()) return;
    void loadGround().then((m) => m?.registerCloudPlatform(cloud));
}

export function unregisterCloudPlatform(cloud: THREE.Object3D): void {
    if (!cloudFlags()) return;
    void loadGround().then((m) => m?.unregisterCloudPlatform(cloud));
}

export function updateGroundDebug(playerPos: THREE.Vector3, cameraPos: THREE.Vector3): void {
    if (!groundFlags()) return;
    if (_groundMod) {
        _groundMod.updateGroundDebug(playerPos, cameraPos);
        return;
    }
    void loadGround().then((m) => m?.updateGroundDebug(playerPos, cameraPos));
}

export function updatePlacementDebug(cameraPos: THREE.Vector3, cameraDir: THREE.Vector3): void {
    if (!urlFlag('debugPlace')) return;
    if (_placeMod) {
        _placeMod.updatePlacementDebug(cameraPos, cameraDir);
        return;
    }
    void loadPlace().then((m) => m?.updatePlacementDebug(cameraPos, cameraDir));
}

export function updateCircadianDebug(dayNightBias: number): void {
    if (!urlFlag('debugCircadian')) return;
    if (_circadianMod) {
        _circadianMod.updateCircadianDebug(dayNightBias);
        return;
    }
    void loadCircadian().then((m) => m?.updateCircadianDebug(dayNightBias));
}

export function updateFaunaDebug(
    heap: Float32Array,
    byteOffset: number,
    count: number,
    entries: readonly import('../systems/fauna/types.ts').FaunaSpawnEntry[],
): void {
    if (!urlFlag('debugFauna')) return;
    if (_faunaMod) {
        _faunaMod.updateFaunaDebug(heap, byteOffset, count, [...entries]);
        return;
    }
    void loadFauna().then((m) => m?.updateFaunaDebug(heap, byteOffset, count, [...entries]));
}

export function setFaunaDebugScene(scene: THREE.Scene): void {
    if (!urlFlag('debugFauna')) return;
    void loadFauna().then((m) => m?.setFaunaDebugScene(scene));
}
