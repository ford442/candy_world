/**
 * Local point / spot light registry.
 *
 * The sun (`DirectionalLight` + CSM) remains the shadow hero. Extra lights are
 * candy-tinted fills with physically plausible inverse-square falloff
 * (`decay = 2`). Every GPU light and every decorative descriptor is registered
 * here so a follow-up clustered/tiled cull can see them — generation must not
 * `scene.add(new PointLight)` in a loop.
 *
 * Shadow budget: at most `CONFIG.lighting.local.maxLocalShadowLights` extra
 * maps (default 1). Skipped on `low`, CI/headless, and the WebGL path
 * (WebGL shadows stay directional-only).
 *
 * @see docs/LOCAL_LIGHTS.md
 */
import * as THREE from 'three';
import { isCIorHeadless } from '../core/config/runtime.ts';
import { CONFIG } from '../core/config/defaults.ts';
import { hasUrlFlag, getUrlFlag } from '../core/config/url-flags.ts';
import { getStartupCapabilities } from '../core/startup/capabilities.ts';

export type LocalLightKind = 'point' | 'spot';
/** `authored` / `weather` allocate GPU lights; `decorative` is a descriptor only. */
export type LocalLightRole = 'authored' | 'weather' | 'decorative' | 'debug';

export interface LocalLightHandle {
    id: string;
    kind: LocalLightKind;
    role: LocalLightRole;
    /** Present for GPU lights; null for decorative descriptors. */
    light: THREE.PointLight | THREE.SpotLight | null;
    castsShadow: boolean;
    gpu: boolean;
}

export interface PointLightOptions {
    id?: string;
    role?: Exclude<LocalLightRole, 'decorative'>;
    color?: THREE.ColorRepresentation;
    intensity?: number;
    distance?: number;
    decay?: number;
    castShadow?: boolean;
    parent?: THREE.Object3D;
    position?: THREE.Vector3 | readonly [number, number, number];
}

export interface SpotLightOptions extends PointLightOptions {
    angle?: number;
    penumbra?: number;
    /** Cookie / projected map. Optional — no IES. */
    map?: THREE.Texture | null;
    /** Local-space aim point relative to `parent` (or world if unparented). */
    target?: THREE.Vector3 | readonly [number, number, number];
}

export interface DecorativeLightOptions {
    id?: string;
    color?: THREE.ColorRepresentation;
    intensity?: number;
    distance?: number;
    decay?: number;
    parent: THREE.Object3D;
    position?: THREE.Vector3 | readonly [number, number, number];
}

export interface LocalLightSnapshot {
    id: string;
    kind: LocalLightKind;
    role: LocalLightRole;
    gpu: boolean;
    castsShadow: boolean;
    intensity: number;
    distance: number;
    decay: number;
    color: number;
    parent: THREE.Object3D | null;
}

interface GpuSlot {
    used: boolean;
    id: string;
    role: LocalLightRole;
    kind: LocalLightKind;
    light: THREE.PointLight | THREE.SpotLight;
    helper: THREE.Object3D | null;
    castsShadow: boolean;
}

interface DecorSlot {
    used: boolean;
    id: string;
    color: number;
    intensity: number;
    distance: number;
    decay: number;
    parent: THREE.Object3D | null;
    localX: number;
    localY: number;
    localZ: number;
}

const POINT_POOL = 8;
const SPOT_POOL = 4;
const DECOR_POOL = 1024;

const AUTHORED_CRYSTAL_ID = 'authored-crystal-fill';
const AUTHORED_CAVE_ID = 'authored-crystal-cave';
const AUTHORED_SPOT_ID = 'authored-mushroom-spot';
const LIGHTNING_ID = 'weather-lightning';

let _scene: THREE.Scene | null = null;
let _webglBackend = false;
let _shadowsUsed = 0;
let _warnedPool = false;
let _helpersVisible = false;
let _autoId = 0;
/** `undefined` = production policy; tests pin true/false so CI user agents don't leak. */
let _testAllowShadows: boolean | undefined;

const _pointPool: GpuSlot[] = [];
const _spotPool: GpuSlot[] = [];
const _decorPool: DecorSlot[] = [];

function cfg() {
    return CONFIG.lighting.local;
}

function hexOf(color: THREE.ColorRepresentation | undefined, fallback: number): number {
    if (color === undefined) return fallback;
    return new THREE.Color(color).getHex();
}

function applyVec(
    obj: { position: THREE.Vector3 },
    pos: THREE.Vector3 | readonly [number, number, number] | undefined
): void {
    if (!pos) return;
    if (Array.isArray(pos)) obj.position.set(pos[0], pos[1], pos[2]);
    else obj.position.copy(pos as THREE.Vector3);
}

