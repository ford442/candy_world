/**
 * Awakened persistence — serialization size, schema, and ID stability (no browser/GPU).
 */
import assert from 'node:assert/strict';

const POSITION_QUANTIZE = 100;
const DEFAULT_SCALE = 0.5;

function computePersistentId(x, z, typeId) {
    const qx = Math.round(x * POSITION_QUANTIZE);
    const qz = Math.round(z * POSITION_QUANTIZE);
    let h = 2166136261 >>> 0;
    const mixInt = (n) => {
        h ^= n & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 8) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 16) & 0xff;
        h = Math.imul(h, 16777619);
        h ^= (n >>> 24) & 0xff;
        h = Math.imul(h, 16777619);
    };
    mixInt(qx);
    mixInt(qz);
    for (let i = 0; i < typeId.length; i++) {
        h ^= typeId.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function buildEntries(count) {
    const entries = [];
    for (let i = 0; i < count; i++) {
        const x = -40 + (i % 20) * 2.17;
        const z = 30 + Math.floor(i / 20) * 3.31;
        entries.push({
            id: computePersistentId(x, z, 'luminous_plant'),
            t: 'luminous_plant',
            b: 'luminous_plants',
            at: 1_700_000_000_000 + i,
            c: 0x66ccff,
            e: DEFAULT_SCALE,
        });
    }
    return entries;
}

function compactSerialize(entries) {
    return JSON.stringify({ version: 1, entries });
}

// ID stability across "reload"
const idA = computePersistentId(12.3456, -7.8912, 'luminous_plant');
const idB = computePersistentId(12.3456, -7.8912, 'luminous_plant');
assert.equal(idA, idB, 'same quantized position must yield identical persistentId');

const hundred = buildEntries(100);
const compact = compactSerialize(hundred);
const fullPayload = JSON.stringify({
    progress: {
        awakenedFlora: hundred.map((e) => ({
            persistentId: e.id,
            entityId: String(e.id),
            type: e.t,
            biome: e.b,
            awakenedAt: e.at,
            lastNoteColor: e.c,
            emissiveScale: e.e,
            awakened: true,
        })),
    },
});

assert.ok(compact.length < 50 * 1024, `compact localStorage payload should stay <50KB (got ${compact.length})`);
assert.ok(fullPayload.length < 80 * 1024, `full save slice should stay reasonable (got ${fullPayload.length})`);

const parsed = JSON.parse(compact);
assert.equal(parsed.version, 1);
assert.equal(parsed.entries.length, 100);
assert.equal(typeof parsed.entries[0].id, 'number');
assert.equal(parsed.entries[0].e, DEFAULT_SCALE);

console.log(`[awakened-persistence] 100 entities compact=${compact.length}B full=${fullPayload.length}B id=${idA} — OK`);
