// src/foliage/cave.js

import * as THREE from 'three';
import { createWaterfall } from './waterfalls.js';

export function createCaveEntrance(options = {}) {
    const {
        scale = 1.0,
        depth = 20.0,
        width = 8.0,
        height = 6.0
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'cave';
    group.userData.isBlocked = false;

    // 1. Create the Tunnel Structure (Procedural Rocks)
    const rockMat = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a,
        roughness: 0.9,
        flatShading: true,
        side: THREE.DoubleSide
    });

    // IMPROVED: A 4-point curve for a better tunnel shape
    const tunnelCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, -2, -depth * 0.3),
        new THREE.Vector3(4, -4, -depth * 0.6),
        new THREE.Vector3(10, -6, -depth)
    ]);

    const tubeGeo = new THREE.TubeGeometry(tunnelCurve, 12, width/2, 8, false);

    // FIX: Iterate i++ (not i+=3) to displace EVERY vertex
    const positions = tubeGeo.attributes.position;
    for(let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);
        // Simple noise displacement
        positions.setX(i, x + (Math.random()-0.5) * 0.5);
        positions.setY(i, y + (Math.random()-0.5) * 0.5);
        positions.setZ(i, z + (Math.random()-0.5) * 0.5);
    }
    tubeGeo.computeVertexNormals();

    const tunnelMesh = new THREE.Mesh(tubeGeo, rockMat);
    tunnelMesh.castShadow = true;
    tunnelMesh.receiveShadow = true;
    group.add(tunnelMesh);

    // 2. The Water Gate (Waterfall)
    const gatePos = new THREE.Vector3(0, height * 0.7, -2);
    const floorPos = new THREE.Vector3(0, -1, -2);

    const waterfall = createWaterfall(gatePos, floorPos, width * 0.7);
    waterfall.visible = false; // Starts dry
    waterfall.name = 'WaterGate';
    group.add(waterfall);

    group.userData.waterfall = waterfall;
    group.userData.gatePosition = new THREE.Vector3(0, 0, -2);

    group.scale.setScalar(scale);

    return group;
}

export function updateCaveWaterLevel(caveGroup, waterLevel) {
    const waterfall = caveGroup.userData.waterfall;
    const threshold = 0.2;

    if (waterLevel > threshold) {
        if (!waterfall.visible) waterfall.visible = true;

        const intensity = (waterLevel - threshold) / (1.0 - threshold);
        // Scale thickness based on intensity
        waterfall.scale.set(1.0, 1.0, 0.5 + intensity * 0.5);

        caveGroup.userData.isBlocked = intensity > 0.1;
    } else {
        if (waterfall.visible) waterfall.visible = false;
        caveGroup.userData.isBlocked = false;
    }

    if (waterfall.visible && waterfall.onAnimate) {
        waterfall.onAnimate(0.016, Date.now() / 1000);
    }
}
