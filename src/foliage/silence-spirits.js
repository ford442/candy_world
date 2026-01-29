// src/foliage/silence-spirits.js

import * as THREE from 'three';
import {
    createTransparentNodeMaterial,
    sharedGeometries,
    registerReactiveMaterial,
    attachReactivity,
    uTime
} from './common.ts';
import { color, float, mix, sin, cos, positionLocal, vec3, normalWorld } from 'three/tsl';

export function createSilenceSpirit(options = {}) {
    const group = new THREE.Group();
    const { scale = 1.0 } = options;

    // A Spirit is an ephemeral creature made of stardust/light.
    // We'll use a combination of a ghost mesh and a particle cloud.

    // 1. Ghost Body (Translucent, Dissolving)
    const bodyMat = createTransparentNodeMaterial({
        color: 0xEEFFFF,
        emissive: 0x88CCFF,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        opacity: 0.0, // Start invisible
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // Custom TSL for "Stardust" body
    // We want it to shimmer and fade based on noise
    // But since we are in JS, we can just use standard node material properties for now
    // and animate opacity in the loop.

    const bodyGeo = new THREE.CapsuleGeometry(0.3 * scale, 1.0 * scale, 4, 8);
    bodyGeo.translate(0, 0.8 * scale, 0);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Antlers / Head
    const headGeo = new THREE.SphereGeometry(0.25 * scale, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.y = 1.4 * scale;
    body.add(head);

    // 2. State
    group.userData.type = 'silenceSpirit';
    group.userData.animationType = 'spiritFade'; // Custom animation type
    group.userData.isVisible = false;
    group.userData.targetOpacity = 0.0;
    group.userData.currentOpacity = 0.0;
    group.userData.fleeSpeed = 0.0;

    // Store material reference for opacity animation
    group.userData.spiritMaterial = bodyMat;

    return group;
}
