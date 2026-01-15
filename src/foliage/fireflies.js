// src/foliage/fireflies.js

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, sin, cos, mix, color, positionLocal, vec3, float } from 'three/tsl';
import { uTime, uAudioLow, uAudioHigh } from './common.js';

export function createFireflies(count = 80, areaSize = 100) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        positions[i * 3] = (Math.random() - 0.5) * areaSize;
        positions[i * 3 + 1] = 0.5 + Math.random() * 4;
        positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;

        // Dummy Normals (required for some TSL nodes)
        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        phases[i] = Math.random() * Math.PI * 2;
        speeds[i] = 0.5 + Math.random() * 1.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    const mat = new PointsNodeMaterial({
        size: 0.2,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const phaseAttr = attribute('phase');
    const speedAttr = attribute('speed');

    // ⚡ PALETTE UPDATE: Audio Reactivity added via TSL

    // 1. Movement: Bass (Kick) adds energy/jitter
    const bassEnergy = uAudioLow.mul(0.5); // 0.0 to 0.5

    // High frequency jitter on heavy beats (Buzzing effect)
    // We keep base frequency constant to avoid phase jumps
    const jitter = sin(uTime.mul(20.0).add(phaseAttr)).mul(bassEnergy).mul(0.5);

    // Sway X - Constant speed base, audio-reactive offset
    const driftX = sin(uTime.mul(0.3).add(phaseAttr)).mul(4.0).add(jitter);
    // Sway Y (smaller, avoid hitting ground)
    const driftY = cos(uTime.mul(0.5).add(phaseAttr.mul(1.3))).mul(1.0).add(jitter);
    // Sway Z
    const driftZ = sin(uTime.mul(0.4).add(phaseAttr.mul(0.7))).mul(4.0).add(jitter);

    const animatedPos = positionLocal.add(vec3(driftX, driftY, driftZ));

    // Y-Constraint: Keep above ground (approximate soft floor at 0.3)
    const constrainedY = animatedPos.y.max(0.3).min(6.0);

    mat.positionNode = vec3(animatedPos.x, constrainedY, animatedPos.z);

    // 2. Color/Intensity: Treble (High Hats) triggers flash
    const blink = sin(uTime.mul(speedAttr).add(phaseAttr));

    // Base natural blink (sharp peaks)
    const baseGlow = blink.sub(0.7).max(0.0).mul(3.33);

    // Audio boost: Add treble energy directly to intensity
    const audioBoost = uAudioHigh.mul(2.0);
    const totalIntensity = baseGlow.add(audioBoost);

    // Color Shift: Green/Yellow -> White/Gold on high intensity
    const calmColor = mix(color(0x88FF00), color(0xFFFF00), baseGlow);
    const hotColor = color(0xFFFFFF); // Flash white on high notes

    const fireflyColor = mix(
        calmColor,
        hotColor,
        audioBoost.min(1.0) // Saturate at 1.0 so we don't blow out too much
    );

    mat.colorNode = fireflyColor.mul(totalIntensity.add(0.1));
    mat.opacityNode = totalIntensity.add(0.05).min(1.0);

    const fireflies = new THREE.Points(geo, mat);
    fireflies.userData.isFireflies = true;
    fireflies.visible = false; // Weather system toggles this

    return fireflies;
}

// ⚡ OPTIMIZATION: Logic moved to TSL shader. Function retained for API compatibility.
export function updateFireflies(fireflies, time, delta) {
    // No-op: Animation is now handled entirely on GPU
}
