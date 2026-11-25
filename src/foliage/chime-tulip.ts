// src/foliage/chime-tulip.ts
//
// Music Garden slice B: the chime tulip, a candy tulip whose bell rings a note in the key of the
// grove around it. What it plays rides `params.degree` / `params.step` of its map record (or a
// figure rolled from its id; `world/document/garden-flora.ts`), so it saves, replays and syncs as
// entity state. The garden sequencer (`audio/garden/`, a lazy chunk) plays it in time and swells
// the bell when the note is heard. Plain meshes over shared geometry and materials: no batcher.

import * as THREE from 'three';
import { color, float } from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { gardenFloraSpawned } from '../audio/garden-hooks.ts';

/** `CHIME_TULIP_TYPE` in `world/document/garden-flora.ts` (that module stays off the boot path). */
const CHIME_TULIP_TYPE = 'chime_tulip';

const STEM_HEIGHT = 1.1;
const BELL_RADIUS = 0.24;
// PALETTE: pastel petals; the bell's inside glows a little so a ring reads in the dark.
const STEM_COLOR = 0x98fb98;
const PETAL_COLOR = 0xffb3d9;
const CLAPPER_COLOR = 0xfff4b0;

let _stem: THREE.CylinderGeometry | null = null;
let _bell: THREE.SphereGeometry | null = null;
let _clapper: THREE.SphereGeometry | null = null;
let _leaf: THREE.CapsuleGeometry | null = null;
let _stemMat: MeshPhysicalNodeMaterial | null = null;
let _petalMat: MeshPhysicalNodeMaterial | null = null;
let _clapperMat: MeshPhysicalNodeMaterial | null = null;

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
    _stem ??= new THREE.CylinderGeometry(0.03, 0.045, STEM_HEIGHT, 8);
    _stem.translate(0, STEM_HEIGHT / 2, 0);
    _bell ??= new THREE.SphereGeometry(BELL_RADIUS, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.72);
    _clapper ??= new THREE.SphereGeometry(0.06, 8, 6);
    _leaf ??= new THREE.CapsuleGeometry(0.04, 0.34, 3, 6);
    _stemMat ??= candyMaterial(STEM_COLOR);
    _petalMat ??= candyMaterial(PETAL_COLOR, 0.12);
    _clapperMat ??= candyMaterial(CLAPPER_COLOR, 0.5);
    return {
        stem: _stem,
        bell: _bell,
        clapper: _clapper,
        leaf: _leaf,
        stemMat: _stemMat,
        petalMat: _petalMat,
        clapperMat: _clapperMat,
    };
}

export interface ChimeTulipParams {
    /** Unchecked here: the sequencer resolves it (`resolveChimeTulip`). */
    degree?: unknown;
    step?: unknown;
}

/** A chime tulip whose origin sits on the ground it grows from. */
export function createChimeTulip(params: ChimeTulipParams = {}): THREE.Group {
    const parts = shared();
    const group = new THREE.Group();

    const stem = new THREE.Mesh(parts.stem, parts.stemMat);
    stem.userData.preventMaterialDispose = true;
    group.add(stem);

    for (let i = 0; i < 2; i++) {
        const leaf = new THREE.Mesh(parts.leaf, parts.stemMat);
        leaf.position.set(i === 0 ? 0.1 : -0.1, 0.22, 0);
        leaf.rotation.z = i === 0 ? -0.7 : 0.7;
        leaf.userData.preventMaterialDispose = true;
        group.add(leaf);
    }

    // The bell hangs open-side down from the top of the stem and swells when it rings.
    const bell = new THREE.Group();
    bell.position.y = STEM_HEIGHT;
    const cup = new THREE.Mesh(parts.bell, parts.petalMat);
    cup.rotation.x = Math.PI;
    cup.position.y = BELL_RADIUS * 0.7;
    cup.userData.preventMaterialDispose = true;
    const clapper = new THREE.Mesh(parts.clapper, parts.clapperMat);
    clapper.position.y = BELL_RADIUS * 0.1;
    clapper.userData.preventMaterialDispose = true;
    bell.add(cup, clapper);
    group.add(bell);

    group.userData.type = CHIME_TULIP_TYPE;
    group.userData.radius = BELL_RADIUS * 1.5;
    group.userData.isGardenFlora = true;
    group.userData.gardenKind = CHIME_TULIP_TYPE;
    /** Raw `params`, as the snapshot (`userData.mapExport.params`) carries them. */
    group.userData.gardenParams = { degree: params.degree, step: params.step };
    /** What the sequencer swells when this plant is heard. */
    group.userData.gardenPulse = bell;

    gardenFloraSpawned();
    return group;
}
