/**
 * One-shot legacy importer (#1974): fixtures from each of the six
 * pre-WorldDocument stores become one valid v1 document.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/world-document-legacy.test.ts
 */

import assert from 'node:assert/strict';
import { CURRENT_SNAPSHOT_VERSION } from '../src/systems/entity-snapshot-core.ts';
import {
    buildDocumentFromLegacy,
    type LegacySources,
} from '../src/world/document/legacy-import.ts';
import { validateWorldDocument } from '../src/world/document/schema.ts';

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

const OPTS = { seed: 12345, mapVersion: '1.0', now: 1_000, id: 'imported' };

/** Exactly what each store writes today. */
const FIXTURES: Required<LegacySources> = {
    // 1. save-system: IndexedDB CandyWorldSaveDB/saves → the newest SaveData.
    saveData: {
        metadata: {
            version: '1.0.0',
            timestamp: 500,
            playtime: 10,
            slotId: 'auto-0',
            slotName: 'Auto Save 1',
            isAutoSave: true,
        },
        player: {
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 0.5, z: 0 },
            unlockedAbilities: [],
        },
        world: {
            entitySnapshots: [
                {
                    schemaVersion: 2,
                    id: 'save-placed',
                    entity: { type: 'mushroom', position: [4, 0, 4], variant: 'regular' },
                    tags: [],
                },
            ],
        },
        progress: {
            discoveredEntities: ['starflower'],
            unlocks: ['chord_strike'],
            inventory: { harmony_orb: 1 },
            awakenedFlora: [
                { persistentId: 7, entityId: '7', type: 'luminous_plant', awakenedAt: 400 },
            ],
        },
    },
    // 2. discovery-persistence: localStorage candy_world_discovery_v2 (+ the v1 array key).
    discovery: JSON.stringify({
        version: 1,
        lastModified: 900,
        discoveries: [
            { id: 'tremolo_tulip', timestamp: 800 },
            { id: 'night_market_stamp:stall_a', timestamp: 850 },
            { bogus: true },
        ],
    }),
    discoveryV1: JSON.stringify(['vibrato_violet', 'starflower']),
    // 3. unlocks: localStorage candy_world_unlocks.
    unlocks: JSON.stringify({
        inventory: { fern_core: 3, harmony_orb: 4 },
        unlocks: ['arpeggio_shield'],
    }),
    // 4. world/part-ii-unlock: localStorage candy.part2.sugar_caves_unlocked.
    partII: '1',
    // 5. awakened-persistence: localStorage candy_world_awakened_v1 (compact payload).
    awakened: JSON.stringify({
        version: 1,
        entries: [
            { id: 7, t: 'luminous_plant', at: 300, e: 1.35 },
            { id: 11, t: 'gem_canopy_tree', b: 'gem_canopy', at: 600, c: 16711935, e: 1.5 },
        ],
    }),
    // 6. entity-snapshot-store: IndexedDB CandyWorldEntitySnapshots/snapshots (dev sidecar, v1 + v2).
    devSnapshots: [
        {
            schemaVersion: 1,
            id: 'dev-v1',
            entity: { type: 'kick_drum_geyser', position: [9, 0, 9] },
            positionHash: '123',
        },
        {
            schemaVersion: CURRENT_SNAPSHOT_VERSION,
            id: 'save-placed',
            entity: { type: 'mushroom', position: [4, 0, 4] },
        },
        { schemaVersion: 99, id: 'future', entity: { type: 'mushroom', position: [0, 0, 0] } },
    ],
};

test('all six stores merge into one valid v1 document', () => {
    const { doc, report } = buildDocumentFromLegacy(FIXTURES, OPTS);
    assert.ok(validateWorldDocument(doc).ok);
    assert.equal(doc.id, 'imported');
    assert.equal(doc.seed, 12345);
    assert.equal(report.empty, false);

    // save slot
    assert.deepEqual(doc.player, { position: [1, 2, 3], yaw: 0.5 });
    // save + v2 + v1 discoveries, stamps split out
    assert.deepEqual(doc.progress.discoveries.sort(), [
        'starflower',
        'tremolo_tulip',
        'vibrato_violet',
    ]);
    assert.deepEqual(doc.progress.stamps, ['night_market_stamp:stall_a']);
    // unlocks: union; inventory: larger count wins
    assert.deepEqual(doc.progress.unlocks.sort(), ['arpeggio_shield', 'chord_strike']);
    assert.deepEqual(doc.progress.inventory, { harmony_orb: 4, fern_core: 3 });
    // Part II door
    assert.equal(doc.progress.partII.sugarCavesUnlocked, true);
    // awakened: union by persistent id, earliest awakenedAt kept
    const awake = new Map(doc.progress.awakened.map((a) => [a.persistentId, a]));
    assert.equal(awake.size, 2);
    assert.equal(awake.get(7)?.awakenedAt, 300);
    assert.equal(awake.get(11)?.biome, 'gem_canopy');
    // dev sidecar: v1 migrated, duplicate id kept once, future version skipped
    assert.deepEqual(
        doc.commands.map((c) => (c.type === 'place' ? c.snapshot.id : c.type)),
        ['save-placed', 'dev-v1']
    );

    assert.deepEqual(report.imported, {
        saveSlot: 1,
        discovery: 4,
        unlocks: 3,
        partII: 1,
        awakened: 2,
        entitySnapshots: 1,
    });
    assert.equal(report.skipped.discovery, 1, 'the record without an id');
    assert.equal(report.skipped.entitySnapshots, 1, 'the future-version snapshot');
});

test('each store imports on its own', () => {
    const only = (key: keyof LegacySources) =>
        buildDocumentFromLegacy({ [key]: FIXTURES[key] }, OPTS);
    assert.equal(only('saveData').doc.commands.length, 1);
    assert.deepEqual(only('discovery').doc.progress.stamps, ['night_market_stamp:stall_a']);
    assert.deepEqual(only('discoveryV1').doc.progress.discoveries, [
        'vibrato_violet',
        'starflower',
    ]);
    assert.deepEqual(only('unlocks').doc.progress.unlocks, ['arpeggio_shield']);
    assert.equal(only('partII').doc.progress.partII.sugarCavesUnlocked, true);
    assert.equal(only('awakened').doc.progress.awakened.length, 2);
    assert.equal(only('devSnapshots').doc.commands.length, 2);
});

test('nothing stored gives an empty report, and garbage is skipped, not thrown', () => {
    assert.equal(buildDocumentFromLegacy({}, OPTS).report.empty, true);
    const { doc, report } = buildDocumentFromLegacy(
        {
            saveData: { not: 'a save' },
            discovery: '{nope',
            unlocks: '[]',
            partII: 'yes',
            awakened: JSON.stringify({ version: 2, entries: [] }),
            devSnapshots: [null, 'x', { id: 'flat', type: 'mushroom' }],
        },
        OPTS
    );
    assert.ok(validateWorldDocument(doc).ok);
    assert.equal(report.empty, true);
    assert.deepEqual(report.skipped, {
        saveSlot: 1,
        discovery: 1,
        unlocks: 1,
        partII: 1,
        awakened: 1,
        entitySnapshots: 3,
    });
});

if (failures > 0) {
    console.error(`\n${failures} legacy importer test(s) failed`);
    process.exit(1);
}
console.log('\nAll legacy importer tests passed');