function ensurePools(): void {
    if (_pointPool.length > 0) return;
    for (let i = 0; i < POINT_POOL; i++) {
        const light = new THREE.PointLight(0xffffff, 0, 1, 2);
        light.castShadow = false;
        light.visible = false;
        _pointPool.push({
            used: false,
            id: '',
            role: 'debug',
            kind: 'point',
            light,
            helper: null,
            castsShadow: false,
        });
    }
    for (let i = 0; i < SPOT_POOL; i++) {
        const light = new THREE.SpotLight(0xffffff, 0, 1, Math.PI / 6, 0.5, 2);
        light.castShadow = false;
        light.visible = false;
        _spotPool.push({
            used: false,
            id: '',
            role: 'debug',
            kind: 'spot',
            light,
            helper: null,
            castsShadow: false,
        });
    }
    for (let i = 0; i < DECOR_POOL; i++) {
        _decorPool.push({
            used: false,
            id: '',
            color: 0xffffff,
            intensity: 0,
            distance: 1,
            decay: 2,
            parent: null,
            localX: 0,
            localY: 0,
            localZ: 0,
        });
    }
}

function findFreeGpu(kind: LocalLightKind): GpuSlot | null {
    ensurePools();
    const pool = kind === 'point' ? _pointPool : _spotPool;
    for (let i = 0; i < pool.length; i++) {
        if (!pool[i].used) return pool[i];
    }
    return null;
}

function findGpuById(id: string): GpuSlot | null {
    ensurePools();
    for (let i = 0; i < _pointPool.length; i++) {
        if (_pointPool[i].used && _pointPool[i].id === id) return _pointPool[i];
    }
    for (let i = 0; i < _spotPool.length; i++) {
        if (_spotPool[i].used && _spotPool[i].id === id) return _spotPool[i];
    }
    return null;
}

function findDecorById(id: string): DecorSlot | null {
    ensurePools();
    for (let i = 0; i < _decorPool.length; i++) {
        if (_decorPool[i].used && _decorPool[i].id === id) return _decorPool[i];
    }
    return null;
}

function nextId(prefix: string): string {
    _autoId += 1;
    return `${prefix}-${_autoId}`;
}

/**
 * Whether an extra local light may receive a shadow map this session.
 * Sun shadows are independent; this only gates *additional* maps.
 */
export function localShadowsAllowed(): boolean {
    const local = cfg();
    if (local.maxLocalShadowLights <= 0) return false;
    if (_webglBackend) return false;
    if (_testAllowShadows === false) return false;
    if (_testAllowShadows === true) return true;
    if (isCIorHeadless()) return false;
    try {
        const caps = getStartupCapabilities();
        if (!caps.shadows.enabled) return false;
        if (local.disableOnLow && caps.graphics === 'low') return false;
    } catch {
        return false;
    }
    return true;
}

export function remainingLocalShadowSlots(): number {
    if (!localShadowsAllowed()) return 0;
    return Math.max(0, cfg().maxLocalShadowLights - _shadowsUsed);
}

function applyLocalShadow(light: THREE.PointLight | THREE.SpotLight, enable: boolean): boolean {
    const local = cfg();
    const want = enable && remainingLocalShadowSlots() > 0;
    light.castShadow = want;
    if (!want) return false;
    light.shadow.mapSize.set(local.localShadowMapSize, local.localShadowMapSize);
    light.shadow.bias = local.localShadowBias;
    light.shadow.normalBias = local.localShadowNormalBias;
    const cam = light.shadow.camera as THREE.PerspectiveCamera;
    cam.near = local.localShadowNear;
    cam.far = Math.min(local.localShadowFar, light.distance || local.localShadowFar);
    cam.updateProjectionMatrix();
    _shadowsUsed += 1;
    return true;
}

function attachHelper(slot: GpuSlot): void {
    if (!_helpersVisible || !_scene || slot.helper) return;
    if (slot.kind === 'point') {
        slot.helper = new THREE.PointLightHelper(slot.light as THREE.PointLight, 0.6);
    } else {
        slot.helper = new THREE.SpotLightHelper(slot.light as THREE.SpotLight);
    }
    slot.helper.userData.skipDispose = true;
    _scene.add(slot.helper);
}

function detachHelper(slot: GpuSlot): void {
    if (!slot.helper) return;
    slot.helper.parent?.remove(slot.helper);
    slot.helper = null;
}

