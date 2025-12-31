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

    const tunnelCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, -2, -depth * 0.5),
        new THREE.Vector3(5, -4, -depth) // Curves to the right and down
    ]);

    const tubeGeo = new THREE.TubeGeometry(tunnelCurve, 10, width/2, 8, false);
    // Invert faces so we see the inside - technically DoubleSide handles visibility,
    // but displacing vertices for "rockiness" helps.
    const positions = tubeGeo.attributes.position;
    for(let i = 0; i < positions.count; i+=3) {
        // Simple noise displacement for rock look
        const dx = (Math.random()-0.5) * 1.5;
        const dy = (Math.random()-0.5) * 1.5;
        const dz = (Math.random()-0.5) * 1.5;

        positions.setX(i, positions.getX(i) + dx);
        positions.setY(i, positions.getY(i) + dy);
        positions.setZ(i, positions.getZ(i) + dz);
    }
    tubeGeo.computeVertexNormals();

    const tunnelMesh = new THREE.Mesh(tubeGeo, rockMat);
    tunnelMesh.castShadow = true;
    tunnelMesh.receiveShadow = true;
    group.add(tunnelMesh);

    // 2. The Water Gate (Waterfall)
    // Position it at the entrance
    // The tunnel starts at 0,0,0. We want the gate slightly inside or at the mouth.
    const gateTop = new THREE.Vector3(0, height * 0.6, -2);
    const gateBottom = new THREE.Vector3(0, -1, -2); // Slightly underground/floor

    const waterfall = createWaterfall(gateTop, gateBottom, width * 0.6);
    waterfall.visible = false; // Starts dry
    waterfall.name = 'WaterGate';
    group.add(waterfall);

    // Store reference for updates
    group.userData.waterfall = waterfall;
    // Store local position of blockage for physics checks
    // We'll use the midpoint of the gate
    group.userData.gatePosition = new THREE.Vector3(0, 0, -2);

    // Apply overall scale
    group.scale.setScalar(scale);

    return group;
}

// Update function called by WeatherSystem
export function updateCaveWaterLevel(caveGroup, waterLevel) {
    // waterLevel is 0.0 to 1.0 (saturation)

    const waterfall = caveGroup.userData.waterfall;
    const threshold = 0.2; // Start flowing at 20% saturation

    if (waterLevel > threshold) {
        if (!waterfall.visible) waterfall.visible = true;

        // Scale flow visual with level
        // Normalize intensity between threshold and 1.0
        const intensity = (waterLevel - threshold) / (1.0 - threshold);

        // Adjust scale or thickness if possible.
        // Our createWaterfall implementation returns a group with meshes.
        // We can scale the width (X/Z) or just rely on opacity/existence.
        // Let's pulse the scale slightly.
        waterfall.scale.setScalar(0.8 + intensity * 0.4);

        // Mark as blocked for physics
        // Block if flow is significant
        caveGroup.userData.isBlocked = intensity > 0.1;
    } else {
        if (waterfall.visible) waterfall.visible = false;
        caveGroup.userData.isBlocked = false;
    }

    // Animate the waterfall if visible
    // The waterfall group has an onAnimate method attached in createWaterfall
    if (waterfall.visible && waterfall.onAnimate) {
        // We assume time is handled internally or passed via main loop -> WeatherSystem -> here
        // Since we don't have the exact global time here, we might need to pass it in.
        // WeatherSystem's loop has 'time'. We should update the signature if needed,
        // but for now let's see if updateCaveWaterLevel is called with just waterLevel.
        // The plan says: updateCaveWaterLevel(cave, this.groundWaterLevel);
        // BUT WeatherSystem ALSO calls: cave.userData.waterfall.onAnimate(0.016, time); separately.
        // So we don't need to call onAnimate here.
    }
}
