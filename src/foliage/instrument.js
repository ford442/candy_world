// src/foliage/instrument.js

import * as THREE from 'three';
import {
    createUnifiedMaterial,
    sharedGeometries,
    registerReactiveMaterial,
    attachReactivity
} from './common.js';
import {
    color, float, mix, uv, sin, cos, positionLocal,
    vec3, normalWorld, mx_noise_float
} from 'three/tsl';
import { triplanarNoise } from './common.js';

export function createInstrumentShrine(options = {}) {
    const {
        instrumentID = 0,
        scale = 1.0
    } = options;

    const group = new THREE.Group();

    // The Shrine is a monolith that displays patterns based on the Instrument ID.
    // 0 = Drums, 1 = Bass, etc (in standard MOD files instruments are 1-based usually).

    const shrineMat = createUnifiedMaterial(0x333333, {
        roughness: 0.2,
        metalness: 0.8,
        bumpStrength: 0.1
    });

    // Custom TSL override for Color based on Instrument ID
    // We create a procedural pattern
    const id = float(instrumentID);

    // Pattern Logic:
    // Generate a pattern based on UV and ID
    const pUV = uv().mul(10.0);

    // Different math for different ID ranges for variety
    const patternA = sin(pUV.x.add(id)).mul(cos(pUV.y.add(id))); // Grid-like
    const patternB = mx_noise_float(vec3(pUV.x, pUV.y, id)); // Noise-like

    // Mix based on ID modulo
    // We can't use modulo easily in TSL without some work, so let's just use sin(id) to mix
    const mixFactor = sin(id.mul(0.5)).add(1.0).mul(0.5); // 0 to 1

    const pattern = mix(patternA, patternB, mixFactor);

    // Colorize
    // Map ID to Hue (Calculate in JS since ID is constant per instance)
    const jsHue = (instrumentID * 0.1) % 1.0;
    const jsColor = new THREE.Color().setHSL(jsHue, 1.0, 0.5);

    const baseCol = color(jsColor);

    // Apply pattern to emissive
    shrineMat.emissiveNode = baseCol.mul(pattern.add(0.5).mul(2.0)); // Glow

    // Geometry: Monolith
    const geo = new THREE.BoxGeometry(1, 3, 1);
    const mesh = new THREE.Mesh(geo, shrineMat);
    mesh.scale.set(scale, scale, scale);
    mesh.position.y = 1.5 * scale;
    mesh.castShadow = true;

    group.add(mesh);

    // Floating symbol on top (Sphere)
    const orbMat = createUnifiedMaterial(0xFFFFFF, {
        transmission: 1.0,
        thickness: 1.0,
        roughness: 0.0,
        ior: 1.5,
        iridescenceStrength: 1.0
    });
    const orb = new THREE.Mesh(sharedGeometries.unitSphere, orbMat);
    orb.position.y = 3.5 * scale;
    orb.scale.setScalar(0.5 * scale);
    group.add(orb);

    group.userData.type = 'instrumentShrine';
    group.userData.instrumentID = instrumentID;

    // Simple float animation
    group.userData.animationType = 'float';
    group.userData.animationOffset = Math.random() * 100;

    // Reactivity
    attachReactivity(group, { minLight: 0.0, maxLight: 1.0 });

    return group;
}