function parentLight(light: THREE.Light, parent: THREE.Object3D | undefined): void {
    const host = parent ?? _scene;
    if (!host) return;
    host.add(light);
    if ((light as THREE.SpotLight).isSpotLight) {
        const spot = light as THREE.SpotLight;
        host.add(spot.target);
    }
}

function unparentLight(light: THREE.Light): void {
    light.parent?.remove(light);
    if ((light as THREE.SpotLight).isSpotLight) {
        const spot = light as THREE.SpotLight;
        spot.target.parent?.remove(spot.target);
    }
}

function publishBreadcrumb(): void {
    if (typeof window === 'undefined') return;
    window.__localLights = getLocalLightStats();
}

/**
 * Bind the registry to the live scene/renderer. Call once from `initScene`
 * after the sun is configured. Safe to call again (rebinds, does not realloc).
 */
export function initLocalLights(
    scene: THREE.Scene,
    renderer: THREE.Renderer | { isWebGPURenderer?: boolean } | null
): void {
    ensurePools();
    _scene = scene;
    const r = renderer as { isWebGPURenderer?: boolean; isWebGLRenderer?: boolean } | null;
    _webglBackend = !r || r.isWebGPURenderer !== true;
    _helpersVisible = hasUrlFlag('debug') || getUrlFlag('lights') === '1';
    _testAllowShadows = undefined;
    mountAuthoredSpawnLights(scene);
    publishBreadcrumb();
    console.log(
        `[Lights] local registry ready — gpu ${countGpu()} / ${POINT_POOL + SPOT_POOL}, ` +
            `shadows ${localShadowsAllowed() ? remainingLocalShadowSlots() + _shadowsUsed : 0}/` +
            `${cfg().maxLocalShadowLights}` +
            `${_webglBackend ? ' (WebGL: illumination only, no extra maps)' : ''}`
    );
}

function countGpu(): number {
    let n = 0;
    for (let i = 0; i < _pointPool.length; i++) if (_pointPool[i].used) n++;
    for (let i = 0; i < _spotPool.length; i++) if (_spotPool[i].used) n++;
    return n;
}

function countDecor(): number {
    let n = 0;
    for (let i = 0; i < _decorPool.length; i++) if (_decorPool[i].used) n++;
    return n;
}

/** Debug helpers only — skipped when `?debug` / `?lights=1` is absent. */
export function updateLocalLightHelpers(): void {
    if (!_helpersVisible) return;
    for (let i = 0; i < _spotPool.length; i++) {
        const helper = _spotPool[i].helper as THREE.SpotLightHelper | null;
        if (_spotPool[i].used && helper && typeof helper.update === 'function') helper.update();
    }
}

export function getLocalLightStats(): {
    gpu: number;
    decorative: number;
    shadows: number;
    maxShadows: number;
    webgl: boolean;
    allowedShadows: boolean;
} {
    return {
        gpu: countGpu(),
        decorative: countDecor(),
        shadows: _shadowsUsed,
        maxShadows: localShadowsAllowed() ? cfg().maxLocalShadowLights : 0,
        webgl: _webglBackend,
        allowedShadows: localShadowsAllowed(),
    };
}

/** Snapshot for clustered culling (follow-up). Walks the reusable registry — no alloc of lights. */
export function forEachLocalLight(fn: (snap: LocalLightSnapshot) => void): void {
    ensurePools();
    for (let i = 0; i < _pointPool.length; i++) {
        const s = _pointPool[i];
        if (!s.used) continue;
        const L = s.light as THREE.PointLight;
        fn({
            id: s.id,
            kind: 'point',
            role: s.role,
            gpu: true,
            castsShadow: s.castsShadow,
            intensity: L.intensity,
            distance: L.distance,
            decay: L.decay,
            color: L.color.getHex(),
            parent: L.parent,
        });
    }
    for (let i = 0; i < _spotPool.length; i++) {
        const s = _spotPool[i];
        if (!s.used) continue;
        const L = s.light as THREE.SpotLight;
        fn({
            id: s.id,
            kind: 'spot',
            role: s.role,
            gpu: true,
            castsShadow: s.castsShadow,
            intensity: L.intensity,
            distance: L.distance,
            decay: L.decay,
            color: L.color.getHex(),
            parent: L.parent,
        });
    }
    for (let i = 0; i < _decorPool.length; i++) {
        const s = _decorPool[i];
        if (!s.used) continue;
        fn({
            id: s.id,
            kind: 'point',
            role: 'decorative',
            gpu: false,
            castsShadow: false,
            intensity: s.intensity,
            distance: s.distance,
            decay: s.decay,
            color: s.color,
            parent: s.parent,
        });
    }
}

