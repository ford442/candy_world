/**
 * Grove flora (composer-flora.ts): plants near a music stone fill its empty rows, derived at
 * playback time. Node only.
 */
import assert from 'node:assert/strict';
import {
    applyGroveFlora,
    countFloraNear,
    FLORA_RADIUS,
    floraKey,
    floraRow,
    floraSpecies,
    GROVE_FLORA,
    MAX_PLANTS,
    NOTES_PER_PLANT,
} from '../src/systems/composer/composer-flora.ts';
import { COMPOSER_VOICES } from '../src/systems/composer/composer-voices.ts';
import {
    defaultGrovePattern,
    GROVE_REST,
    grovePatternSeed,
    parseGrovePattern,
} from '../src/world/document/grove-pattern.ts';

let passed = 0;
function test(name: string, fn: () => void): void {
    fn();
    passed++;
    console.log(`  ok ${name}`);
}
const notesIn = (row: number[]) => row.filter((n) => n !== GROVE_REST).length;

const fern = floraSpecies('arpeggio_fern')!;
const dandelion = floraSpecies('cymbal_dandelion')!;
const base = defaultGrovePattern(grovePatternSeed('stone-1'));

test('only harvestable, batched species count', () => {
    assert.deepEqual(
        GROVE_FLORA.map((s) => s.type),
        ['arpeggio_fern', 'cymbal_dandelion']
    );
    assert.equal(floraSpecies('tremolo_tulip'), null);
    assert.equal(floraSpecies(undefined), null);
    for (const s of GROVE_FLORA) assert.ok(COMPOSER_VOICES[s.channel]);
});

test('the default pattern leaves the flora rows empty', () => {
    for (const s of GROVE_FLORA) assert.equal(notesIn(base.channels[s.channel].notes), 0);
});

test('counting: radius, species and cap', () => {
    const plants = [
        { type: 'arpeggio_fern', x: 1, z: 1 },
        { type: 'arpeggio_fern', x: FLORA_RADIUS + 0.1, z: 0 },
        { type: 'tremolo_tulip', x: 0, z: 0 },
        ...Array.from({ length: 9 }, () => ({ type: 'cymbal_dandelion', x: 0, z: 2 })),
    ];
    const counts = countFloraNear(0, 0, plants);
    assert.equal(counts.get('arpeggio_fern'), 1);
    assert.equal(counts.get('cymbal_dandelion'), MAX_PLANTS);
    assert.equal(counts.has('tremolo_tulip'), false);
    assert.equal(floraKey(counts), `1,${MAX_PLANTS}`);
});

test('no flora: the same pattern object', () => {
    assert.equal(applyGroveFlora(base, new Map()), base);
});

test('rows grow with plants and keep earlier notes', () => {
    let prev = floraRow(fern, base.seed, 0);
    assert.equal(notesIn(prev), 0);
    for (let c = 1; c <= MAX_PLANTS + 2; c++) {
        const row = floraRow(fern, base.seed, c);
        assert.equal(notesIn(row), Math.min(c, MAX_PLANTS) * NOTES_PER_PLANT);
        prev.forEach((n, i) => n !== GROVE_REST && assert.equal(row[i], n));
        prev = row;
    }
});

test('deterministic per stone, different between stones', () => {
    assert.deepEqual(floraRow(dandelion, 7, 3), floraRow(dandelion, 7, 3));
    const a = floraRow(dandelion, grovePatternSeed('a'), 2).join();
    const b = floraRow(dandelion, grovePatternSeed('b'), 2).join();
    const c = floraRow(dandelion, grovePatternSeed('c'), 2).join();
    assert.ok(a !== b || b !== c);
});

test('fills empty rows into a still-valid pattern, without mutating the input', () => {
    const before = JSON.stringify(base);
    const out = applyGroveFlora(
        base,
        new Map([
            ['arpeggio_fern', 2],
            ['cymbal_dandelion', 1],
        ])
    );
    assert.equal(JSON.stringify(base), before);
    assert.ok(parseGrovePattern(out));
    assert.equal(notesIn(out.channels[fern.channel].notes), 4);
    assert.equal(notesIn(out.channels[dandelion.channel].notes), 2);
    for (let ch = 0; ch < 8; ch++) {
        if (ch !== fern.channel && ch !== dandelion.channel) {
            assert.equal(out.channels[ch], base.channels[ch]);
        }
    }
});

test('an authored row always wins', () => {
    const authored = structuredClone(base);
    authored.channels[fern.channel].notes[3] = 5;
    authored.channels[fern.channel].cue = 'market.lantern_fill';
    const out = applyGroveFlora(authored, new Map([['arpeggio_fern', 4]]));
    assert.equal(out, authored);
});

test('a cue bound to an empty row is kept when flora fills it', () => {
    const p = structuredClone(base);
    p.channels[dandelion.channel].cue = 'market.lantern_fill';
    const out = applyGroveFlora(p, new Map([['cymbal_dandelion', 1]]));
    assert.equal(out.channels[dandelion.channel].cue, 'market.lantern_fill');
    assert.ok(parseGrovePattern(out));
});

console.log(`grove-flora: ${passed} passed`);
