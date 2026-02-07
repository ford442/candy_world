// src/foliage/cave.ts

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, mix, positionLocal, normalWorld,
    smoothstep, abs
} from 'three/tsl';
import {
    uAudioLow, createRimLight, triplanarNoise, perturbNormal
} from './common.ts';
import { uTwilight } from './sky.ts';
import { createWaterfall } from './waterfalls.ts';

export interface CaveOptions {
    scale?: number;
    depth?: number;
    width?: number;
    height?: number;
}

export function createCaveEntrance(options: CaveOptions = {}): THREE.Group {
    const {
        scale = 1.0,
        depth = 20.0,
        width = 8.0,
        height = 6.0
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'cave';
    group.userData.isBlocked = false;

    // --- PALETTE UPGRADE: Living Cave Material ---
    const rockMat = new MeshStandardNodeMaterial();

    // 1. Base Rock Texture (Triplanar)
    const noiseScale = float(0.5);
    const rockNoise = triplanarNoise(positionLocal, noiseScale);

    // Dark Organic Rock Colors
    const colorDeep = color(0x1a1a1a); // Black/Grey
    const colorHighlight = color(0x2d2d3a); // Blue-ish Grey

    // Mix based on noise
    const baseColor = mix(colorDeep, colorHighlight, rockNoise);

    // 2. Bioluminescent Veins (Audio Reactive)
    // Create thin lines where noise is close to 0
    const veinScale = float(2.5);
    const veinNoise = triplanarNoise(positionLocal, veinScale);
    // Create a narrow band around 0.0
    const veinMask = float(1.0).sub(smoothstep(0.01, 0.08, abs(veinNoise)));

    // Pulse with Bass (AudioLow)
    // Glows stronger at night (Twilight)
    const pulse = uAudioLow.mul(0.8).add(0.2); // Always some glow, pulse harder on beat
    const glowStrength = veinMask.mul(pulse).mul(uTwilight).mul(3.0);
    const veinColor = color(0x00FFFF); // Cyan glow

    // 3. Rim Light (Edge Definition)
    const rim = createRimLight(color(0x444455), float(0.5), float(2.0));

    // Combine Colors
    rockMat.colorNode = baseColor.add(rim);
    rockMat.emissiveNode = veinColor.mul(glowStrength);

    // 4. Surface Detail (Bump & Roughness)
    // Wet spots where noise is high
    rockMat.roughnessNode = float(0.9).sub(rockNoise.mul(0.4)); // 0.5 to 0.9
    rockMat.metalnessNode = float(0.1);

    // Bump Map for detail
    rockMat.normalNode = perturbNormal(positionLocal, normalWorld, float(8.0), float(0.5));

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

export function updateCaveWaterLevel(caveGroup: THREE.Group, waterLevel: number): void {
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

    if (waterfall.visible && (waterfall as any).onAnimate) {
        (waterfall as any).onAnimate(0.016, Date.now() / 1000);
    }
}