export function createPointLight(options: PointLightOptions = {}): LocalLightHandle | null {
    ensurePools();
    const id = options.id ?? nextId('point');
    const existing = findGpuById(id);
    if (existing) {
        return {
            id,
            kind: 'point',
            role: existing.role,
            light: existing.light,
            castsShadow: existing.castsShadow,
            gpu: true,
        };
    }
    const slot = findFreeGpu('point');
    if (!slot) {
        if (!_warnedPool) {
            console.warn('[Lights] point pool exhausted — register decorative or raise POINT_POOL');
            _warnedPool = true;
        }
        return null;
    }
    const local = cfg();
    const light = slot.light as THREE.PointLight;
    light.color.setHex(hexOf(options.color, local.pointColor));
    light.intensity = options.intensity ?? local.pointIntensity;
    light.distance = options.distance ?? local.pointDistance;
    light.decay = options.decay ?? local.pointDecay;
    light.visible = true;
    applyVec(light, options.position);
    parentLight(light, options.parent);
    slot.used = true;
    slot.id = id;
    slot.role = options.role ?? 'authored';
    slot.castsShadow = applyLocalShadow(light, options.castShadow === true);
    attachHelper(slot);
    publishBreadcrumb();
    return {
        id,
        kind: 'point',
        role: slot.role,
        light,
        castsShadow: slot.castsShadow,
        gpu: true,
    };
}

export function createSpotLight(options: SpotLightOptions = {}): LocalLightHandle | null {
    ensurePools();
    const id = options.id ?? nextId('spot');
    const existing = findGpuById(id);
    if (existing) {
        return {
            id,
            kind: 'spot',
            role: existing.role,
            light: existing.light,
            castsShadow: existing.castsShadow,
            gpu: true,
        };
    }
    const slot = findFreeGpu('spot');
    if (!slot) {
        if (!_warnedPool) {
            console.warn('[Lights] spot pool exhausted');
            _warnedPool = true;
        }
        return null;
    }
    const local = cfg();
    const light = slot.light as THREE.SpotLight;
    light.color.setHex(hexOf(options.color, local.spotColor));
    light.intensity = options.intensity ?? local.spotIntensity;
    light.distance = options.distance ?? local.spotDistance;
    light.decay = options.decay ?? local.spotDecay;
    light.angle = options.angle ?? local.spotAngle;
    light.penumbra = options.penumbra ?? local.spotPenumbra;
    light.map = options.map ?? null;
    light.visible = true;
    applyVec(light, options.position);
    parentLight(light, options.parent);
    if (options.target) applyVec(light.target, options.target);
    slot.used = true;
    slot.id = id;
    slot.role = options.role ?? 'authored';
    slot.castsShadow = applyLocalShadow(light, options.castShadow === true);
    attachHelper(slot);
    publishBreadcrumb();
    return {
        id,
        kind: 'spot',
        role: slot.role,
        light,
        castsShadow: slot.castsShadow,
        gpu: true,
    };
}

/**
 * Record a tiny decorative fill (flower head, orb) without allocating a GPU
 * light. Clustered lighting will consume these; generation loops must use this
 * instead of `new PointLight`.
 */
export function registerDecorativeFill(options: DecorativeLightOptions): LocalLightHandle | null {
    ensurePools();
    const id = options.id ?? nextId('deco');
    const existing = findDecorById(id);
    if (existing) {
        return {
            id,
            kind: 'point',
            role: 'decorative',
            light: null,
            castsShadow: false,
            gpu: false,
        };
    }
    let slot: DecorSlot | null = null;
    for (let i = 0; i < _decorPool.length; i++) {
        if (!_decorPool[i].used) {
            slot = _decorPool[i];
            break;
        }
    }
    if (!slot) return null;
    const local = cfg();
    slot.used = true;
    slot.id = id;
    slot.color = hexOf(options.color, local.pointColor);
    slot.intensity = options.intensity ?? local.pointIntensity * 0.3;
    slot.distance = options.distance ?? 2;
    slot.decay = options.decay ?? local.pointDecay;
    slot.parent = options.parent;
    slot.localX = 0;
    slot.localY = 0;
    slot.localZ = 0;
    if (options.position) {
        if (Array.isArray(options.position)) {
            slot.localX = options.position[0];
            slot.localY = options.position[1];
            slot.localZ = options.position[2];
        } else {
            const p = options.position as THREE.Vector3;
            slot.localX = p.x;
            slot.localY = p.y;
            slot.localZ = p.z;
        }
    }
    publishBreadcrumb();
    return {
        id,
        kind: 'point',
        role: 'decorative',
        light: null,
        castsShadow: false,
        gpu: false,
    };
}

