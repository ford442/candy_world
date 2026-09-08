/**
 * Thin debug-tool stubs — stay in the `app` chunk so production boot never
 * sync-imports heavy debug modules. Real implementations load via dynamic import
 * when URL debug flags are active.
 */
import type * as THREE from 'three';
import { getStartupCapabilities } from '../core/startup/capabilities.ts';

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
type PhysicsSandboxMod = typeof import('./physics-sandbox.ts');
type SoftBodyDemoMod = typeof import('./soft-body-demo.ts');
type HeroAnimDemoMod = typeof import('./hero-animation-demo.ts');

let _groundMod: GroundDebugMod | null = null;
let _groundLoad: Promise<GroundDebugMod | null> | null = null;
let _placeMod: PlaceDebugMod | null = null;
let _placeLoad: Promise<PlaceDebugMod | null> | null = null;
let _circadianMod: CircadianDebugMod | null = null;
let _circadianLoad: Promise<CircadianDebugMod | null> | null = null;
let _faunaMod: FaunaDebugMod | null = null;
let _faunaLoad: Promise<FaunaDebugMod | null> | null = null;
let _physicsMod: PhysicsSandboxMod | null = null;
let _physicsLoad: Promise<PhysicsSandboxMod | null> | null = null;
let _softBodyMod: SoftBodyDemoMod | null = null;
let _softBodyLoad: Promise<SoftBodyDemoMod | null> | null = null;
let _heroAnimMod: HeroAnimDemoMod | null = null;
let _heroAnimLoad: Promise<HeroAnimDemoMod | null> | null = null;

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

function loadPhysicsSandbox(): Promise<PhysicsSandboxMod | null> {
    if (!urlFlag('debugPhysics')) return Promise.resolve(null);
    if (_physicsMod) return Promise.resolve(_physicsMod);
    if (!_physicsLoad) {
        _physicsLoad = import('./physics-sandbox.ts').then((m) => {
            _physicsMod = m;
            return m;
        });
    }
    return _physicsLoad;
}

function loadSoftBodyDemo(): Promise<SoftBodyDemoMod | null> {
    if (!isSoftBodyDemoEnabled()) return Promise.resolve(null);
    if (_softBodyMod) return Promise.resolve(_softBodyMod);
    if (!_softBodyLoad) {
        _softBodyLoad = import('./soft-body-demo.ts').then((m) => {
            _softBodyMod = m;
            return m;
        });
    }
    return _softBodyLoad;
}

function loadHeroAnimDemo(): Promise<HeroAnimDemoMod | null> {
    if (!isHeroAnimationDemoEnabled()) return Promise.resolve(null);
    if (_heroAnimMod) return Promise.resolve(_heroAnimMod);
    if (!_heroAnimLoad) {
        _heroAnimLoad = import('./hero-animation-demo.ts').then((m) => {
            _heroAnimMod = m;
            return m;
        });
    }
    return _heroAnimLoad;
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

/** `?debugPhysics=1` — dynamic rigid-body staging area + collider gizmos. */
export function isPhysicsSandboxEnabled(): boolean {
    return urlFlag('debugPhysics');
}

let _physicsInitStarted = false;

/**
 * Load and build the staging area once, on the first frame the scene and
 * player are available. Driven from the game loop rather than a startup hook
 * so `?debugPhysics=1` works on every boot path (CORE included), not just the
 * full world-generation one.
 */
export function ensurePhysicsSandbox(scene: THREE.Scene, origin: THREE.Vector3): void {
    if (_physicsInitStarted || !urlFlag('debugPhysics')) return;
    _physicsInitStarted = true;
    const spawn = origin.clone();
    void loadPhysicsSandbox().then((m) => m?.initPhysicsSandbox(scene, spawn));
}

export function setPhysicsSandboxPlayer(position: THREE.Vector3): void {
    _physicsMod?.setPhysicsSandboxPlayer(position);
}

/**
 * Per-frame gizmo refresh. Synchronous on the already-loaded module so the
 * hot path never pays for a promise; a no-op until the dynamic import lands.
 */
export function updatePhysicsSandbox(): void {
    _physicsMod?.updatePhysicsSandbox();
}

/**
 * `?softBody=1` — experimental cloth banner. Off by default, and additionally
 * refused on the `low` graphics tier (which is what WebGL and CI/headless clamp
 * to) unless the flag is `?softBody=force`, so a smoke run never pays for it.
 */
export function isSoftBodyDemoEnabled(): boolean {
    let value: string | null = null;
    try {
        value = new URLSearchParams(window.location.search).get('softBody');
    } catch {
        return false; // non-browser (test) environment
    }
    if (value === 'force') return true;
    if (value !== '1') return false;
    try {
        return getStartupCapabilities().graphics !== 'low';
    } catch {
        return false; // capabilities unavailable — treat as the conservative tier
    }
}

let _softBodyInitStarted = false;

/**
 * Load and build the banner once, on the first frame the scene and player are
 * available — same lazy pattern as the rigid-body sandbox, so the flag works on
 * every boot path.
 */
export function ensureSoftBodyDemo(scene: THREE.Scene, origin: THREE.Vector3): void {
    if (_softBodyInitStarted || !isSoftBodyDemoEnabled()) return;
    _softBodyInitStarted = true;
    const spawn = origin.clone();
    void loadSoftBodyDemo().then((m) => m?.initSoftBodyDemo(scene, spawn));
}

export function setSoftBodyDemoPlayer(position: THREE.Vector3): void {
    _softBodyMod?.setSoftBodyDemoPlayer(position);
}

/** Per-frame step. Synchronous on the loaded module; a no-op until it lands. */
export function updateSoftBodyDemo(delta: number): void {
    _softBodyMod?.updateSoftBodyDemo(delta);
}

/**
 * `?heroAnim=1` — hero clip animation staging area. Off by default. Unlike the
 * cloth demo this is cheap on every tier (one mixer, one 3 KB glTF), so it is
 * not tier-gated; it still never loads without the flag.
 */
export function isHeroAnimationDemoEnabled(): boolean {
    return urlFlag('heroAnim');
}

let _heroAnimInitStarted = false;

/**
 * Load and stage the demo rig once, on the first frame the scene and player are
 * available — same lazy pattern as the physics sandbox, so the flag works on
 * every boot path.
 */
export function ensureHeroAnimationDemo(scene: THREE.Scene, origin: THREE.Vector3): void {
    if (_heroAnimInitStarted || !isHeroAnimationDemoEnabled()) return;
    _heroAnimInitStarted = true;
    const spawn = origin.clone();
    void loadHeroAnimDemo().then((m) => m?.initHeroAnimationDemo(scene, spawn));
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
    void loadGround().then((m) =>
        m?.registerPlantedInstance(x, y, z, type, footprintRadius, normal)
    );
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
    entries: readonly import('../systems/fauna/types.ts').FaunaSpawnEntry[]
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
