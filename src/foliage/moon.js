import * as THREE from 'three';
import { color, vec3, time, sin, cos, uniform, mix, positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

// Moon Configuration
export const moonConfig = {
    blinkDuration: 0.2, // seconds
    danceAmplitude: 0.5,
    danceSpeed: 2.0
};

export function createMoon() {
    const group = new THREE.Group();
    group.name = 'Moon';

    // 1. Moon Body (Sphere)
    const geo = new THREE.SphereGeometry(15, 32, 32);

    // TSL Material for Moon Surface + Blink
    const mat = new MeshStandardNodeMaterial({
        roughness: 0.8,
        metalness: 0.1
    });

    // Base Color (Pale Blue/White)
    const baseColor = color(0xDDEEFF);

    // Blink Effect (Emissive Pulse)
    // We can drive this via a uniform 'uMoonBlink' updated from JS
    // Or use time-based if generic. For music sync, we use a uniform.
    const uBlink = uniform(0.0); // 0 to 1
    mat.uBlink = uBlink; // Expose to JS

    // Emissive node: Base glow + Blink intensity
    // Blink adds a strong white flash
    const glow = uBlink.mul(2.0);
    mat.colorNode = baseColor;
    mat.emissiveNode = color(0xFFFFFF).mul(glow);

    const moonMesh = new THREE.Mesh(geo, mat);
    moonMesh.castShadow = true; // Moon casts shadow (simulated as directional light source usually, but mesh itself can too)
    group.add(moonMesh);

    // 2. Moon Face (Optional - purely decorative geometry)
    // Simple eyes and mouth for "Charming Moon"
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

    // Blink Animation (Scale eyes)
    // We'll handle this in the animate function in main.js or helper here
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

    return group;
}

/**
 * Update Moon Animation
 * @param {THREE.Group} moon - Moon group
 * @param {number} delta - Time delta
 * @param {object} audioData - Audio state
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

    // Apply to local Y (assuming moon is placed in a container or we modify local position relative to orbit)
    // Since moon moves across sky, we should apply this as a local offset if possible.
    // However, moon is likely child of scene.
    // We might need to handle this carefully if moon position is driven by Day/Night cycle.
    // Recommendation: Add moon mesh to a "MoonContainer" which handles orbit, and animate mesh local position.
    // For now, let's assume moon.children[0] (the mesh) can be animated locally.

    const mesh = moon.children[0];
    if (mesh) {
        mesh.position.y = bob + beatBounce;
        mesh.rotation.z = Math.sin(timeVal) * 0.05; // Gentle tilt
    }

    // 2. Blink Logic
    // Random blink or on beat
    if (moon.userData.blinkTimer > 0) {
        moon.userData.blinkTimer -= delta;
        // Update uniform
        if (mesh.material.uBlink) {
             // 0..1..0 curve
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

        // Blink on strong kick?
        if (audioData?.kickTrigger > 0.8) {
             triggerMoonBlink(moon);
        }
    }
}

export function triggerMoonBlink(moon) {
    moon.userData.blinkTimer = moonConfig.blinkDuration;
}
