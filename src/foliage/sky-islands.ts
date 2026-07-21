/**
 * @file src/foliage/sky-islands.ts
 * @brief Floating candy sky-island meshes for the stacked vertical biome (#1363).
 *
 * Few landmasses (one per tier) — shared BiomeUniforms.skyIslands drive TSL
 * rim displacement + emissive shimmer. A lightweight registry tracks islands
 * for debug connectivity / spawn telemetry (not a full InstancedMesh batcher).
 */

import * as THREE from 'three';
import { CandyPresets, createClayMaterial } from './material-core.ts';
import { attachReactivity } from './foliage-reactivity.ts';
import {
    positionLocal,
    vec3,
    float,
    sin,
    time,
    length,
    color,
    add,
    smoothstep,
} from 'three/tsl';
import { getBiomeUniforms } from '../systems/biome-uniforms.ts';

export type SkyIslandLayerKind = 'mist' | 'canopy' | 'nebula';

export interface SkyIslandOptions {
    radius?: number;
    height?: number;
    /** mist = soft pastel clay; canopy = gem-tinged; nebula = crystalline candy */
    kind?: SkyIslandLayerKind;
    layerId?: string;
}

export interface SkyIslandRecord {
    id: string;
    layerId: string;
    kind: SkyIslandLayerKind;
    x: number;
    y: number;
    z: number;
    radius: number;
    topY: number;
    group: THREE.Object3D;
}

const _registry: SkyIslandRecord[] = [];

/** PALETTE: per-layer candy base colors */
const LAYER_COLORS: Record<SkyIslandLayerKind, number> = {
    mist: 0xFFD1DC,    // cotton-candy pink
    canopy: 0xE6E6FA,  // soft lilac
    nebula: 0xB0E0E6,  // powder aurora
};

const LAYER_UNDERSIDE: Record<SkyIslandLayerKind, number> = {
    mist: 0xFFE4E1,
    canopy: 0xDDA0DD,
    nebula: 0x87CEFA,
};

/**
 * Creates a floating sky island with GPU rim heightmap displacement.
 * Pivot is at the walkable top surface (y=0 locally); mesh extends downward.
 */
