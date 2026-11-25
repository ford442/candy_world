// src/foliage/drum-puffball.ts
//
// Music Garden slice B: the drum puffball, a squat fuzzy puff with a drumhead on top. Kick, snare
// or hat (`params.drum`, or the one rolled from its id; `world/document/garden-flora.ts`) rides
// its map record like the chime tulip's note, and the garden sequencer (`audio/garden/`) plays it
// in time and squashes the puff when the hit is heard. Plain meshes over shared geometry and
// materials: no batcher.

import * as THREE from 'three';
import { color, float } from 'three/tsl';
import { MeshPhysicalNodeMaterial } from 'three/webgpu';
import { gardenFloraSpawned } from '../audio/garden-hooks.ts';

/** `DRUM_PUFFBALL_TYPE` in `world/document/garden-flora.ts` (that module stays off the boot path). */
const DRUM_PUFFBALL_TYPE = 'drum_puffball';

const PUFF_RADIUS = 0.42;
// PALETTE: one candy colour per drum, so a garden reads at a glance: kick pink, snare blue, hat mint.
export const DRUM_PUFFBALL_COLORS: Readonly<Record<string, number>> = {
    kick: 0xff8fab,
    snare: 0xa0c4ff,
    hat: 0xcaffbf,
};
const HEAD_COLOR = 0xfff4e0;

let _puff: THREE.SphereGeometry | null = null;
let _head: THREE.CylinderGeometry | null = null;
let _tuft: THREE.ConeGeometry | null = null;
const _puffMats = new Map<string, MeshPhysicalNodeMaterial>();
let _headMat: MeshPhysicalNodeMaterial | null = null;

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

function shared(drum: string) {
    _puff ??= new THREE.SphereGeometry(PUFF_RADIUS, 16, 12);
    _head ??= new THREE.CylinderGeometry(PUFF_RADIUS * 0.55, PUFF_RADIUS * 0.55, 0.05, 16);
    _tuft ??= new THREE.ConeGeometry(0.05, 0.16, 5);
    let puffMat = _puffMats.get(drum);
    if (!puffMat) {
        puffMat = candyMaterial(DRUM_PUFFBALL_COLORS[drum] ?? DRUM_PUFFBALL_COLORS.kick, 0.08);
        _puffMats.set(drum, puffMat);
    }
    _headMat ??= candyMaterial(HEAD_COLOR, 0.2);
    return { puff: _puff, head: _head, tuft: _tuft, puffMat, headMat: _headMat };
}

export interface DrumPuffballParams {
    /** Unchecked here: the sequencer resolves it (`resolveDrumPuffball`). */
    drum?: unknown;
    shift?: unknown;
}

/** A drum puffball whose origin sits on the ground it rests on. */
export function createDrumPuffball(params: DrumPuffballParams = {}): THREE.Group {
    // The colour follows the drum when the record names one. A plant that leaves the drum to its id
    // is tinted by the sequencer the first time it resolves it (`userData.gardenTint`): rolling the
    // id here would put `garden-flora.ts` (and valibot) on the boot path.
    const drum = typeof params.drum === 'string' ? params.drum : 'kick';
    const parts = shared(drum);
    const group = new THREE.Group();

    const puff = new THREE.Group();
    puff.position.y = PUFF_RADIUS * 0.85;
    const body = new THREE.Mesh(parts.puff, parts.puffMat);
    body.scale.set(1, 0.85, 1);
    body.userData.preventMaterialDispose = true;
    const head = new THREE.Mesh(parts.head, parts.headMat);
    head.position.y = PUFF_RADIUS * 0.78;
    head.userData.preventMaterialDispose = true;
    puff.add(body, head);
    const furry: THREE.Mesh[] = [body];
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const tuft = new THREE.Mesh(parts.tuft, parts.puffMat);
        tuft.position.set(
            Math.cos(a) * PUFF_RADIUS * 0.8,
            PUFF_RADIUS * 0.1,
            Math.sin(a) * PUFF_RADIUS * 0.8
        );
        tuft.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
        tuft.userData.preventMaterialDispose = true;
        puff.add(tuft);
        furry.push(tuft);
    }
    group.add(puff);

    group.userData.type = DRUM_PUFFBALL_TYPE;
    group.userData.radius = PUFF_RADIUS * 1.2;
    group.userData.isGardenFlora = true;
    group.userData.gardenKind = DRUM_PUFFBALL_TYPE;
    group.userData.gardenParams = { drum: params.drum, shift: params.shift };
    /** What the sequencer squashes when this plant is heard. */
    group.userData.gardenPulse = puff;
    /** Recolour the puff for `drum` (shared materials; the sequencer calls it once). */
    group.userData.gardenTint = (tintDrum: string) => {
        const mat = shared(tintDrum).puffMat;
        for (const mesh of furry) mesh.material = mat;
    };

    gardenFloraSpawned();
    return group;
}
