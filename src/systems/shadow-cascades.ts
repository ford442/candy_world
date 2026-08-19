/**
 * Cascaded Shadow Maps for the sun DirectionalLight (WebGPU only).
 *
 * Three's `CSMShadowNode` (examples/jsm/csm) builds N ortho cascades across the
 * camera frustum and swaps them in the TSL light graph via
 * `light.shadow.shadowNode`. It already does per-cascade light-view texel
 * snapping in its own `updateBefore` (NodeUpdateType.FRAME), so the legacy
 * player-follow snap in `game-loop-postfx.ts` must stand down while CSM owns
 * the rig — running both fights over the same shadow camera and shimmers.
 *
 * The node graph is WebGPU-only: it imports from `three/webgpu` and is consumed
 * by `AnalyticLightNode`, which the WebGL renderer never builds. On the WebGL
 * path `initSunCascades()` returns null and the caller keeps the single
 * follow map. See `docs/webgl-fallback.md`.
 */
import * as THREE from 'three';
import { CSMShadowNode } from 'three/examples/jsm/csm/CSMShadowNode.js';
import { clampCascadeCount, type ShadowSettings } from '../core/config/postfx.ts';
import { hasUrlFlag, getUrlFlag } from '../core/config/url-flags.ts';
import { CONFIG } from '../core/config.ts';
import { startPhase, endPhase } from '../utils/startup-profiler.ts';

/**
 * `@types/three` for r171 declares CSMShadowNode's fields and `updateFrustums()`
 * but omits the `init()` / `dispose()` lifecycle the JS actually exports.
 * Declare the missing surface structurally rather than casting through `any`.
 */
type CSMShadowNodeLifecycle = CSMShadowNode & {
    init(context: { camera: THREE.Camera; renderer: THREE.Renderer }): void;
    dispose(): void;
};

/** Live handle for the active cascade rig. */
export interface SunCascades {
    node: CSMShadowNodeLifecycle;
    cascades: number;
    mapSize: number;
    /** Camera the splits were built against — used to detect a far-plane change. */
    camera: THREE.PerspectiveCamera;
}

let _active: SunCascades | null = null;

/** True while CSM owns the sun shadow rig (the follow/snap path must yield). */
export function areSunCascadesActive(): boolean {
    return _active !== null;
}

export function getSunCascades(): SunCascades | null {
    return _active;
}

/**
 * CSM rides the TSL node graph, so it needs the WebGPU backend. We read the
 * renderer rather than the URL preference: the app silently falls back to
 * WebGL when WebGPU is unavailable, and only the actual backend is truthful.
 */
export function isCascadeSupported(renderer: THREE.Renderer | null | undefined): boolean {
    if (!renderer) return false;
    const r = renderer as THREE.Renderer & { isWebGPURenderer?: boolean; backend?: unknown };
    return r.isWebGPURenderer === true && r.backend !== undefined;
}

/**
 * Attach a cascade rig to the sun light.
 *
 * The light MUST already be in the scene graph — `CSMShadowNode.init()` parents
 * its per-cascade light proxies to `light.parent`.
 *
 * @returns the handle, or null when CSM is unavailable/disabled (caller keeps
 *          the legacy single follow map).
 */
export function initSunCascades(
    sunLight: THREE.DirectionalLight,
    renderer: THREE.Renderer,
    camera: THREE.PerspectiveCamera,
    settings: ShadowSettings,
): SunCascades | null {
    if (!settings.enabled || settings.cascades <= 0) return null;
    if (!isCascadeSupported(renderer)) return null;

    if (!sunLight.parent) {
        console.warn('[Shadows] CSM skipped: sun light is not in the scene graph yet.');
        return null;
    }

    const cfg = CONFIG.lighting.shadows;
    const cascades = clampCascadeCount(settings.cascades);

    startPhase('shadow-cascades-init');
    try {
        // Cascade ortho extents are derived from the camera frustum, so the shadow
        // camera's own near/far are irrelevant here — but mapSize and bias are
        // cloned per cascade by init(), so they must be set first.
        sunLight.shadow.mapSize.set(settings.mapSize, settings.mapSize);
        sunLight.shadow.bias = cfg.bias;
        sunLight.shadow.normalBias = cfg.normalBias;
        sunLight.shadow.radius = cfg.pcfRadius;

        const node = new CSMShadowNode(sunLight, {
            cascades,
            mode: cfg.cascadeMode,
            // Bound the splits to visible range; camera.far is far past the fog line.
            maxFar: Math.min(cfg.cascadeMaxFar, camera.far),
            lightMargin: cfg.cascadeLightMargin,
        }) as CSMShadowNodeLifecycle;
        node.fade = cfg.cascadeFade;
        node.init({ camera, renderer });

        // AnalyticLightNode picks this up when it builds the light's shadow graph.
        (sunLight.shadow as THREE.DirectionalLightShadow & { shadowNode?: unknown }).shadowNode =
            node;

        applyCascadeMapSizeTaper(node, settings.mapSize);

        _active = { node, cascades, mapSize: settings.mapSize, camera };
        return _active;
    } catch (err) {
        console.warn('[Shadows] CSM init failed; falling back to single shadow map.', err);
        disposeSunCascades(sunLight);
        return null;
    } finally {
        endPhase('shadow-cascades-init');
    }
}

