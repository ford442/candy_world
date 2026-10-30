// src/foliage/heavy-stone.ts
//
// Source of the `heavy_stone` item (Wind Anchor, #1976 slice A): glossy
// ballast stones around the Sugar Caves door on the lake island, outside the
// awakened gate so Wind Anchor does not wait on Part II, plus one on the cave
// floor. Harvested stones are remembered by site id and are not placed again.

import * as THREE from 'three';
import { LAKE_ISLAND } from '../systems/ground-height-core.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { spawnImpact } from './impacts.ts';

const STONE_RADIUS = 0.9;
const STONE_COLOR = 0xb39ddb;

let _geometry: THREE.DodecahedronGeometry | null = null;
let _material: THREE.MeshPhysicalMaterial | null = null;

function sharedStone(): {
    geometry: THREE.DodecahedronGeometry;
    material: THREE.MeshPhysicalMaterial;
} {
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

/** Island stones sit between the geyser ring (0.7 r) and the flower ring (0.45 r). */
const ISLAND_RING = LAKE_ISLAND.radius * 0.58;
/** Degrees from +X, between geysers and away from the descent (~135°). */
const ISLAND_ANGLES_DEG = [30, 210, 330];

export interface HeavyStoneSite {
    id: string;
    x: number;
    z: number;
}

/** The stones on the lake island, before the Part II door. */
export function heavyStoneIslandSites(): HeavyStoneSite[] {
    return ISLAND_ANGLES_DEG.map((deg, i) => {
        const a = THREE.MathUtils.degToRad(deg);
        return {
            id: `heavy_stone:island:${i}`,
            x: LAKE_ISLAND.centerX + Math.cos(a) * ISLAND_RING,
            z: LAKE_ISLAND.centerZ + Math.sin(a) * ISLAND_RING,
        };
    });
}

/** A harvestable stone whose origin sits on the surface it rests on. */
export function createHeavyStone(siteId?: string): THREE.Group {
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
        if (siteId) unlockSystem.markSiteHarvested(siteId);
        unlockSystem.harvest('heavy_stone', 1, 'Heavy Stone');
        spawnImpact(group.position, 'spore', STONE_COLOR);
        safeRemoveAndDispose(group.parent as THREE.Scene || group, group);
        group.userData.onInteract = undefined;
        group.userData.interactionText = undefined;
    };
    return group;
}
