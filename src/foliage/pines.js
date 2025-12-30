import * as THREE from 'three';
import {
    MeshStandardNodeMaterial,
    color,
    float,
    vec3,
    positionLocal,
    uniform,
    mix,
    Fn
} from 'three/tsl';
import { attachReactivity } from './common.js';

/**
 * Creates a "Portamento Pine" - A towering antenna cluster made of copper alloy.
 * Reacts to melody channel (Channel 2) by bending using TSL vertex displacement.
 *
 * Aesthetic: "Cute Clay" / "Copper Alloy"
 * Behavior: Bends smoothly (simulated portamento) when melody plays.
 */
export function createPortamentoPine(options = {}) {
    const {
        height = 5.0,
        radius = 0.3,
        colorHex = 0xB87333 // Copper
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'portamento_pine';

    // 1. Geometry: Stack of segments to allow bending
    const geometry = new THREE.CylinderGeometry(radius * 0.2, radius, height, 8, 16, true);
    geometry.translate(0, height / 2, 0);

    // 2. Material: Copper Alloy with TSL Bending

    // Uniforms for bending
    const uBendStrength = uniform(0.0);
    const bendDirectionVector = new THREE.Vector3(1, 0, 0);
    const uBendDirection = uniform(bendDirectionVector);

    // Optimization: Pass height as uniform to allow shader sharing across instances
    const uHeight = uniform(height);

    // Material Setup
    const material = new MeshStandardNodeMaterial({
        color: new THREE.Color(colorHex),
        roughness: 0.4,
        metalness: 0.9,
    });

    // TSL Logic for Vertex Displacement (Bending)
    const bendingLogic = Fn(() => {
        const pos = positionLocal;

        // Calculate bend amount based on height (y) squared
        // Use uniform uHeight instead of constant to share shader
        const normalizedHeight = pos.y.div(uHeight);
        const bendFactor = normalizedHeight.pow(2.0).mul(uBendStrength);

        // Displace X and Z based on bend direction
        const displacement = uBendDirection.mul(bendFactor);

        const newPos = vec3(
            pos.x.add(displacement.x),
            pos.y,
            pos.z.add(displacement.z)
        );

        return newPos;
    });

    material.positionNode = bendingLogic();

    // Glow Logic: Stress lines
    const glowLogic = Fn(() => {
        const bendMag = uBendStrength.abs();
        const baseColor = color(new THREE.Color(colorHex));
        const glowColor = color(new THREE.Color(0xFF8844)); // Hot copper

        // Mix based on bend strength and height
        const mixFactor = bendMag.mul(positionLocal.y.div(uHeight)).mul(0.8);
        return mix(baseColor, glowColor, mixFactor);
    });

    material.colorNode = glowLogic();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Store uniforms
    mesh.userData.uBendStrength = uBendStrength;
    mesh.userData.uHeight = uHeight; // Store ref just in case

    group.add(mesh);

    // 3. Reactivity

    // Internal state
    group.userData.reactivityState = {
        currentBend: 0,
        velocity: 0,
        targetDir: new THREE.Vector3(1, 0, 0)
    };

    group.userData.reactToNote = (noteInfo) => {
        // Trigger on Melody (Ch 2) or Harmony (Ch 3)
        if (noteInfo.channel === 2 || noteInfo.channel === 3) {
            const angle = Math.random() * Math.PI * 2;

            // Update direction immediately
            bendDirectionVector.set(Math.cos(angle), 0, Math.sin(angle));

            // Add "velocity" to the bend strength
            group.userData.reactivityState.velocity += 15.0 * (noteInfo.velocity || 0.5);

            // Audio Trigger
            // Try to play a sound if the system is available
            // We use a safe check. 'creak' is a placeholder ID.
            if (window.AudioSystem && typeof window.AudioSystem.playSound === 'function') {
                // Determine pitch based on note if available, else random
                const pitch = noteInfo.note ? 1.0 : 0.8 + Math.random() * 0.4;
                window.AudioSystem.playSound('creak', {
                    position: group.position,
                    pitch: pitch,
                    volume: 0.3
                });
            }
        }
    };

    attachReactivity(group, {
        type: 'flora',
        channel: 2,
        baseColor: new THREE.Color(colorHex),
        reactColor: new THREE.Color(0xFFFFFF)
    });

    // Custom update method
    group.userData.onUpdate = (delta) => {
        // Spring physics for bending strength
        const k = 10.0;
        const damp = 0.92;

        const state = group.userData.reactivityState;

        const force = -k * state.currentBend;
        state.velocity += force * delta;
        state.velocity *= damp;

        state.currentBend += state.velocity * delta;

        // Update TSL uniform value
        if (mesh.userData.uBendStrength) {
            mesh.userData.uBendStrength.value = state.currentBend;
        }
    };

    return group;
}