/**
 * Keep the sun *direction* current. CSM derives every cascade camera from
 * `light.position → light.target.position`, so the celestial rig still drives
 * it — but the ortho bounds and texel snap are the node's job, not ours.
 */
export function updateSunCascadeDirection(
    sunLight: THREE.DirectionalLight,
    playerPos: THREE.Vector3,
    normalizedSunDir: THREE.Vector3,
): void {
    if (!_active) return;

    const cfg = CONFIG.lighting.shadows;
    sunLight.position.copy(playerPos).addScaledVector(normalizedSunDir, cfg.sunDistance);
    sunLight.target.position.copy(playerPos);
    sunLight.target.updateMatrixWorld();

    updateCascadeDebug();
}

/**
 * Rebuild splits after a camera far-plane / fov change. Cheap but not free
 * (it re-derives every cascade frustum), so it is not called per frame.
 */
export function refreshSunCascadeSplits(): void {
    if (!_active) return;
    try {
        _active.node.updateFrustums();
    } catch (err) {
        console.warn('[Shadows] CSM split refresh failed.', err);
    }
}

/**
 * CSMShadowNode clones the source shadow for every cascade, so all cascades
 * would allocate at the full map size. Distant cascades cover far more world
 * per texel and gain nothing from that resolution, so step them down — the near
 * cascade (index 0) keeps the full budget. Must run after `init()` (which does
 * the cloning) and before first render (which allocates the depth textures).
 */
function applyCascadeMapSizeTaper(node: CSMShadowNodeLifecycle, baseMapSize: number): void {
    const sizes = cascadeMapSizes(baseMapSize, node.lights.length);
    node.lights.forEach((lwLight, i) => {
        const shadow = lwLight.shadow;
        if (!shadow) return;
        shadow.mapSize.set(sizes[i], sizes[i]);
    });
}

/**
 * Shadow map dimension per cascade, near → far. Pure so the budget maths can be
 * unit tested without a GPU. Returns a flat allocation when taper is disabled.
 */
export function cascadeMapSizes(baseMapSize: number, cascades: number): number[] {
    const cfg = CONFIG.lighting.shadows;
    const count = Math.max(0, Math.floor(cascades));
    if (!cfg.cascadeMapSizeTaper) return Array.from({ length: count }, () => baseMapSize);

    const floor = Math.max(64, cfg.cascadeMapSizeMin);
    return Array.from({ length: count }, (_, i) => Math.max(floor, baseMapSize >> i));
}

/** Per-cascade shadow map dimensions, near → far. Debug / test readout. */
export function getCascadeMapSizes(): number[] {
    if (!_active) return [];
    return _active.node.lights.map((l) => l.shadow?.mapSize.width ?? 0);
}

// --- Debug overlay (?debug=1 / ?csm=debug) -----------------------------------

interface CascadeHelper extends THREE.Object3D {
    update(): void;
}

let _helper: CascadeHelper | null = null;

function cascadeDebugRequested(): boolean {
    return hasUrlFlag('debug') || getUrlFlag('debug') === '1' || getUrlFlag('csm') === 'debug';
}

/**
 * Lazily attach Three's CSMHelper (cascade frusta + per-cascade ortho boxes).
 * Debug-only and fully optional: any failure leaves the rig untouched.
 */
export function attachCascadeDebug(scene: THREE.Scene): void {
    if (!_active || _helper || !cascadeDebugRequested()) return;

    void import('three/examples/jsm/csm/CSMHelper.js')
        .then(({ CSMHelper }) => {
            if (!_active) return;
            const helper = new CSMHelper(_active.node) as unknown as CascadeHelper;
            scene.add(helper);
            _helper = helper;
        })
        .catch((err) => {
            console.warn('[Shadows] CSM debug overlay unavailable.', err);
        });
}

/** Per-frame overlay refresh. No-op unless the overlay is attached. */
function updateCascadeDebug(): void {
    if (!_helper) return;
    try {
        _helper.update();
    } catch {
        /* helper desynced from the rig — drop it rather than spam per frame */
        _helper.removeFromParent();
        _helper = null;
    }
}

/** Cascade split distances, for debug readouts. */
export function getCascadeBreaks(): number[] {
    return _active ? [..._active.node.breaks] : [];
}

export function disposeSunCascades(sunLight?: THREE.DirectionalLight): void {
    if (!_active) return;
    try {
        _active.node.dispose();
    } catch {
        /* already torn down */
    }
    if (_helper) {
        _helper.removeFromParent();
        _helper = null;
    }
    if (sunLight) {
        delete (sunLight.shadow as THREE.DirectionalLightShadow & { shadowNode?: unknown })
            .shadowNode;
    }
    _active = null;
}
