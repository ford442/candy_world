// src/core/init.ts

import * as THREE from 'three';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import { color, uniform, uv, float, smoothstep } from 'three/tsl';
import {
    WebGPURenderer,
    MeshBasicNodeMaterial,
    StorageInstancedBufferAttribute,
    StorageBufferAttribute,
} from 'three/webgpu';
import { createCrescendoFogNode, uFogNear, uFogFar } from '../foliage/sky.ts';
import {
    armGpuContext,
    captureAdapterRequests,
    GPU_ALPHA,
    GPU_ANTIALIAS,
    GPU_POWER_PREFERENCE,
    GPU_REQUIRED_LIMITS,
} from '../rendering/gpu-context.ts';
import { attachProbeDebug, initIrradianceProbes } from '../rendering/irradiance-probes.ts';
import { initLocalLights } from '../rendering/lights.ts';
import { resolveRendererBackend, type RendererBackend } from '../rendering/renderer-mode.ts';
import { applyShadowSoftness } from '../rendering/shadow-softness.ts';
import { getInitialFogDistances } from '../systems/atmosphere-fog.ts';
import { getGroundHeight } from '../systems/ground-system.ts';
import {
    initSunCascades,
    attachCascadeDebug,
    getCascadeMapSizes,
} from '../systems/shadow-cascades.ts';
import type { ShadowSettings } from './config/postfx.ts';
import { PALETTE, CONFIG, resolveShadowSettings } from './config.ts';

/**
 * Candy World always uses WebGPURenderer. WebGL2 fallback is the internal
 * GLSL node backend (`forceWebGL` / getFallback), not legacy THREE.WebGLRenderer.
 */
export type CandyRenderer = WebGPURenderer;

/**
 * Type guard to check if renderer is in WebGPU mode
 */
export const isWebGPUMode = (r: CandyRenderer): r is WebGPURenderer => r instanceof WebGPURenderer;

/**
 * Configure sun shadow map, tight ortho frustum, and renderer shadow pass.
 * @returns true when shadows are active
 */
function configureSunShadows(
    sunLight: THREE.DirectionalLight,
    renderer: CandyRenderer,
    scene: THREE.Scene
): ShadowSettings {
    const settings = resolveShadowSettings();

    if (!settings.enabled) {
        sunLight.castShadow = false;
        renderer.shadowMap.enabled = false;
        return settings;
    }

    const cfg = CONFIG.lighting.shadows;
    const renderRadius = cfg.followRadius + cfg.snapHeadroom;

    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap's node filter ignores `shadow.radius` (fixed 1-texel 3×3).
    // PCFShadowMap honors radius; we still attach a quality-gated TSL kernel via
    // `shadow.filterNode` in applyShadowSoftness() after CSM clones exist.
    renderer.shadowMap.type = THREE.PCFShadowMap;

    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(settings.mapSize, settings.mapSize);
    sunLight.shadow.bias = cfg.bias;
    sunLight.shadow.normalBias = cfg.normalBias;
    sunLight.shadow.radius = settings.radius;

    const cam = sunLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -renderRadius;
    cam.right = renderRadius;
    cam.top = renderRadius;
    cam.bottom = -renderRadius;
    cam.near = cfg.cameraNear;
    cam.far = cfg.cameraFar;
    cam.updateProjectionMatrix();

    // DirectionalLight aims position → target; target must be in the scene graph.
    scene.add(sunLight.target);
    return settings;
}

/**
 * Return type for initScene function
 * Contains all created scene objects, lights, materials, and uniforms
 */
export interface SceneInitResult {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: CandyRenderer;
    mode: 'webgpu' | 'webgl';
    requested: RendererBackend;
    fallbackReason: string | null;
    ambientLight: THREE.HemisphereLight;
    sunLight: THREE.DirectionalLight;
    sunGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    sunCorona: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    lightShaftGroup: THREE.Group;
    sunGlowMat: THREE.MeshBasicMaterial;
    coronaMat: THREE.MeshBasicMaterial;
    uShaftOpacity: ReturnType<typeof uniform<number>>;
}