export function createSkyIsland(options: SkyIslandOptions = {}): THREE.Group {
    const {
        radius = 10,
        height = 3.5,
        kind = 'mist',
        layerId = 'sky_island',
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'sky_island';
    group.userData.biome = 'sky_islands';
    group.userData.layerId = layerId;
    group.userData.islandKind = kind;
    group.userData.islandRadius = radius;
    group.userData.islandHeight = height;
    group.userData.isWalkable = true;

    const segments = 24;
    const islandGeo = new THREE.CylinderGeometry(radius, radius * 0.55, height, segments, 4);

    // CPU organic rim seed (GPU TSL adds live undulation on top)
    const pos = islandGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const angle = Math.atan2(z, x);
        const r = Math.sqrt(x * x + z * z);
        const noise = Math.sin(angle * 5) * 0.55 + Math.cos(angle * 9) * 0.35;
        const rim = Math.max(0, (r / Math.max(radius, 0.001)) - 0.55);

        if (y > 0) {
            // Top surface: gentle hills, stronger near rim
            pos.setY(i, y + rim * noise * 0.8 + Math.sin(angle * 3) * 0.15);
        } else {
            // Underside taper with scalloped edge
            const taper = 1 + noise * 0.12 * (r / Math.max(radius, 0.001));
            pos.setX(i, x * taper);
            pos.setZ(i, z * taper);
            pos.setY(i, y - Math.abs(noise) * 0.4);
        }
    }
    islandGeo.computeVertexNormals();

    // Translate so top surface sits near local y=0 (walkable deck)
    islandGeo.translate(0, -height * 0.35, 0);

    const baseColor = LAYER_COLORS[kind];
    const underside = LAYER_UNDERSIDE[kind];

    let islandMat: any;
    if (kind === 'nebula') {
        islandMat = CandyPresets.Crystal(baseColor, {
            roughness: 0.25,
            clearcoat: 0.9,
            transmission: 0.15,
        });
    } else if (kind === 'canopy') {
        islandMat = CandyPresets.Sugar(baseColor, {
            roughness: 0.35,
            sheen: 0.8,
        });
    } else {
        islandMat = createClayMaterial(baseColor);
        islandMat.roughness = 0.55;
    }

    // Music Impact: sky_islands shimmer drives rim bob + emissive pastel glow
    const u = getBiomeUniforms('sky_islands') as any;
    const radial = length(vec3(positionLocal.x, float(0), positionLocal.z)).div(float(radius));
    const rimMask = smoothstep(float(0.45), float(1.0), radial);
    const wave = sin(
        radial.mul(12.0)
            .add(time.mul(1.2))
            .add(u.hueShift.mul(6.0))
    ).mul(0.35);
    // Visual Impact: GPU heightmap-style rim displacement (music-reactive amplitude)
    const rimAmp = float(0.25).add(u.shimmer.mul(0.55));
    const rimDisp = vec3(0, rimMask.mul(wave).mul(rimAmp), 0);
    islandMat.positionNode = add(positionLocal, rimDisp);

    const shimmerColor = color(underside);
    const baseEmissive = color(baseColor).mul(u.shimmer).mul(0.45);
    const noteTint = u.noteColor.mul(u.shimmer).mul(0.35);
    const fogLift = u.fogDensity ? u.fogDensity.mul(0.2) : float(0.03);
    islandMat.emissiveNode = add(add(baseEmissive, noteTint), shimmerColor.mul(fogLift));

    const islandMesh = new THREE.Mesh(islandGeo, islandMat);
    islandMesh.castShadow = true;
    islandMesh.receiveShadow = true;
    group.add(islandMesh);

    // Soft candy "soil" disc on top for clearer walkable read
    const deckMat = CandyPresets.Clay(baseColor, { roughness: 0.7, bumpStrength: 0.15 });
    const deck = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.18, segments),
        deckMat as THREE.Material
    );
    deck.position.y = 0.05;
    deck.receiveShadow = true;
    group.add(deck);

    // Underside stalactite candy drips (decorative)
    const dripCount = kind === 'nebula' ? 5 : 3;
    for (let i = 0; i < dripCount; i++) {
        const a = (i / dripCount) * Math.PI * 2 + 0.4;
        const dist = radius * (0.35 + (i % 3) * 0.15);
        const drip = new THREE.Mesh(
            new THREE.ConeGeometry(0.35 + Math.random() * 0.25, 1.2 + Math.random(), 6),
            createClayMaterial(underside)
        );
        drip.position.set(Math.cos(a) * dist, -height * 0.55, Math.sin(a) * dist);
        drip.rotation.x = Math.PI;
        group.add(drip);
    }

    attachReactivity(group, { type: 'flora' });
    return group;
}

/** Register an island after world placement (absolute Y set). */
export function registerSkyIsland(group: THREE.Object3D): SkyIslandRecord | null {
    if (group.userData.type !== 'sky_island') return null;
    const radius = typeof group.userData.islandRadius === 'number' ? group.userData.islandRadius : 10;
    const kind = (group.userData.islandKind as SkyIslandLayerKind) || 'mist';
    const layerId = typeof group.userData.layerId === 'string' ? group.userData.layerId : 'sky_island';
    const id = typeof group.userData.persistentId === 'string'
        ? group.userData.persistentId
        : `sky_island:${group.position.x.toFixed(1)}_${group.position.z.toFixed(1)}_${group.position.y.toFixed(1)}`;

    const record: SkyIslandRecord = {
        id,
        layerId,
        kind,
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
        radius,
        topY: group.position.y,
        group,
    };

    const existing = _registry.findIndex(r => r.id === id);
    if (existing >= 0) _registry[existing] = record;
    else _registry.push(record);

    return record;
}

export function getRegisteredSkyIslands(): readonly SkyIslandRecord[] {
    return _registry;
}

export function clearSkyIslandRegistry(): void {
    _registry.length = 0;
}

/**
 * Lightweight batcher facade — tracks islands for connectivity / debug.
 * Materials already share BiomeUniforms; no per-frame instance writes needed.
 */
export class SkyIslandBatcher {
    readonly id = 'sky_islands';

    get count(): number {
        return _registry.length;
    }

    register(group: THREE.Object3D): SkyIslandRecord | null {
        return registerSkyIsland(group);
    }

    clear(): void {
        clearSkyIslandRegistry();
    }
}

export const skyIslandBatcher = new SkyIslandBatcher();