export function modulateDecorativeLight(id: string, intensityScale: number): void {
    const slot = findDecorById(id);
    if (!slot) return;
    slot.intensity *= intensityScale;
}

export function releaseLocalLight(id: string): void {
    const gpu = findGpuById(id);
    if (gpu) {
        if (gpu.castsShadow) {
            _shadowsUsed = Math.max(0, _shadowsUsed - 1);
            gpu.castsShadow = false;
        }
        gpu.light.castShadow = false;
        gpu.light.intensity = 0;
        gpu.light.visible = false;
        unparentLight(gpu.light);
        detachHelper(gpu);
        gpu.used = false;
        gpu.id = '';
        publishBreadcrumb();
        return;
    }
    const deco = findDecorById(id);
    if (deco) {
        deco.used = false;
        deco.parent = null;
        deco.id = '';
        publishBreadcrumb();
    }
}

/** Spawn-neighbourhood examples so the fills are visible without finding a cave. */
export function mountAuthoredSpawnLights(scene: THREE.Scene): void {
    createPointLight({
        id: AUTHORED_CRYSTAL_ID,
        role: 'authored',
        parent: scene,
        position: [6, 2.8, -10],
        castShadow: false,
    });
    createSpotLight({
        id: AUTHORED_SPOT_ID,
        role: 'authored',
        parent: scene,
        position: [0, 5.5, 3],
        target: [0, 0, 0],
        castShadow: true,
    });
}

/**
 * First cave in the world gets an interior cyan fill. Later caves stay
 * descriptor-free — do not light every generated entrance.
 */
export function tryAttachAuthoredCaveFill(
    cave: THREE.Object3D,
    localPosition: readonly [number, number, number]
): LocalLightHandle | null {
    if (findGpuById(AUTHORED_CAVE_ID)) return null;
    return createPointLight({
        id: AUTHORED_CAVE_ID,
        role: 'authored',
        parent: cave,
        position: localPosition,
        castShadow: false,
    });
}

/**
 * First giant mushroom receives the cap spot if the spawn staging spot is
 * still the only cone. We keep a single authored cap cone (shadow budget).
 */
export function tryAttachAuthoredMushroomSpot(mushroom: THREE.Object3D): LocalLightHandle | null {
    const existing = findGpuById(AUTHORED_SPOT_ID);
    if (existing && existing.light?.parent && existing.light.parent !== _scene) {
        return null;
    }
    // Relocate the spawn cone onto this cap so the shadow-casting extra
    // actually sits on authored content when a giant is present.
    if (existing?.light) {
        const spot = existing.light as THREE.SpotLight;
        unparentLight(spot);
        spot.position.set(0, 8, 0);
        mushroom.add(spot);
        mushroom.add(spot.target);
        spot.target.position.set(0, 0, 0);
        return {
            id: AUTHORED_SPOT_ID,
            kind: 'spot',
            role: 'authored',
            light: spot,
            castsShadow: existing.castsShadow,
            gpu: true,
        };
    }
    return createSpotLight({
        id: AUTHORED_SPOT_ID,
        role: 'authored',
        parent: mushroom,
        position: [0, 8, 0],
        target: [0, 0, 0],
        castShadow: true,
    });
}

export function getLightningLightId(): string {
    return LIGHTNING_ID;
}

/** @internal tests */
export function __resetLocalLightsForTests(): void {
    ensurePools();
    for (let i = 0; i < _pointPool.length; i++) {
        if (_pointPool[i].used) releaseLocalLight(_pointPool[i].id);
    }
    for (let i = 0; i < _spotPool.length; i++) {
        if (_spotPool[i].used) releaseLocalLight(_spotPool[i].id);
    }
    for (let i = 0; i < _decorPool.length; i++) {
        _decorPool[i].used = false;
        _decorPool[i].id = '';
        _decorPool[i].parent = null;
    }
    _scene = null;
    _webglBackend = false;
    _shadowsUsed = 0;
    _warnedPool = false;
    _helpersVisible = false;
    _autoId = 0;
    _testAllowShadows = undefined;
}

/** @internal tests — bind without mounting authored examples. */
export function __bindLocalLightsForTests(
    scene: THREE.Scene,
    webgl: boolean,
    allowShadows?: boolean
): void {
    ensurePools();
    _scene = scene;
    _webglBackend = webgl;
    _helpersVisible = false;
    _testAllowShadows = allowShadows;
}
