// src/core/init.ts

import * as THREE from 'three';
import { color, uniform, uv, float, smoothstep } from 'three/tsl';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, MeshBasicNodeMaterial, StorageInstancedBufferAttribute, StorageBufferAttribute } from 'three/webgpu';
import { PALETTE, CONFIG } from './config.ts';
import { createCrescendoFogNode } from '../foliage/sky.ts';
import {
    resolveRendererBackend,
    type RendererBackend,
} from '../rendering/renderer-mode.ts';

/**
 * Type union for supported renderers (WebGPU or WebGL fallback)
 */
export type CandyRenderer = WebGPURenderer | THREE.WebGLRenderer;

/**
 * Type guard to check if renderer is in WebGPU mode
 */
export const isWebGPUMode = (r: CandyRenderer): r is WebGPURenderer =>
    r instanceof WebGPURenderer;

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

function createWebGLRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    return renderer;
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
 *   - `webgl`  → always WebGLRenderer (reference / debug / CI path)
 *   - `webgpu` → WebGPURenderer when available; falls back to WebGL on failure
 *
 * @param canvas The canvas element to render to
 * @param preference Resolved renderer preference from URL/localStorage
 */
export function createRenderer(
    canvas: HTMLCanvasElement,
    preference: RendererBackend = resolveRendererBackend(),
): CreateRendererResult {
    if (preference === 'webgl') {
        console.log('[Init] WebGL requested — creating WebGLRenderer');
        return {
            renderer: createWebGLRenderer(canvas),
            mode: 'webgl',
            requested: 'webgl',
            fallbackReason: 'explicit-webgl',
        };
    }

    if (WebGPU.isAvailable()) {
        try {
            console.log('[Init] WebGPU available, creating WebGPURenderer');
            const renderer = new WebGPURenderer({ canvas, antialias: true });
            return { renderer, mode: 'webgpu', requested: 'webgpu', fallbackReason: null };
        } catch (err) {
            // Issue #2: WebGPU may be declared available but fail at runtime
            // (e.g. requestAdapter returns null on Safari 17.4 / Chrome with
            // disabled GPU).  Fall through to the WebGL path instead of crashing.
            console.warn('[Init] WebGPURenderer creation failed — falling back to WebGLRenderer:', err);
        }
    }

    console.warn('[Init] WebGPU unavailable — falling back to WebGLRenderer');
    const warning = WebGPU.getErrorMessage();
    if (warning && !document.getElementById('webgpu-warning')) {
        // Only append if not already present (avoid duplicates)
        warning.id = 'webgpu-warning';
        warning.style.zIndex = '1';  // Behind loading screen
        document.body.appendChild(warning);
    }

    return {
        renderer: createWebGLRenderer(canvas),
        mode: 'webgl',
        requested: 'webgpu',
        fallbackReason: 'webgpu-unavailable',
    };
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
 * @returns SceneInitResult containing all scene objects, lights, materials, uniforms, and mode
 */
export function initScene(): SceneInitResult {
    const canvas = document.querySelector('#glCanvas') as HTMLCanvasElement;
    const scene = new THREE.Scene();

    const requested = resolveRendererBackend();
    const { renderer, mode, fallbackReason } = createRenderer(canvas, requested);

    // TSL-driven Crescendo Fog initialization (WebGPU only)
    if (mode === 'webgpu') {
        scene.fogNode = createCrescendoFogNode(color(PALETTE.day.fog));
    }
    // Standard fog kept for all renderers
    scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

    const camera = new THREE.PerspectiveCamera(
        60, 
        window.innerWidth / window.innerHeight, 
        0.1, 
        2000
    );
    camera.position.set(0, 5, 0);

    // WebGPU-specific fixes and configuration
    if (mode === 'webgpu') {
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

        // HDR Configuration (WebGPU only)
        // Attempt to enable wide color gamut and extended tone mapping for brighter visuals
        const supportsHDR = window.matchMedia && window.matchMedia('(dynamic-range: high)').matches;
        if (supportsHDR) {
            console.log('[Init] HDR supported, configuring WebGPURenderer for extended dynamic range and Display P3.');
            try {
                webgpuRenderer.outputColorSpace = (THREE as any).DisplayP3ColorSpace || 'display-p3';
            } catch (e) {
                console.warn('[Init] Failed to set display-p3, falling back to srgb.');
                webgpuRenderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
            }
            // Extended tone mapping for values > 1.0
            webgpuRenderer.toneMapping = THREE.LinearToneMapping;
        } else {
            console.log('[Init] HDR not supported, using standard SDR configuration.');
            webgpuRenderer.outputColorSpace = THREE.SRGBColorSpace || 'srgb';
            webgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
        }
    }

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for better performance
    renderer.toneMappingExposure = 1.0;

    // --- Lighting ---
    const ambientLight = new THREE.HemisphereLight(
        PALETTE.day.skyTop, 
        CONFIG.colors.ground, 
        1.1
    );
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.9);
    sunLight.position.set(50, 80, 30);
    
    sunLight.castShadow = true;
    
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    scene.add(sunLight);

    // Enhanced Sun Glow with dynamic corona effect
    const sunGlowMat = new THREE.MeshBasicMaterial({
        color: 0xFFE599,  // Warmer golden glow
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const sunGlow = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), sunGlowMat);
    sunGlow.position.copy(sunLight.position.clone().normalize().multiplyScalar(400));
    sunGlow.lookAt(0, 0, 0);
    scene.add(sunGlow);

    // Add additional corona layer for more dramatic effect
    const coronaMat = new THREE.MeshBasicMaterial({
        color: 0xFFF4D6,  // Soft cream white
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
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
    
    if (mode === 'webgpu') {
        // ⚡ OPTIMIZATION: Use a shared TSL material instead of looping over 12 clones in JS
        shaftMaterial = new MeshBasicNodeMaterial({
            color: 0xFFE5A0,
            transparent: true,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });

        // TSL Volumetric God Rays:
        // Fade out horizontally at edges to prevent hard intersections
        const uvNode = uv();
        // Use proper boundaries: edge0 < edge1, then invert the result for the right side
        const leftFade = smoothstep(0.0, 0.4, uvNode.x);
        const rightFade = float(1.0).sub(smoothstep(0.6, 1.0, uvNode.x));
        const fadeX = leftFade.mul(rightFade);

        // Fade vertically to give a sense of scattering/dissipation (invert correctly)
        const fadeY = float(1.0).sub(smoothstep(0.0, 1.0, uvNode.y)).pow(float(1.5));

        // Link combined soft edges to global TSL uniform
        const softOpacity = fadeX.mul(fadeY).mul(uShaftOpacity);
        (shaftMaterial as MeshBasicNodeMaterial).opacityNode = softOpacity;
    } else {
        // WebGL fallback: use standard material with static opacity
        // Note: Opacity is updated dynamically in game-loop.ts based on sunrise/sunset.
        // Default starts at 0.0 (invisible) and matches uShaftOpacity uniform behavior.
        shaftMaterial = new THREE.MeshBasicMaterial({
            color: 0xFFE5A0,
            transparent: true,
            opacity: 0.0,  // See game-loop.ts for dynamic updates
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
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
        uShaftOpacity
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
            const hasStorageAttr = geo && Object.values(geo.attributes).some((attr: any) =>
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
        console.warn("Warmup error", e); 
    }

    // 4. Restore
    renderer.setViewport(scissor.x, scissor.y, scissor.z, scissor.w);
    restoreList.forEach(o => o.frustumCulled = true);
    visibleRestoreList.forEach(o => {
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
