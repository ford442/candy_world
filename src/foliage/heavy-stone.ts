// src/foliage/heavy-stone.ts
//
// Source of the `heavy_stone` item (Wind Anchor, #1976 slice A): glossy
// ballast stones resting on the Sugar Caves floor.

import * as THREE from 'three';
import { unlockSystem } from '../systems/unlocks.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { spawnImpact } from './impacts.ts';

const STONE_RADIUS = 0.9;
const STONE_COLOR = 0xb39ddb;

let _geometry: THREE.DodecahedronGeometry | null = null;
let _material: THREE.MeshPhysicalMaterial | null = null;

function sharedStone(): { geometry: THREE.DodecahedronGeometry; material: THREE.MeshPhysicalMaterial } {
    _geometry ??= new THREE.DodecahedronGeometry(STONE_RADIUS, 1);
    _material ??= new THREE.MeshPhysicalMaterial({
        color: STONE_COLOR,
        roughness: 0.35,
        metalness: 0.0,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
    });
    return { geometry: _geometry, material: _material };
}

/** A harvestable stone whose origin sits on the surface it rests on. */
export function createHeavyStone(): THREE.Group {
    const { geometry, material } = sharedStone();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = STONE_RADIUS * 0.8;
    mesh.scale.set(1, 0.8, 1);
    group.add(mesh);

    group.userData.type = 'heavy_stone';
    group.userData.radius = STONE_RADIUS * 1.5;
    group.userData.interactionText = '🪨 Lift Heavy Stone';
    makeInteractive(group);
    group.userData.onInteract = () => {
        if (group.userData.harvested) return;
        group.userData.harvested = true;
        unlockSystem.harvest('heavy_stone', 1, 'Heavy Stone');
        spawnImpact(group.position, 'spore', STONE_COLOR);
        group.visible = false;
        group.userData.onInteract = undefined;
        group.userData.interactionText = undefined;
    };
    return group;
}
