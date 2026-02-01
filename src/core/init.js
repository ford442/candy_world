// src/core/init.js

import * as THREE from 'three';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer } from 'three/webgpu';
import { PALETTE, CONFIG } from './config.ts';

export function initScene() {
    const canvas = document.querySelector('#glCanvas');
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(0, 5, 0);

    if (!WebGPU.isAvailable()) {
        const warning = WebGPU.getErrorMessage();
        document.body.appendChild(warning);
        throw new Error('WebGPU not supported');
    }

    const renderer = new WebGPURenderer({ canvas, antialias: true });
    // Fix: WebGPURenderer 0.171.0+ can crash in setupHardwareClipping if this is undefined
    renderer.clippingPlanes = [];
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap pixel ratio for better performance
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // --- Lighting ---
    const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.1);
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
    const shaftMaterial = new THREE.MeshBasicMaterial({
        color: 0xFFE5A0,
        transparent: true,
        opacity: 0.0, // Will be animated
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
    });

    for (let i = 0; i < shaftCount; i++) {
        const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial.clone());
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
        coronaMat
    };
}

export async function forceFullSceneWarmup(renderer, scene, camera) {
    // 1. Save state
    const originalMask = camera.layers.mask;
    const originalPos = camera.position.clone();
    const originalRot = camera.rotation.clone();
    const originalAutoClear = renderer.autoClear;

    // 2. Force visibility
    const restoreList = [];
    scene.traverse((obj) => {
        if (obj.isMesh && obj.frustumCulled) {
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
    camera.lookAt(0,0,0);

    try {
        renderer.render(scene, camera);
    } catch (e) { console.warn("Warmup error", e); }

    // 4. Restore
    renderer.setViewport(scissor);
    restoreList.forEach(o => o.frustumCulled = true);
    camera.layers.mask = originalMask;
    camera.position.copy(originalPos);
    camera.rotation.copy(originalRot);
    renderer.autoClear = originalAutoClear;
    renderer.clear();
}
