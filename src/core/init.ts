// src/core/init.ts

import * as THREE from 'three';
import { color, uniform } from 'three/tsl';
import type UniformNode from 'three/src/nodes/core/UniformNode.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, MeshBasicNodeMaterial } from 'three/webgpu';
import { PALETTE, CONFIG } from './config.ts';
import { createCrescendoFogNode } from '../foliage/sky.ts';

/**
 * Return type for initScene function
 * Contains all created scene objects, lights, materials, and uniforms
 */
export interface SceneInitResult {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: WebGPURenderer;
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

/**
 * Initialize the Three.js scene with WebGPU renderer, lighting, fog, and visual effects.
 * 
 * Creates:
 * - WebGPU renderer with HDR/SDR configuration based on device capabilities
 * - Scene with TSL-driven fog node and legacy fallback fog
 * - Perspective camera positioned at (0, 5, 0)
 * - Hemisphere ambient light + directional sunlight with shadows
 * - Sun glow, corona, and volumetric light shafts
 * - Resize event handler
 * 
 * @returns SceneInitResult containing all scene objects, lights, materials, and uniforms
 * @throws Error if WebGPU is not supported by the browser
 */
export function initScene(): SceneInitResult {
    const canvas = document.querySelector('#glCanvas') as HTMLCanvasElement;
    const scene = new THREE.Scene();

    // TSL-driven Crescendo Fog initialization
    scene.fogNode = createCrescendoFogNode(color(PALETTE.day.fog));
    // Standard fog kept for fallback/legacy systems
    scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

    const camera = new THREE.PerspectiveCamera(
        60, 
        window.innerWidth / window.innerHeight, 
        0.1, 
        2000
    );
    camera.position.set(0, 5, 0);

    if (!WebGPU.isAvailable()) {
        const warning = WebGPU.getErrorMessage();
        document.body.appendChild(warning);
        throw new Error('WebGPU not supported');
    }

    const renderer = new WebGPURenderer({ canvas, antialias: true });
    // Fix: WebGPURenderer 0.171.0+ can crash in setupHardwareClipping if this is undefined
    renderer.clippingPlanes = [];
    renderer.localClippingEnabled = false;
    console.log('[Init] WebGPURenderer clipping fix applied.');

    // HDR Configuration (Phase 4: WebGPU)
    // Attempt to enable wide color gamut and extended tone mapping for brighter visuals
    const supportsHDR = window.matchMedia && window.matchMedia('(dynamic-range: high)').matches;
    if (supportsHDR) {
        console.log('[Init] HDR supported, configuring WebGPURenderer for extended dynamic range and Display P3.');
        try {
            // Fallback to string literals since THREE.DisplayP3ColorSpace might not be available in this three.js version
            renderer.outputColorSpace = 'display-p3' as THREE.ColorSpace;
        } catch (e) {
            console.warn('[Init] Failed to set display-p3, falling back to srgb.');
            renderer.outputColorSpace = 'srgb';
        }
        // Extended tone mapping for values > 1.0
        renderer.toneMapping = THREE.LinearToneMapping;
    } else {
        console.log('[Init] HDR not supported, using standard SDR configuration.');
        renderer.outputColorSpace = 'srgb';
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

    // ⚡ OPTIMIZATION: Use a shared TSL material instead of looping over 12 clones in JS
    const uShaftOpacity = window.uShaftOpacity || (window.uShaftOpacity = uniform(0.0));
    const shaftMaterial = new MeshBasicNodeMaterial({
        color: 0xFFE5A0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    // Link opacity to a global TSL uniform
    shaftMaterial.opacityNode = uShaftOpacity;

    for (let i = 0; i < shaftCount; i++) {
        // Shared material instance, no .clone()
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        const angle = (i / shaftCount) * Math.PI * 2;
        shaft.rotation.z = angle;
        lightShaftGroup.add(shaft);
    }
    lightShaftGroup.position.copy(sunLight.position.clone().normalize().multiplyScalar(380));
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
        ambientLight,
        sunLight,
        sunGlow,
        sunCorona,
        lightShaftGroup,
        sunGlowMat,
        coronaMat,
        uShaftOpacity // Export the uniform so main.ts can access it
    };
}

/**
 * Force a full scene warmup render to prevent shader compilation stutter.
 * 
 * Temporarily disables frustum culling, moves camera to capture all objects,
 * renders a 1x1 pixel frame to trigger shader compilation, then restores
 * all original states.
 * 
 * @param renderer - The WebGPU renderer instance
 * @param scene - The Three.js scene to warm up
 * @param camera - The camera to use for warmup rendering
 * @returns Promise that resolves when warmup is complete
 */
export async function forceFullSceneWarmup(
    renderer: WebGPURenderer, 
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera
): Promise<void> {
    // 1. Save state
    const originalMask = camera.layers.mask;
    const originalPos = camera.position.clone();
    const originalRot = camera.rotation.clone();
    const originalAutoClear = renderer.autoClear;

    // 2. Force visibility
    const restoreList: THREE.Mesh[] = [];
    scene.traverse((obj: THREE.Object3D) => {
        if (obj instanceof THREE.Mesh && obj.frustumCulled) {
            obj.frustumCulled = false;
            restoreList.push(obj);
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
    camera.layers.mask = originalMask;
    camera.position.copy(originalPos);
    camera.rotation.copy(originalRot);
    renderer.autoClear = originalAutoClear;
    renderer.clear();
}