/**
 * Window interface extension for global TSL uniforms
 * @internal
 */
declare global {
    interface Window {
        uShaftOpacity?: ReturnType<typeof uniform<number>>;
    }
}

/** True when the renderer is running Three's GLSL node backend (WebGL2). */
export function isWebGLNodeBackend(renderer: CandyRenderer): boolean {
    const backend = (renderer as WebGPURenderer & { backend?: { isWebGLBackend?: boolean } })
        .backend;
    return backend?.isWebGLBackend === true;
}

function createNodeRenderer(canvas: HTMLCanvasElement, forceWebGL = false): WebGPURenderer {
    if (!forceWebGL) {
        captureAdapterRequests();
    }
    return new WebGPURenderer({
        canvas,
        antialias: GPU_ANTIALIAS,
        alpha: GPU_ALPHA,
        powerPreference: GPU_POWER_PREFERENCE,
        requiredLimits: GPU_REQUIRED_LIMITS,
        forceWebGL,
    });
}

export interface CreateRendererResult {
    renderer: CandyRenderer;
    mode: 'webgpu' | 'webgl';
    requested: RendererBackend;
    fallbackReason: string | null;
}

/**
 * Create a renderer from an explicit preference.
 *
 * Priority:
 *   - `webgl`  → WebGPURenderer with `forceWebGL` (GLSL node backend)
 *   - `webgpu` → WebGPURenderer when available; falls back to GLSL backend on failure
 *
 * @param canvas The canvas element to render to
 * @param preference Resolved renderer preference from URL/localStorage
 */
export async function createRenderer(
    canvas: HTMLCanvasElement,
    preference: RendererBackend = resolveRendererBackend()
): Promise<CreateRendererResult> {
    if (preference === 'webgl') {
        console.log('[Init] WebGL requested — creating WebGPURenderer (GLSL node backend)');
        return {
            renderer: createNodeRenderer(canvas, true),
            mode: 'webgl',
            requested: 'webgl',
            fallbackReason: 'explicit-webgl',
        };
    }

    if (WebGPU.isAvailable()) {
        try {
            console.log('[Init] WebGPU available, creating WebGPURenderer');
            const renderer = createNodeRenderer(canvas, false);
            return { renderer, mode: 'webgpu', requested: 'webgpu', fallbackReason: null };
        } catch (err) {
            // Issue #2: WebGPU may be declared available but fail at runtime
            // (e.g. requestAdapter returns null on Safari 17.4 / Chrome with
            // disabled GPU).
            console.warn(
                '[Init] WebGPURenderer creation failed — WebGPU hard-fail boot probe triggered:',
                err
            );
            throw new Error(`WebGPU is required but initialization failed: ${err}`);
        }
    }

    console.warn('[Init] WebGPU unavailable — WebGPU hard-fail boot probe triggered.');
    const warning = WebGPU.getErrorMessage();
    if (warning && !document.getElementById('webgpu-warning')) {
        // Only append if not already present (avoid duplicates)
        warning.id = 'webgpu-warning';
        warning.style.zIndex = '1'; // Behind loading screen
        document.body.appendChild(warning);
    }

    throw new Error('WebGPU is required but unavailable on this browser/device.');
}

/**
 * Initialize the Three.js scene with renderer (WebGPU with WebGL fallback), lighting, fog, and visual effects.
 *
 * Creates:
 * - WebGPU renderer with automatic WebGL fallback if unavailable
 * - Scene with TSL-driven fog node (WebGPU) and legacy fallback fog (all)
 * - Perspective camera positioned at (0, 5, 0)
 * - Hemisphere ambient light + directional sunlight with shadows
 * - Sun glow, corona, and volumetric light shafts
 * - Resize event handler
 *
 * @returns Promise<SceneInitResult> containing all scene objects, lights, materials, uniforms, and mode
 */
