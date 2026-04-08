// src/foliage/lake_features.ts
import * as THREE from 'three';
import {
    CandyPresets, attachReactivity
} from './index.ts';
import {
    positionLocal, vec3, float, sin, time, uv, add
} from 'three/tsl';

export interface IslandOptions {
    radius?: number;
    height?: number;
    hasCreek?: boolean;
}

/**
 * Creates a floating island with a stylized creek path
 */
export function createIsland(options: IslandOptions = {}): THREE.Group {
    const {
        radius = 15.0,
        height = 3.0,
        hasCreek = true
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'lake_island'; // Updated type to match discovery map

    // 1. Base Island Geometry (Flattened Sphere/Cylinder hybrid)
    const islandGeo = new THREE.CylinderGeometry(radius, radius * 0.8, height, 16, 2);
    // Displace vertices for organic look
    const pos = islandGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);

        // Noise-like displacement (simple random for now, could be improved)
        const angle = Math.atan2(z, x);
        const r = Math.sqrt(x*x + z*z);
        const noise = Math.sin(angle * 5) * 0.5 + Math.cos(angle * 8) * 0.3;

        if (y > 0) { // Top
            pos.setY(i, y + Math.random() * 0.5);
        } else { // Bottom
            pos.setX(i, x * (1 + noise * 0.1));
            pos.setZ(i, z * (1 + noise * 0.1));
        }
    }
    islandGeo.computeVertexNormals();

    const islandMat = CandyPresets.Clay(0xD2B48C, { // Tan/Sand color
        roughness: 0.9,
        bumpStrength: 0.2,
        noiseScale: 3.0
    });

    const islandMesh = new THREE.Mesh(islandGeo, islandMat);
    islandMesh.position.y = height / 2;
    group.add(islandMesh);

    // 2. Creek (if enabled)
    // A simple curved path on top of the island
    if (hasCreek) {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-radius * 0.8, height + 0.1, -radius * 0.2),
            new THREE.Vector3(-radius * 0.2, height + 0.1, radius * 0.2),
            new THREE.Vector3(radius * 0.4, height + 0.1, -radius * 0.3),
            new THREE.Vector3(radius * 0.9, height + 0.1, 0)
        ]);

        const creekGeo = new THREE.TubeGeometry(curve, 20, 1.5, 8, false);

        // TSL Flowing Water Material
        const creekMat = CandyPresets.SeaJelly(0x44AAFF, {
            transmission: 0.8,
            roughness: 0.1
        }) as any; // Cast to any to access TSL properties like positionNode

        // ⚡ OPTIMIZATION & JUICE: Explicit TSL flow animation for the creek
        // Displace the creek surface based on UVs and time to create a flowing water effect
        const flowTime = time.mul(2.0);
        const flowUv = uv(); // TubeGeometry uses 2D UVs

        // Create ripples moving along the creek
        const ripple = sin(flowUv.x.mul(10.0).add(flowTime)).mul(0.1);
        const displacement = vec3(0, ripple, 0);

        // Apply the displacement
        const basePosition = positionLocal;
        creekMat.positionNode = add(basePosition, displacement);

        const creekMesh = new THREE.Mesh(creekGeo, creekMat);
        group.add(creekMesh);
    }

    // 3. Decorations (Rocks, Small Plants)
    // Add a few rocks
    for (let i = 0; i < 5; i++) {
        const rockGeo = new THREE.DodecahedronGeometry(1 + Math.random(), 0);
        const rockMat = CandyPresets.Clay(0x808080);
        const rock = new THREE.Mesh(rockGeo, rockMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * (radius * 0.7);
        rock.position.set(Math.cos(angle) * dist, height + 0.5, Math.sin(angle) * dist);
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(rock);
    }

    // Reactivity
    attachReactivity(group, { type: 'flora' });

    return group;
}
