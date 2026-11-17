/**
 * Grove composer round trip (#1976 slice C acceptance): place a music stone, compose a pattern,
 * save the WorldDocument, take every edit back out, load the document again and replay it; the
 * stone must play the same pattern. Composes are undo steps, replay idempotently, and carry
 * through the `.candyworld` codec.
 *
 * Real registration (`processMapEntity` via `restoreEntity`) and teardown (`despawnEntity`), in
 * plain Node with the asset stubs, as tests/world-document-replay.test.ts.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/grove-composer-replay.test.ts
 */

import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { EditHistory } from '../src/systems/authoring/edit-history.ts';
import {
    ComposeCommand,
    PlaceCommand,
    deserializeWorldCommand,
} from '../src/systems/authoring/world-commands.ts';
import { viewOfStone } from '../src/systems/composer/composer-playback.ts';
import {
    CURRENT_SNAPSHOT_VERSION,
    snapshotEntity,
    type EntitySnapshot,
} from '../src/systems/entity-snapshot/entity-snapshot-core.ts';
import { decodeCandyWorld, encodeCandyWorld } from '../src/world/document/codec.ts';
import {
    MUSIC_STONE_TYPE,
    defaultGrovePattern,
    grovePatternSeed,
    sameGrovePattern,
    withGroveCell,
    withGroveCue,
    withStonePattern,
    type GrovePattern,
} from '../src/world/document/grove-pattern.ts';
import { createEmptyDocument, emptyProgress, validateWorldDocument } from '../src/world/document/schema.ts';
import { WorldDocumentSession } from '../src/world/document/session.ts';
import { MemoryDocumentStore } from '../src/world/document/store.ts';
import { animatedFoliage, entities } from '../src/world/state.ts';

let failures = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

const STONE_ID = 'grove-stone-1';

function stoneSnapshot(): EntitySnapshot {
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id: STONE_ID,
        entity: {
            type: MUSIC_STONE_TYPE,
            position: [6, 0.5, -9],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'absolute',
            params: {},
        },
    };
}

function live(): THREE.Object3D[] {
    return entities.byKey(STONE_ID).filter((o) => o.userData.isMusicStone === true);
}

/** The pattern the live stone plays, as the playback system resolves it. */
function playing(): GrovePattern | null {
    const objs = live();
    assert.ok(objs.length <= 1, `one live stone, not ${objs.length}`);
    const v = objs[0] ? viewOfStone(objs[0]) : null;
    return v?.pattern ?? null;
}

/** Compose on the live stone the way the editor's Save does. */
function composeOnLive(pattern: GrovePattern): ComposeCommand {
    const obj = live()[0];
    const from = snapshotEntity(obj, { id: STONE_ID, includeLegacyHash: false })!;
    return new ComposeCommand(from, withStonePattern(from, pattern));
}

const authored = withGroveCue(
    withGroveCell(withGroveCell(defaultGrovePattern(77), 5, 3, 6), 2, 9, 11),
    2,
    'grove.geyser'
);
const second = withGroveCell(authored, 0, 1, 0);

const store = new MemoryDocumentStore();
const baseLive = animatedFoliage.length;

await test('a placed stone is live, interactive, and plays its seeded default', () => {
    const history = new EditHistory();
    assert.equal(history.execute(new PlaceCommand(stoneSnapshot())), true);
    const objs = live();
    assert.equal(objs.length, 1);
    assert.equal(typeof objs[0].userData.onInteract, 'function');
    assert.match(String(objs[0].userData.interactionText), /Music Stone/);
    assert.ok(animatedFoliage.includes(objs[0] as never), 'interaction scans animatedFoliage');
    assert.ok(sameGrovePattern(playing()!, defaultGrovePattern(grovePatternSeed(STONE_ID))));
    assert.equal(history.undo(), true);
    assert.equal(live().length, 0);
    assert.equal(animatedFoliage.length, baseLive, 'nothing left behind');
});

let saved: Uint8Array | null = null;

await test('compose, undo, redo, compose again: the live stone follows every step', async () => {
    const history = new EditHistory();
    const session = new WorldDocumentSession(
        createEmptyDocument({ seed: 4242, mapVersion: '1.0', id: 'grove-doc', now: 1 }),
        { history, store, readProgress: emptyProgress, readPlayer: () => ({ position: [0, 2, 0], yaw: 0 }) }
    );
    assert.equal(history.execute(new PlaceCommand(stoneSnapshot())), true);
    assert.equal(history.execute(composeOnLive(authored)), true, 'first compose');
    assert.ok(sameGrovePattern(playing()!, authored));

    assert.equal(history.undo(), true);
    assert.ok(
        sameGrovePattern(playing()!, defaultGrovePattern(grovePatternSeed(STONE_ID))),
        'undo puts the default back'
    );
    assert.equal(history.redo(), true);
    assert.ok(sameGrovePattern(playing()!, authored), 'redo brings the pattern back');

    assert.equal(history.execute(composeOnLive(second)), true, 'second compose');
    assert.ok(sameGrovePattern(playing()!, second));
    assert.equal(live().length, 1, 'a compose re-places the stone, never duplicates it');

    const commands = session.commands();
    assert.deepEqual(
        commands.map((c) => c.type),
        ['place', 'compose', 'compose']
    );
    const doc = await session.save(true);
    assert.equal(validateWorldDocument(doc).ok, true);
    saved = await encodeCandyWorld(doc);

    // Back to the generated base world.
    session.revertAll();
    assert.equal(live().length, 0, 'revertAll removes the stone');
    assert.equal(animatedFoliage.length, baseLive);
    session.dispose();
});

await test('reload: the document replays to the same pattern, twice over', async () => {
    const result = await decodeCandyWorld(saved!);
    assert.ok(result.ok, result.ok ? '' : result.error.message);
    const decoded = result.doc;
    const history = new EditHistory();
    const session = new WorldDocumentSession(decoded, {
        history,
        store,
        readProgress: emptyProgress,
    });
    const r = session.replay();
    assert.deepEqual(r, { applied: 3, failed: 0 });
    assert.ok(sameGrovePattern(playing()!, second), 'the reloaded stone plays the saved pattern');

    // Replaying the log again over a live world is idempotent: same stone, same pattern.
    for (const data of decoded.commands) deserializeWorldCommand(data).apply();
    assert.equal(live().length, 1);
    assert.ok(sameGrovePattern(playing()!, second));
    session.revertAll();
    assert.equal(live().length, 0);
    session.dispose();
});

await test('a compose that breaks the rules is never built, so never becomes an undo step', () => {
    const history = new EditHistory();
    assert.equal(history.execute(new PlaceCommand(stoneSnapshot())), true);
    const obj = live()[0];
    const from = snapshotEntity(obj, { id: STONE_ID, includeLegacyHash: false })!;
    const moved = withStonePattern(
        { ...from, entity: { ...from.entity, position: [40, 0.5, 40] } },
        authored
    );
    assert.throws(() => new ComposeCommand(from, moved), /only the pattern/);
    const broken = {
        ...from,
        entity: { ...from.entity, params: { ...from.entity.params, pattern: { v: 1 } } },
    };
    assert.throws(() => new ComposeCommand(from, broken), /invalid grove pattern/);
    assert.equal(history.undoCount, 1, 'only the place');
    assert.equal(history.undo(), true);
    assert.equal(live().length, 0);
});

if (failures > 0) {
    console.error(`\n${failures} grove composer replay test(s) failed`);
    process.exit(1);
}
console.log('\nAll grove composer replay tests passed');
process.exit(0);
