/**
 * Save-file round trip for entity snapshots (#1801):
 *   applyEntitySnapshots → serializeEntitySnapshots → equivalent records.
 *
 * Runs in plain Node (tsx + the asset stubs in tests/support). Entities are
 * restored through the REAL `processMapEntity` registration path, so batched
 * species land in their batcher with a live instance slot.
 *
 * Run: npx tsx --import ./tests/support/register-hooks.mjs tests/entity-snapshot-apply.test.mjs
 */

import assert from 'node:assert/strict';
import {
    CURRENT_SNAPSHOT_VERSION,
    canonicalizeEntity,
} from '../src/systems/entity-snapshot-core.ts';
import {
    applyEntitySnapshots,
    serializeEntitySnapshots,
} from '../src/systems/save-system/entity-snapshot.ts';
import { processMapEntity } from '../src/world/generation-entities.ts';
import { mushroomBatcher } from '../src/foliage/mushroom-batcher/index.ts';
import { animatedFoliage } from '../src/world/state.ts';

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err && err.stack ? err.stack : err}`);
    }
}

/** Swallow and count console.warn for the duration of fn. */
function captureWarnings(fn) {
    const original = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        return { value: fn(), warnings };
    } finally {
        console.warn = original;
    }
}

function seed(id, entity) {
    return { schemaVersion: CURRENT_SNAPSHOT_VERSION, id, entity, tags: [] };
}

function findLive(id) {
    return animatedFoliage.filter((o) => o?.userData?.mapEntityId === id);
}

const SAVED = [
    seed('snap-apply-starflower', {
        type: 'starflower',
        position: [3, 0.25, 4],
        rotation: { quat: [0, 0.382683, 0, 0.92388] },
        scale: 1.2,
        placement: 'absolute',
        params: {},
    }),
    seed('snap-apply-mushroom', {
        type: 'mushroom',
        position: [-12, 0.5, 7],
        rotation: { quat: [0, 0, 0, 1] },
        scale: 1.5,
        variant: 'regular',
        placement: 'absolute',
        params: {},
    }),
    seed('snap-apply-violet', {
        type: 'vibrato_violet',
        position: [8, 0.1, -3],
        rotation: { quat: [0, 0, 0, 1] },
        scale: 1,
        note: 'E',
        noteIndex: 4,
        placement: 'absolute',
        params: {},
    }),
];

// ---------------------------------------------------------------------------

test('generated (non-authored) map entities are not written to a save', () => {
    const before = animatedFoliage.length;
    processMapEntity({ id: 'entity-generated-1', type: 'starflower', position: [30, 0, 30] }, null);
    assert.ok(animatedFoliage.length > before, 'fixture must register a generated entity');

    const saved = serializeEntitySnapshots();
    assert.ok(
        !saved.some((s) => s.id === 'entity-generated-1'),
        'generated content is rebuilt from map.json and must not be saved'
    );
});

test('apply restores every supported record through the registration path', () => {
    const mushroomsBefore = mushroomBatcher.count;
    const result = applyEntitySnapshots(SAVED);

    assert.deepEqual(result, { restored: SAVED.length, alreadyLive: 0, skipped: 0 });
    for (const snap of SAVED) {
        assert.ok(findLive(snap.id).length > 0, `${snap.entity.type} was not restored`);
    }
    assert.equal(mushroomBatcher.count, mushroomsBefore + 1, 'mushroom landed in its batcher');
});

test('export → apply → export produces equivalent records', () => {
    const first = serializeEntitySnapshots().filter((s) => SAVED.some((o) => o.id === s.id));
    assert.equal(first.length, SAVED.length, 'each restored entity serializes exactly once');

    // Authored fields survive restore (the batcher bakes scale — see snapshotAuthored).
    for (const original of SAVED) {
        const record = first.find((s) => s.id === original.id);
        assert.equal(record.schemaVersion, CURRENT_SNAPSHOT_VERSION);
        for (const key of [
            'type',
            'position',
            'rotation',
            'scale',
            'variant',
            'note',
            'noteIndex',
        ]) {
            assert.deepEqual(
                record.entity[key],
                canonicalizeEntity(original.entity)[key],
                `${original.entity.type}.${key} drifted`
            );
        }
    }

    // Simulate a reload: apply the export under fresh ids, then export again.
    const reloaded = first.map((s) => ({ ...s, id: `${s.id}-reloaded` }));
    assert.equal(applyEntitySnapshots(reloaded).restored, reloaded.length);
    const second = serializeEntitySnapshots();
    for (const record of first) {
        const again = second.find((s) => s.id === `${record.id}-reloaded`);
        assert.ok(again, `${record.id} did not survive the second cycle`);
        // `params.sourceId` mirrors the id, which this simulated reload renamed.
        const { id: _a, ...a } = canonicalizeEntity(again.entity);
        const { id: _b, ...b } = canonicalizeEntity(record.entity);
        if (a.params) a.params = { ...a.params, sourceId: record.id };
        assert.deepEqual(a, b, `${record.entity.type} is not a fixed point`);
        assert.deepEqual(again.userData, record.userData);
    }
});

test('applying the same save twice is idempotent (no duplicates)', () => {
    const before = animatedFoliage.length;
    const mushroomsBefore = mushroomBatcher.count;
    const result = applyEntitySnapshots(SAVED);

    assert.deepEqual(result, { restored: 0, alreadyLive: SAVED.length, skipped: 0 });
    assert.equal(animatedFoliage.length, before);
    assert.equal(mushroomBatcher.count, mushroomsBefore);
});

test('a restored batched entity has a working removeInstance slot', () => {
    const [mirror] = findLive('snap-apply-mushroom');
    assert.equal(mirror.userData.isBatched, true, 'fixture must exercise the batched path');

    const countBefore = mushroomBatcher.count;
    mushroomBatcher.removeInstance(mirror);
    assert.equal(mushroomBatcher.count, countBefore - 1, 'instance slot was released');
});

test('unknown / malformed / legacy / future records are skipped with ONE warning', () => {
    const bad = [
        // Pre-v2 flat record written by older builds.
        { id: 'legacy-1', type: 'mushroom', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
        seed('snap-unknown-type', { type: 'definitely_not_a_species', position: [1, 0, 1] }),
        {
            schemaVersion: CURRENT_SNAPSHOT_VERSION + 1,
            id: 'future',
            entity: { type: 'flower', position: [0, 0, 0] },
        },
        null,
        'garbage',
        seed('snap-apply-ok', { type: 'starflower', position: [5, 0, 5], placement: 'absolute' }),
    ];

    const { value: result, warnings } = captureWarnings(() => applyEntitySnapshots(bad));

    assert.equal(result.restored, 1, 'the one valid record still restores');
    assert.equal(result.skipped, bad.length - 1);
    const summaries = warnings.filter((w) => w.startsWith('[SaveSystem]'));
    assert.equal(summaries.length, 1, `expected one summary warning, got: ${warnings.join(' | ')}`);
});

test('empty / missing input is a no-op', () => {
    const zero = { restored: 0, alreadyLive: 0, skipped: 0 };
    assert.deepEqual(applyEntitySnapshots([]), zero);
    assert.deepEqual(applyEntitySnapshots(undefined), zero);
});

if (failures > 0) {
    console.error(`\n${failures} entity-snapshot-apply test(s) failed`);
    process.exit(1);
}
console.log('\nAll entity-snapshot-apply tests passed 🎉');
