// src/foliage/music-stone.ts
//
// The grove composer's music stone (#1976 slice C): a glossy pebble with a ring
// of eight candy keys, one per voice. Its grove pattern (8 voices × 16 steps)
// rides `params.pattern` of its map record, so it saves, replays and syncs as
// entity state; `world/document/grove-pattern.ts` is the model. Interacting
// opens the pattern editor; standing near it plays its pattern through the
// generative soundtrack (both in the lazy `composer` chunk, `systems/composer/`).

import * as THREE from 'three';
import { color, float } from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { musicStoneSpawned, openMusicStone } from '../systems/music-stone-hooks.ts';

/**
 * `MUSIC_STONE_TYPE` in `world/document/grove-pattern.ts`, repeated: that module is in the lazy
 * `save-ui` chunk, and importing it from here would put it (and valibot) on the boot path.
 */
const MUSIC_STONE_TYPE = 'music_stone';

const STONE_RADIUS = 0.85;
const KEY_RING = 0.62;
/** One per voice, in `CHANNEL_VOICES` order. Exported for the editor's row swatches. */
export const MUSIC_STONE_KEY_COLORS: readonly number[] = [
    0xff8fab, 0xffc6ff, 0xa0c4ff, 0x9bf6ff, 0xcaffbf, 0xfdffb6, 0xffd6a5, 0xbdb2ff,
];
const STONE_COLOR = 0xe7c6ff;

let _stoneGeometry: THREE.SphereGeometry | null = null;
let _keyGeometry: THREE.CapsuleGeometry | null = null;
let _stoneMaterial: MeshPhysicalNodeMaterial | null = null;
const _keyMaterials: MeshPhysicalNodeMaterial[] = [];

function candyMaterial(hex: number, emissive = 0): MeshPhysicalNodeMaterial {
    const m = new MeshPhysicalNodeMaterial();
    m.colorNode = color(hex);
    m.roughnessNode = float(0.3);
    m.metalnessNode = float(0.0);
    m.clearcoatNode = float(0.8);
    m.clearcoatRoughnessNode = float(0.2);
    if (emissive > 0) m.emissiveNode = color(hex).mul(float(emissive));
    return m;
}

function shared() {
    _stoneGeometry ??= new THREE.SphereGeometry(STONE_RADIUS, 20, 14);
    _keyGeometry ??= new THREE.CapsuleGeometry(0.09, 0.16, 4, 8);
    _stoneMaterial ??= candyMaterial(STONE_COLOR);
    if (_keyMaterials.length === 0) {
        for (const hex of MUSIC_STONE_KEY_COLORS) _keyMaterials.push(candyMaterial(hex, 0.35));
    }
    return {
        stone: _stoneGeometry,
        key: _keyGeometry,
        stoneMaterial: _stoneMaterial,
        keyMaterials: _keyMaterials,
    };
}

export interface MusicStoneParams {
    /** The authored pattern, unchecked here: the composer resolves it (`resolveStonePattern`). */
    pattern?: unknown;
}

/** A music stone whose origin sits on the ground it rests on. */
export function createMusicStone(params: MusicStoneParams = {}): THREE.Group {
    const parts = shared();
    const group = new THREE.Group();

    const body = new THREE.Mesh(parts.stone, parts.stoneMaterial);
    body.position.y = STONE_RADIUS * 0.55;
    body.scale.set(1, 0.6, 1);
    body.userData.preventMaterialDispose = true;
    group.add(body);

    const keys: THREE.Mesh[] = [];
    for (let i = 0; i < parts.keyMaterials.length; i++) {
        const a = (i / parts.keyMaterials.length) * Math.PI * 2;
        const key = new THREE.Mesh(parts.key, parts.keyMaterials[i]);
        key.position.set(Math.cos(a) * KEY_RING, STONE_RADIUS * 0.95, Math.sin(a) * KEY_RING);
        key.userData.preventMaterialDispose = true;
        key.userData.restY = key.position.y;
        group.add(key);
        keys.push(key);
    }

    group.userData.type = MUSIC_STONE_TYPE;
    group.userData.radius = STONE_RADIUS * 1.2;
    group.userData.isMusicStone = true;
    /** Raw `params.pattern`; the snapshot (`userData.mapExport.params`) carries the same value. */
    group.userData.grovePattern = params.pattern;
    /** The candy keys, in voice order: the composer bobs one when its voice plays. */
    group.userData.musicStoneKeys = keys;
    group.userData.interactionText = '🎼 Compose at the Music Stone';
    group.userData.onInteract = () => openMusicStone(group);

    musicStoneSpawned();
    return group;
}
