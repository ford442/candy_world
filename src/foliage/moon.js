// src/foliage/moon.js

import * as THREE from 'three';
// ADD 'float' to imports
import { color, vec3, time, sin, cos, uniform, mix, positionLocal, float } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attachReactivity } from './common.js';

// Moon Configuration
export const moonConfig = {
    blinkDuration: 0.2, // seconds
    danceAmplitude: 0.5,
    danceSpeed: 2.0,
    blinkOnBeat: true
};

export function createMoon() {
    const group = new THREE.Group();
    group.name = 'Moon';

    // 1. Moon Body (Sphere)
    const geo = new THREE.SphereGeometry(15, 32, 32);

    // TSL Material for Moon Surface + Blink
    const mat = new MeshStandardNodeMaterial();
    mat.roughnessNode = float(0.8);
    mat.metalnessNode = float(0.1);

    // Base Color (Pale Blue/White)
    const baseColor = color(0xDDEEFF);

    // Blink Effect (Emissive Pulse)
    const uBlink = uniform(0.0); // 0 to 1
    mat.uBlink = uBlink; // Expose to JS

    // Emissive node: Base glow + Blink intensity
    // FIX: Wrap 2.0 in float() to prevent mixed-type errors
    const glow = uBlink.mul(float(2.0));
    
    mat.colorNode = baseColor;
    mat.emissiveNode = color(0xFFFFFF).mul(glow);

    const moonMesh = new THREE.Mesh(geo, mat);
    moonMesh.castShadow = true; 
    group.add(moonMesh);

    // 2. Moon Face (Optional - purely decorative geometry)
    const faceGroup = new THREE.Group();
    faceGroup.position.z = 14.5; // Surface

    const eyeGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-4, 3, 0);
    leftEye.scale.z = 0.5; // Flatten

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(4, 3, 0);
    rightEye.scale.z = 0.5;

    group.userData.eyes = [leftEye, rightEye];

    const mouthGeo = new THREE.TorusGeometry(3, 0.5, 8, 16, Math.PI);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, -2, 0);

    faceGroup.add(leftEye, rightEye, mouth);
    faceGroup.lookAt(0, 0, 100); // Face forward
    group.add(faceGroup);

    // Store state
    group.userData.isMoon = true;
    group.userData.originalPosition = new THREE.Vector3(); // Set when added
    group.userData.velocity = new THREE.Vector3();
    group.userData.blinkTimer = 0;

    // Tag as Sky object
    group.userData.type = 'moon'; 
    group.userData.reactivityType = 'sky';

    return attachReactivity(group);
}

/**
 * Update Moon Animation
 */
export function updateMoon(moon, delta, audioData) {
    if (!moon || !moon.userData.isMoon) return;

    // 1. Dance (Bobbing to beat)
    const timeVal = performance.now() * 0.001;
    const beatPhase = audioData?.beatPhase || 0;
    const groove = audioData?.grooveAmount || 0;

    // Gentle bob always
    const bob = Math.sin(timeVal * moonConfig.danceSpeed) * moonConfig.danceAmplitude;

    // Beat bounce
    const beatBounce = Math.max(0, Math.sin(beatPhase * Math.PI * 2)) * groove * 2.0;

    // Blink on Beat: Check if we are on a strong beat (phase near 0 or 1)
    if (moonConfig.blinkOnBeat && groove > 0.5) {
        // Trigger blink if near the beat (within 0.1 phase window) and debounce
        if (beatPhase < 0.1 && moon.userData.blinkTimer <= 0) {
            triggerMoonBlink(moon);
        }
    }

    const mesh = moon.children[0];
    if (mesh) {
        mesh.position.y = bob + beatBounce;
        mesh.rotation.z = Math.sin(timeVal) * 0.05; // Gentle tilt
    }

    // 2. Blink Logic
    if (moon.userData.blinkTimer > 0) {
        moon.userData.blinkTimer -= delta;
        // Update uniform
        if (mesh.material.uBlink) {
             const t = 1.0 - (moon.userData.blinkTimer / moonConfig.blinkDuration);
             const val = Math.sin(t * Math.PI);
             mesh.material.uBlink.value = val;
        }

        // Squash eyes
        const eyes = moon.userData.eyes;
        if (eyes) {
            eyes.forEach(eye => eye.scale.y = 0.1 + (1.0 - Math.sin(Math.PI * (1.0 - moon.userData.blinkTimer/moonConfig.blinkDuration))) * 0.9);
        }
    } else {
        // Reset eyes
        const eyes = moon.userData.eyes;
        if (eyes) eyes.forEach(eye => eye.scale.y = 1.0);

        if (mesh.material.uBlink) mesh.material.uBlink.value = 0;

        // Random chance to blink
        if (Math.random() < 0.005) {
            triggerMoonBlink(moon);
        }

        // React to channel trigger via system
        if (moon.userData.flashIntensity > 0.1) {
             triggerMoonBlink(moon);
             moon.userData.flashIntensity = 0;
        }
    }
}

export function triggerMoonBlink(moon) {
    moon.userData.blinkTimer = moonConfig.blinkDuration;
}
