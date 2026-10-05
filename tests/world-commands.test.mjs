/**
 * PlaceCommand through the real registration + teardown paths: place,
 * undo and redo must leave batchers and state.ts registries balanced.
 *
 * Runs in plain Node (tsx + the asset stubs in tests/support).
 *
 * Run: npx tsx --import ./tests/support/register-hooks.mjs tests/world-commands.test.mjs
 */

import assert from 'node:assert/strict';
import { EditHistory } from '../src/systems/edit-history.ts';
import { CURRENT_SNAPSHOT_VERSION } from '../src/systems/entity-snapshot-core.ts';
import { PlaceCommand } from '../src/systems/world-commands.ts';
import { kickDrumGeyserBatcher } from '../src/foliage/kick-drum-geyser-batcher.ts';
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

function quiet(fn) {
    const original = console.warn;
    console.warn = () => {};
    try {
        return fn();
    } finally {
        console.warn = original;
    }
}

function snap(id, type, position, extra = {}) {
    return {
        schemaVersion: CURRENT_SNAPSHOT_VERSION,
        id,
        entity: {
            type,
            position,
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'absolute',
            params: {},
            ...extra,
        },
    };
}

function findLive(id) {
    return animatedFoliage.filter((o) => o?.userData?.mapEntityId === id);
}

test('place → undo → redo keeps the mushroom batcher balanced', () => {
    const h = new EditHistory();
    const events = [];
    const cmd = new PlaceCommand(
        snap('wc-mushroom', 'mushroom', [5, 0.5, 5], { variant: 'regular' }),
        {
            onApplied: (objs, s) => events.push(`applied:${s.id}:${objs.length}`),
            onReverted: (s) => events.push(`reverted:${s.id}`),
        }
    );
    const before = mushroomBatcher.count;
    const liveBefore = animatedFoliage.length;

    assert.equal(h.execute(cmd), true);
    assert.equal(findLive('wc-mushroom').length, 1);
    assert.equal(mushroomBatcher.count, before + 1);

    assert.equal(h.undo(), true);
    assert.equal(findLive('wc-mushroom').length, 0, 'undo removes it from animatedFoliage');
    assert.equal(animatedFoliage.length, liveBefore);

    assert.equal(h.redo(), true);
    assert.equal(findLive('wc-mushroom').length, 1, 'redo restores it');
    assert.deepEqual(events, [
        'applied:wc-mushroom:1',
        'reverted:wc-mushroom',
        'applied:wc-mushroom:1',
    ]);
});

test('undo frees a kick drum geyser instance slot', () => {
    // #1834's revert only knew six batchers; a geyser's instance stayed drawn.
    const h = new EditHistory();
    const slotsBefore = kickDrumGeyserBatcher.baseMesh.count;
    assert.equal(
        h.execute(new PlaceCommand(snap('wc-geyser', 'kick_drum_geyser', [-6, 0, 9]))),
        true
    );
    assert.equal(findLive('wc-geyser').length, 1, 'geyser placed');
    assert.equal(
        kickDrumGeyserBatcher.baseMesh.count,
        slotsBefore + 1,
        'fixture must batch the geyser'
    );

    assert.equal(h.undo(), true);
    assert.equal(findLive('wc-geyser').length, 0);
    assert.equal(kickDrumGeyserBatcher.baseMesh.count, slotsBefore, 'instance slot freed');
});

test('repeated place/undo cycles do not leak instances', () => {
    const h = new EditHistory();
    const before = mushroomBatcher.count;
    for (let i = 0; i < 5; i++) {
        h.execute(
            new PlaceCommand(
                snap(`wc-cycle-${i}`, 'mushroom', [i, 0.5, -i], { variant: 'regular' })
            )
        );
    }
    assert.equal(mushroomBatcher.count, before + 5);
    while (h.undo());
    assert.equal(mushroomBatcher.count, before);
});

test('an unknown type fails to apply and is not recorded', () => {
    const h = new EditHistory();
    const ok = quiet(() =>
        h.execute(new PlaceCommand(snap('wc-bogus', 'not_a_real_species', [0, 0, 0])))
    );
    assert.equal(ok, false);
    assert.equal(h.undoCount, 0);
});

test('an entity with no safe removal path refuses to undo and stays live', () => {
    const h = new EditHistory();
    const reverted = [];
    h.execute(
        new PlaceCommand(snap('wc-pinned', 'mushroom', [2, 0.5, -8], { variant: 'regular' }), {
            onReverted: (s) => reverted.push(s.id),
        })
    );
    const [obj] = findLive('wc-pinned');
    obj.userData.__evictionClass = 'never';

    assert.equal(
        quiet(() => h.undo()),
        false
    );
    assert.equal(findLive('wc-pinned').length, 1, 'object left intact');
    assert.deepEqual(reverted, [], 'persistence hook not told it was removed');
    assert.equal(h.undoCount, 0, 'the unrevertible step is dropped');
});

test('undo when the object is already gone still runs the revert hook', () => {
    // e.g. removed by another path; the persisted record must not outlive it.
    const h = new EditHistory();
    const reverted = [];
    h.execute(
        new PlaceCommand(snap('wc-gone', 'mushroom', [9, 0.5, 1], { variant: 'regular' }), {
            onReverted: (s) => reverted.push(s.id),
        })
    );
    const [obj] = findLive('wc-gone');
    animatedFoliage.splice(animatedFoliage.indexOf(obj), 1);
    mushroomBatcher.removeInstance(obj);

    assert.equal(h.undo(), true);
    assert.deepEqual(reverted, ['wc-gone']);
});

test('serialize carries the snapshot', () => {
    const s = snap('wc-ser', 'mushroom', [1, 2, 3]);
    assert.deepEqual(new PlaceCommand(s).serialize(), { type: 'place', snapshot: s });
});

if (failures > 0) {
    console.error(`\n${failures} world-commands test(s) failed`);
    process.exit(1);
}
console.log('\nAll world-commands tests passed');