export async function initScene(): Promise<SceneInitResult> {
    const canvas = document.querySelector('#glCanvas') as HTMLCanvasElement;
    const scene = new THREE.Scene();

    const requested = resolveRendererBackend();
    const { renderer, mode, fallbackReason } = await createRenderer(canvas, requested);

    if (mode === 'webgl') {
        (window as any).__computeDisabled = true;
    }

    // Adopt the renderer's device as the process-wide GPU context. Must complete
    // before setSize so MSAA colorBuffer / swapchain resolve match the canvas.
    await armGpuContext(renderer, mode, fallbackReason);

    const initialFog = getInitialFogDistances();

    // TSL-driven Crescendo Fog (WebGPURenderer — WGSL or GLSL node backend)
    if (isWebGPUMode(renderer)) {
        scene.fogNode = createCrescendoFogNode(color(PALETTE.day.fog));
    }
    // Standard fog kept for all renderers — distances derived from camera constants
    scene.fog = new THREE.Fog(PALETTE.day.fog, initialFog.near, initialFog.far);
    uFogNear.value = initialFog.near;
    uFogFar.value = initialFog.far;

    const camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        2000
    );
    camera.position.set(CONFIG.player.spawnX, CONFIG.player.spawnEyeHeightY, CONFIG.player.spawnZ);

    // WebGPURenderer configuration (WGSL or GLSL node backend)
    if (isWebGPUMode(renderer)) {
        // Fix: WebGPURenderer 0.171.0+ can crash in setupHardwareClipping if this is undefined
        const webgpuRenderer = renderer as WebGPURenderer;
        webgpuRenderer.clippingPlanes = [];
        webgpuRenderer.localClippingEnabled = false;
        console.log('[Init] WebGPURenderer clipping fix applied.');

        // Polyfill: attributeUtils.get is missing in three@0.171.0 but referenced by compute-particles.ts
        const backend = (webgpuRenderer as any).backend;
        if (backend && backend.attributeUtils && typeof backend.attributeUtils.get !== 'function') {
            backend.attributeUtils.get = () => null;
            console.log('[Init] WebGPU attributeUtils.get polyfill applied.');
        }

        // HDR Configuration (WebGPU backend only — Display P3 is not meaningful on GLSL fallback)
        const onWebGpuBackend = !isWebGLNodeBackend(renderer);
        const supportsHDR =
            onWebGpuBackend &&
            window.matchMedia &&
            window.matchMedia('(dynamic-range: high)').matches;
        if (supportsHDR) {
            console.log(
                '[Init] HDR supported, configuring WebGPURenderer for extended dynamic range and Display P3.'
            );
            try {
                webgpuRenderer.outputColorSpace = 'display-p3';
            } catch (e) {
                console.warn('[Init] Failed to set display-p3, falling back to srgb.');
                webgpuRenderer.outputColorSpace = 'srgb';
            }
            // Extended tone mapping for values > 1.0
            webgpuRenderer.toneMapping = THREE.LinearToneMapping;
        } else {
            if (!onWebGpuBackend) {
                console.log('[Init] GLSL node backend — using standard SDR configuration.');
            } else {
                console.log('[Init] HDR not supported, using standard SDR configuration.');
            }
            webgpuRenderer.outputColorSpace = 'srgb';
            webgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        }
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for better performance
    renderer.toneMappingExposure = 1.0;

    // --- Lighting ---
    const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.1);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.9);
    sunLight.position.set(50, 80, 30);

    const shadowSettings = configureSunShadows(sunLight, renderer, scene);

    scene.add(sunLight);

    // CSM parents its per-cascade light proxies to sunLight.parent, so this must
    // run after the light joins the scene graph. Returns null on the WebGL path
    // (node graph is WebGPU-only) — we then keep the single follow map.
    const cascades = shadowSettings.enabled
        ? initSunCascades(sunLight, renderer, camera, shadowSettings)
        : null;

    if (cascades) attachCascadeDebug(scene);
    applyShadowSoftness(sunLight, shadowSettings, cascades);

    const shadowSummary = !shadowSettings.enabled
        ? 'disabled (quality tier / CONFIG)'
        : cascades
          ? `CSM ${cascades.cascades} cascades, maps ${getCascadeMapSizes().join('/')}, maxFar ${Math.min(CONFIG.lighting.shadows.cascadeMaxFar, camera.far)}u, ${shadowSettings.kernel}×${shadowSettings.kernel} PCF softness ${shadowSettings.softness.toFixed(2)}`
          : `single follow map ${sunLight.shadow.mapSize.width}, ortho ±${CONFIG.lighting.shadows.followRadius}u, ${shadowSettings.kernel}×${shadowSettings.kernel} PCF softness ${shadowSettings.softness.toFixed(2)}`;
    console.log(`[Init] Sun shadows ${shadowSummary}`);

    // Local point/spot registry (sun remains the shadow hero). Authored
    // candy fills mount here so quality tiers and clustered culling share one list.
    initLocalLights(scene, renderer);

    // Lightweight GI. Must precede world generation: unified materials sample
    // the probe volume at build time, and a material compiled without the term
    // can never gain it. No-op on `low` / CI / ?gi=off.
    if (initIrradianceProbes(scene, getGroundHeight)) attachProbeDebug(scene);

    // Enhanced Sun Glow with dynamic corona effect
    const sunGlowMat = new THREE.MeshBasicMaterial({
        color: 0xffe599, // Warmer golden glow
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), sunGlowMat);
    sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
    sunGlow.lookAt(0, 0, 0);
    scene.add(sunGlow);

    // Add additional corona layer for more dramatic effect
    const coronaMat = new THREE.MeshBasicMaterial({
        color: 0xfff4d6, // Soft cream white
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
    });
    const sunCorona = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), coronaMat);
    sunCorona.position.copy(sunLight.position.clone().normalize().multiplyScalar(390));
    sunCorona.lookAt(0, 0, 0);
    scene.add(sunCorona);

    // Add light shafts/god rays for sunrise/sunset drama
    const lightShaftGroup = new THREE.Group();
    const shaftCount = 12;
    const shaftGeometry = new THREE.PlaneGeometry(8, 200);

    // Create light shaft material based on renderer mode
    const uShaftOpacity = window.uShaftOpacity || (window.uShaftOpacity = uniform(0.0));
    let shaftMaterial: THREE.MeshBasicMaterial | MeshBasicNodeMaterial;

    if (isWebGPUMode(renderer)) {
        // ⚡ OPTIMIZATION: Use a shared TSL material instead of looping over 12 clones in JS
        shaftMaterial = new MeshBasicNodeMaterial({
            color: 0xffe5a0,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });

        // TSL Volumetric God Rays:
        // Fade out horizontally at edges to prevent hard intersections
        const uvNode = uv();
        // Use proper boundaries: edge0 < edge1, then invert the result for the right side
        const leftFade = smoothstep(0.0, 0.4, uvNode.x);
        const rightFade = float(1.0).sub(smoothstep(0.6, 1.0, uvNode.x));
        const fadeX = leftFade.mul(rightFade);

        // Fade vertically to give a sense of scattering/dissipation (invert correctly)
        const fadeY = float(1.0)
            .sub(smoothstep(0.0, 1.0, uvNode.y))
            .pow(float(1.5));

        // Link combined soft edges to global TSL uniform
        const softOpacity = fadeX.mul(fadeY).mul(uShaftOpacity);
        (shaftMaterial as MeshBasicNodeMaterial).opacityNode = softOpacity;
    } else {
        // WebGL fallback: use standard material with static opacity
        // Note: Opacity is updated dynamically in game-loop.ts based on sunrise/sunset.
        // Default starts at 0.0 (invisible) and matches uShaftOpacity uniform behavior.
        shaftMaterial = new THREE.MeshBasicMaterial({
            color: 0xffe5a0,
            transparent: true,
            opacity: 0.0, // See game-loop.ts for dynamic updates
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
    }

    for (let i = 0; i < shaftCount; i++) {
        // Shared material instance, no .clone()
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        const angle = (i / shaftCount) * Math.PI * 2;
        shaft.rotation.z = angle;
        lightShaftGroup.add(shaft);
    }
    lightShaftGroup.position.copy(sunLight.position.clone().normalize().multiplyScalar(380));
    lightShaftGroup.userData.shaftMaterial = shaftMaterial;
    lightShaftGroup.visible = false; // Only visible during sunrise/sunset
    scene.add(lightShaftGroup);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    return {
        scene,
        camera,
        renderer,
        mode,
        requested,
        fallbackReason,
        ambientLight,
        sunLight,
        sunGlow,
        sunCorona,
        lightShaftGroup,
        sunGlowMat,
        coronaMat,
        uShaftOpacity,
    };
}

/**
 * Force a full scene warmup render to prevent shader compilation stutter.
 *
 * Only applies to WebGPU renderer. WebGL renderer returns immediately without
 * performing warmup, as WebGL is generally more stable during first render.
 *
 * Temporarily disables frustum culling, moves camera to capture all objects,
 * renders a 1x1 pixel frame to trigger shader compilation, then restores
 * all original states.
 *
 * @param renderer - The renderer instance (WebGPU or WebGL)
 * @param scene - The Three.js scene to warm up
 * @param camera - The camera to use for warmup rendering
 * @returns Promise that resolves when warmup is complete (immediate for WebGL)
 */
export async function forceFullSceneWarmup(
    renderer: CandyRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera
): Promise<void> {
    // Only warmup WebGPU renderer; WebGL is more forgiving
    if (!isWebGPUMode(renderer)) {
        console.log('[Init] Skipping scene warmup for WebGL renderer');
        return;
    }
    // 1. Save state
    const originalMask = camera.layers.mask;
    const originalPos = camera.position.clone();
    const originalRot = camera.rotation.clone();
    const originalAutoClear = renderer.autoClear;

    // 2. Force visibility and hide sensitive meshes
    const restoreList: (THREE.Mesh | THREE.Points)[] = [];
    const visibleRestoreList: (THREE.Mesh | THREE.Points)[] = [];
    scene.traverse((obj: THREE.Object3D) => {
        const isRenderable = obj instanceof THREE.Mesh || obj instanceof THREE.Points;
        if (isRenderable && obj.frustumCulled) {
            obj.frustumCulled = false;
            restoreList.push(obj);
        }
        // Hide meshes/points with storage/compute attributes during warmup
        // Their TSL materials can crash the renderer if compiled in a generic context.
        if (isRenderable && obj.visible) {
            const geo = obj.geometry;
            const hasStorageAttr =
                geo &&
                Object.values(geo.attributes).some(
                    (attr: any) =>
                        attr instanceof StorageInstancedBufferAttribute ||
                        attr instanceof StorageBufferAttribute
                );
            if (hasStorageAttr) {
                obj.visible = false;
                visibleRestoreList.push(obj);
            }
        }
    });

    // 3. Render 1x1 pixel frame
    const scissor = new THREE.Vector4();
    renderer.getViewport(scissor);
    renderer.setViewport(0, 0, 1, 1);

    camera.layers.enableAll();
    camera.position.set(0, 50, 0);
    camera.lookAt(0, 0, 0);

    try {
        renderer.render(scene, camera);
    } catch (e) {
        console.warn('Warmup error', e);
    }

    // 4. Restore
    renderer.setViewport(scissor.x, scissor.y, scissor.z, scissor.w);
    restoreList.forEach((o) => (o.frustumCulled = true));
    visibleRestoreList.forEach((o) => {
        if (o && typeof o.visible !== 'undefined') {
            o.visible = true;
        }
    });
    visibleRestoreList.length = 0; // prevent stale references
    camera.layers.mask = originalMask;
    camera.position.copy(originalPos);
    camera.rotation.copy(originalRot);
    renderer.autoClear = originalAutoClear;
    renderer.clear();
}

/**
 * Re-sync the WebGPU drawing buffer and MSAA resolve target to the current window
 * size. Shader warmup renders into 1×1 offscreen targets; calling this after warmup
 * prevents CopyTextureToTexture validation errors when resolving to the canvas.
 */
export function syncDrawingBufferFromWindow(renderer: CandyRenderer): void {
    renderer.setSize(window.innerWidth, window.innerHeight);
}
