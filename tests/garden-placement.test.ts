/**
 * Music Garden slice B, iteration 3: build-mode placement end to end, in plain Node with the real
 * pieces. A palette entry becomes a placement snapshot (`buildPlacementSnapshot`, as build mode
 * does), a `PlaceCommand` through `editHistory` spawns the real plant, the garden's own world scan
 * (`livePlants`) finds it, the sequencer turns it into notes in the biome's key, and its pulse
 * moves the real object when the note is heard. Undo takes it all back out.
 *
 * What this cannot show is a browser: pointer lock, the ghost, the strip's buttons and the audio
 * hardware. Those are build mode's own (tests/build-mode.test.ts) and the live page's.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/garden-placement.test.ts
 */

import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { livePlants } from '../src/audio/garden/index.ts';
import { GardenPulses } from '../src/audio/garden/pulses.ts';
import { GardenSequencer } from '../src/audio/garden/sequencer.ts';
import { getBiomeProfile } from '../src/audio/generative/biome-profiles.ts';
import { scaleNote, noteNameToMidi } from '../src/audio/generative/scales.ts';
import { EditHistory } from '../src/systems/authoring/edit-history.ts';
import { buildPalette } from '../src/systems/authoring/palette.ts';
import {
    buildPlacementSnapshot,
    createPlacementState,
} from '../src/systems/authoring/placement-core.ts';
import { PlaceCommand } from '../src/systems/authoring/world-commands.ts';
import {
    CHIME_TULIP_TYPE,
    DRUM_PUFFBALL_TYPE,
    defaultChimeTulip,
    defaultDrumPuffball,
} from '../src/world/document/garden-flora.ts';
import {
    getRegisteredTypes,
    getTypeMeta,
    registerBuiltinWorldObjectTypes,
} from '../src/world/foliage-registry.ts';
import { animatedFoliage } from '../src/world/state.ts';

let failures = 0;
function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

registerBuiltinWorldObjectTypes();
const palette = buildPalette(getRegisteredTypes(), (t) => getTypeMeta(t)?.supportsMusic === true);
const baseLive = animatedFoliage.length;
const history = new EditHistory();

function place(type: string, id: string, x: number, z: number): void {
    const entry = palette.find((e) => e.type === type);
    assert.ok(entry, `${type} is in the build palette`);
    const s = createPlacementState();
    Object.assign(s, { hit: true, x, y: 0.5, z, onPlatform: false, status: 'ok' });
    const snap = buildPlacementSnapshot(id, s, {
        type,
        yaw: 0.4,
        scale: 1,
        extra: entry.defaults,
    });
    assert.equal(history.execute(new PlaceCommand(snap)), true, `${type} placed`);
}

const HERE = { x: 0, z: 0, rightX: 1, rightZ: 0 };

test('the palette offers both, in Music objects, with an icon and a label', () => {
    for (const [type, label] of [
        [CHIME_TULIP_TYPE, 'Chime tulip'],
        [DRUM_PUFFBALL_TYPE, 'Drum puffball'],
    ]) {
        const e = palette.find((p) => p.type === type)!;
        assert.equal(e.category, 'music');
        assert.equal(e.label, label);
        assert.notEqual(e.icon, '🍬', 'a real icon, not the fallback');
        assert.equal(e.paintable, false);
    }
});

test('placed through the palette and the placement core, the plants are live and scanned', () => {
    place(CHIME_TULIP_TYPE, 'e2e-tulip', 5, 2);
    place(DRUM_PUFFBALL_TYPE, 'e2e-puff', -6, 3);
    const seen = [...livePlants()];
    assert.deepEqual(seen.map((p) => p.id).sort(), ['e2e-puff', 'e2e-tulip']);
    const tulip = seen.find((p) => p.id === 'e2e-tulip')!;
    assert.equal(tulip.type, CHIME_TULIP_TYPE);
    assert.ok(Math.abs(tulip.x - 5) < 0.01 && Math.abs(tulip.z - 2) < 0.01);
});

test('the sequencer turns them into notes in the biome key, from their ids', () => {
    const seq = new GardenSequencer();
    const profile = getBiomeProfile('arpeggio_grove');
    seq.setKey(profile);
    seq.setPlants(livePlants(), HERE);
    assert.equal(seq.playing, 2);
    const chime = defaultChimeTulip('e2e-tulip');
    const note = seq.notesAt(chime.step).find((n) => n.plantId === 'e2e-tulip')!;
    assert.equal(note.instrument, 'chime');
    assert.equal(
        note.midi,
        noteNameToMidi(scaleNote(profile.root, profile.scale, chime.degree, 5))
    );
    const drum = defaultDrumPuffball('e2e-puff');
    const hits = [...Array(16).keys()].filter((s) =>
        seq.notesAt(s).some((n) => n.plantId === 'e2e-puff' && n.instrument === drum.drum)
    );
    assert.ok(hits.length >= 2, `the ${drum.drum} plays ${hits.length} times a bar`);
});

test('a heard note moves the real plant and it settles back to rest', () => {
    const pulses = new GardenPulses();
    for (const p of livePlants()) {
        const obj = p.object as THREE.Object3D;
        const target = obj.userData.gardenPulse as THREE.Object3D;
        assert.ok(target, `${p.id} has something to move`);
        assert.deepEqual(target.scale.toArray(), [1, 1, 1]);
        const body = target.children[0] as THREE.Mesh;
        const before = body.material;
        pulses.hit(obj, 1);
        if (p.type === DRUM_PUFFBALL_TYPE) {
            // The factory paints a puffball kick-pink; the first hit recolours it to its rolled drum.
            const rolled = defaultDrumPuffball(p.id).drum;
            assert.equal(body.material !== before, rolled !== 'kick', `tinted for ${rolled}`);
        }
        const moved = target.scale.toArray();
        assert.ok(
            moved.some((v) => Math.abs(v - 1) > 0.1),
            `${p.id} moved: ${moved}`
        );
        if (p.type === DRUM_PUFFBALL_TYPE) assert.ok(target.scale.y < 1, 'a puffball squashes');
        else assert.ok(target.scale.x > 1, 'a tulip swells');
    }
    for (let i = 0; i < 120; i++) pulses.settle(1 / 60);
    for (const p of livePlants()) {
        const target = (p.object as THREE.Object3D).userData.gardenPulse as THREE.Object3D;
        assert.deepEqual(target.scale.toArray(), [1, 1, 1], `${p.id} is back at rest`);
        assert.equal(target.rotation.z, 0);
    }
});

test('a puffball is tinted once: a second hit leaves its material alone', () => {
    const obj = [...livePlants()].find((p) => p.id === 'e2e-puff')!.object as THREE.Object3D;
    assert.equal(obj.userData.gardenTinted, true);
    const body = (obj.userData.gardenPulse as THREE.Object3D).children[0] as THREE.Mesh;
    const material = body.material;
    new GardenPulses().hit(obj, 0.5);
    assert.equal(body.material, material);
});

test('undo takes the plants out of the world and out of the garden', () => {
    assert.equal(history.undo(), true);
    assert.equal(history.undo(), true);
    assert.deepEqual([...livePlants()], []);
    assert.equal(animatedFoliage.length, baseLive, 'nothing left behind');
    const seq = new GardenSequencer();
    seq.setPlants(livePlants(), HERE);
    assert.equal(seq.playing, 0);
    assert.equal(history.redo(), true);
    assert.equal([...livePlants()].length, 1, 'redo brings one back');
});

if (failures > 0) {
    console.error(`\n${failures} garden placement test(s) failed`);
    process.exit(1);
}
console.log('\nAll garden placement tests passed');
process.exit(0);
