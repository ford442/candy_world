/**
 * Grove composer (#1976 slice C), the parts that need no world and no DOM:
 *
 * - the `GrovePattern` model: seeded defaults, edits, validation;
 * - `compose` at every boundary: the WorldDocument schema, the shared-world validator, the
 *   co-editing room's message parser, and the replica's merge (idempotent, order-independent);
 * - authored playback through `GenerativeSequencer` / `GenerativeEngine`: deterministic notes in
 *   the biome's key, step listeners, previews;
 * - `ComposerPlayback`: audition over proximity, hysteresis, cues once per step, key bobs;
 * - the voice table and its unlocks.
 *
 * The real world path (place a stone, compose, undo, save, reload) is
 * tests/grove-composer-replay.test.ts; the editor is tests/grove-composer-ui.test.ts.
 *
 * Run: npx tsx tests/grove-composer.test.ts
 */

import assert from 'node:assert/strict';
import { BIOME_PROFILES } from '../src/audio/generative/biome-profiles.ts';
import { GenerativeEngine } from '../src/audio/generative/generative-engine.ts';
import { scaleNote } from '../src/audio/generative/scales.ts';
import {
    AUTHORED_VELOCITY,
    GenerativeSequencer,
    authoredNote,
} from '../src/audio/generative/sequencer.ts';
import type { GenerativeVoiceSink } from '../src/audio/generative/voice-sink.ts';
import type { EntitySnapshot } from '../src/systems/entity-snapshot/entity-snapshot-types.ts';
import {
    SharedWorldReplica,
    parseCmdMessage,
    type CmdMessage,
} from '../src/systems/net/world-sync-protocol.ts';
import {
    ComposerPlayback,
    HEAR_RADIUS,
    RELEASE_RADIUS,
    type ComposerEngine,
    type StoneView,
} from '../src/systems/composer/composer-playback.ts';
import {
    COMPOSER_VOICES,
    availableVoices,
    isVoiceAvailable,
} from '../src/systems/composer/composer-voices.ts';
import {
    documentStateHash,
    invertCommand,
    netEntityChanges,
} from '../src/world/document/entity-state.ts';
import {
    GROVE_CHANNELS,
    GROVE_REST,
    GROVE_STEPS,
    MUSIC_STONE_TYPE,
    composeIssue,
    defaultGrovePattern,
    emptyGrovePattern,
    grovePatternIssue,
    grovePatternSeed,
    groveNoteCount,
    parseGrovePattern,
    resolveStonePattern,
    sameGrovePattern,
    stonePatternOf,
    withGroveCell,
    withGroveCue,
    withGroveRowCleared,
    withStonePattern,
    type GrovePattern,
} from '../src/world/document/grove-pattern.ts';
import {
    createEmptyDocument,
    validateWorldDocument,
    type DocumentCommand,
} from '../src/world/document/schema.ts';
import { validateSharedWorld } from '../src/world/document/shared-validation.ts';

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`✅ ${name}`);
    } catch (err) {
        failures++;
        console.error(`❌ ${name}\n   ${err instanceof Error ? err.stack : String(err)}`);
    }
}

function stone(id: string, pattern?: unknown, x = 4, z = -6): EntitySnapshot {
    const params: Record<string, unknown> = { provenance: 'authored' };
    if (pattern !== undefined) params.pattern = pattern;
    return {
        schemaVersion: 1,
        id,
        entity: {
            type: MUSIC_STONE_TYPE,
            position: [x, 0.5, z],
            rotation: { quat: [0, 0, 0, 1] },
            scale: 1,
            placement: 'ground',
            params,
        },
    } as EntitySnapshot;
}

function doc(commands: DocumentCommand[]) {
    const d = createEmptyDocument({
        seed: 7,
        mapVersion: '1.0',
        id: '6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
        now: 1,
    });
    d.commands = commands;
    return d;
}

const p1 = withGroveCue(withGroveCell(defaultGrovePattern(11), 2, 5, 9), 0, 'grove.geyser');
const p2 = withGroveCell(p1, 3, 1, 12);

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

await test('the default pattern is seeded: same seed, same notes; other seed, other notes', () => {
    const a = defaultGrovePattern(1234);
    const b = defaultGrovePattern(1234);
    assert.ok(sameGrovePattern(a, b));
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    let differs = false;
    for (let seed = 1; seed < 20 && !differs; seed++) {
        differs = !sameGrovePattern(defaultGrovePattern(seed), a);
    }
    assert.ok(differs, 'seeds give different patterns');
    assert.equal(a.channels.length, GROVE_CHANNELS);
    for (const row of a.channels) assert.equal(row.notes.length, GROVE_STEPS);
    assert.equal(parseGrovePattern(a) !== null, true, 'the default is valid');
});

await test('the default uses only the starter voices (kick, melody, arpeggio)', () => {
    for (let seed = 0; seed < 50; seed++) {
        const p = defaultGrovePattern(seed * 7919);
        for (let ch = 0; ch < GROVE_CHANNELS; ch++) {
            const plays = p.channels[ch].notes.some((d) => d !== GROVE_REST);
            if (plays) assert.equal(COMPOSER_VOICES[ch].requires, undefined, `channel ${ch}`);
        }
        assert.equal(p.channels[0].notes[0], 0, 'the kick lands on the downbeat');
    }
});

await test('a stone with no authored pattern plays the default rolled from its id', () => {
    const resolved = resolveStonePattern('stone-a', undefined);
    assert.ok(sameGrovePattern(resolved, defaultGrovePattern(grovePatternSeed('stone-a'))));
    assert.ok(sameGrovePattern(resolveStonePattern('stone-a', { junk: true }), resolved));
    assert.ok(sameGrovePattern(resolveStonePattern('stone-a', p1), p1));
    assert.equal(stonePatternOf(stone('s')), null);
    assert.ok(sameGrovePattern(stonePatternOf(stone('s', p1))!, p1));
});

await test('edits are pure and clamp: cells, cues, rows', () => {
    const base = emptyGrovePattern(3);
    const lit = withGroveCell(base, 1, 4, 99);
    assert.equal(base.channels[1].notes[4], GROVE_REST, 'the original is untouched');
    assert.equal(lit.channels[1].notes[4], 13, 'degrees clamp to two octaves');
    assert.equal(withGroveCell(base, 1, 4, -5).channels[1].notes[4], GROVE_REST);
    assert.equal(groveNoteCount(lit), 1);
    const cued = withGroveCue(lit, 1, 'island.glow');
    assert.equal(cued.channels[1].cue, 'island.glow');
    assert.equal(withGroveCue(cued, 1, null).channels[1].cue, undefined);
    const cleared = withGroveRowCleared(cued, 1);
    assert.equal(groveNoteCount(cleared), 0);
    assert.equal(cleared.channels[1].cue, 'island.glow', 'clearing a row keeps its cue');
});

await test('validation names what is wrong', () => {
    assert.equal(grovePatternIssue(p1), null);
    const short = { ...p1, channels: p1.channels.slice(0, 7) };
    assert.match(grovePatternIssue(short)!, /channels/);
    const badDegree = JSON.parse(JSON.stringify(p1)) as GrovePattern;
    badDegree.channels[0].notes[0] = 14;
    assert.match(grovePatternIssue(badDegree)!, /channels\.0\.notes\.0/);
    const badCue = JSON.parse(JSON.stringify(p1)) as GrovePattern;
    badCue.channels[2].cue = 'DROP TABLE';
    assert.match(grovePatternIssue(badCue)!, /cue/);
    const extra = { ...p1, tempo: 300 };
    assert.notEqual(grovePatternIssue(extra), null, 'unknown keys are refused');
    const fraction = JSON.parse(JSON.stringify(p1)) as GrovePattern;
    fraction.channels[1].notes[3] = 2.5;
    assert.notEqual(grovePatternIssue(fraction), null);
});

// ---------------------------------------------------------------------------
// The document boundary
// ---------------------------------------------------------------------------

await test('a compose changes only the pattern of one stone', () => {
    const from = stone('s1');
    assert.equal(composeIssue(from, withStonePattern(from, p1)), null);
    assert.match(composeIssue(from, withStonePattern(stone('s2'), p1))!, /share an id/);
    const moved = withStonePattern(stone('s1', undefined, 30, 30), p1);
    assert.match(composeIssue(from, moved)!, /only the pattern/);
    const notStone = { ...from, entity: { ...from.entity, type: 'mushroom' } } as EntitySnapshot;
    assert.match(composeIssue(notStone, withStonePattern(notStone, p1))!, /music_stone/);
    const bad = stone('s1', { v: 1, seed: 0, channels: [] });
    assert.match(composeIssue(from, bad)!, /invalid grove pattern/);
});

await test('WorldDocument schema: compose and stone patterns are checked on load', () => {
    const from = stone('s1');
    const place: DocumentCommand = { type: 'place', snapshot: from };
    const compose: DocumentCommand = { type: 'compose', from, to: withStonePattern(from, p1) };
    assert.equal(validateWorldDocument(doc([place, compose])).ok, true);

    const forged: DocumentCommand = {
        type: 'compose',
        from,
        to: withStonePattern(stone('s1', undefined, 50, 50), p1),
    };
    const r1 = validateWorldDocument(doc([place, forged]));
    assert.equal(r1.ok, false, 'a compose that moves the stone is refused');

    const badPlace: DocumentCommand = { type: 'place', snapshot: stone('s2', { v: 2 }) };
    assert.equal(validateWorldDocument(doc([badPlace])).ok, false, 'a placed bad pattern too');
    const nested: DocumentCommand = { type: 'batch', commands: [badPlace] };
    assert.equal(validateWorldDocument(doc([nested])).ok, false, '...also inside a batch');
    const badMove: DocumentCommand = {
        type: 'move',
        from,
        to: stone('s1', { v: 1, seed: 1, channels: 'x' }),
    };
    assert.equal(validateWorldDocument(doc([badMove])).ok, false, '...and on a move');
});

await test('compose transitions and inverse: a → b, undo is b → a', () => {
    const from = stone('s1', p1);
    const to = withStonePattern(from, p2);
    const cmd: DocumentCommand = { type: 'compose', from, to };
    const net = netEntityChanges([cmd]).get('s1')!;
    assert.equal(net.before, from);
    assert.equal(net.after, to);
    const inv = invertCommand(cmd);
    assert.equal(inv.type, 'compose');
    assert.deepEqual(netEntityChanges([cmd, inv]).get('s1')!.after, from);
});

await test('the shared-world validator accepts composed stones and refuses forged ones', () => {
    const from = stone('s1');
    const ok = validateSharedWorld(
        doc([
            { type: 'place', snapshot: from },
            { type: 'compose', from, to: withStonePattern(from, p1) },
        ])
    );
    assert.equal(ok.ok, true, ok.ok ? '' : ok.message);
    if (ok.ok) assert.equal(ok.stats.entities, 1);
    const bad = validateSharedWorld(
        doc([{ type: 'place', snapshot: stone('s1', { v: 1, seed: 1, channels: [] }) }])
    );
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, 'schema');
});

await test('room messages: a forged compose is malformed, a real one parses', () => {
    const from = stone('s1');
    const message = (command: DocumentCommand): unknown => ({
        author: 'peer-b',
        seq: 1,
        rev: 1,
        baseRev: 0,
        command,
    });
    const good = parseCmdMessage(message({ type: 'compose', from, to: withStonePattern(from, p1) }));
    assert.equal(good.ok, true);
    const otherId = parseCmdMessage(
        message({ type: 'compose', from, to: withStonePattern(stone('s9'), p1) })
    );
    assert.equal(otherId.ok, false);
    const junk = parseCmdMessage(message({ type: 'compose', from, to: stone('s1', { v: 1 }) }));
    assert.equal(junk.ok, false);
});

await test('replicas converge on composes whatever the order, and duplicates change nothing', () => {
    const base = stone('s1');
    const start = { commands: [{ type: 'place', snapshot: base }] as DocumentCommand[] };
    const a = new SharedWorldReplica('peer-a', start);
    const b = new SharedWorldReplica('peer-b', start);
    const c = new SharedWorldReplica('peer-c', start);

    const ma = a.local({ type: 'compose', from: base, to: withStonePattern(base, p1) }).message;
    const mb = b.local({ type: 'compose', from: base, to: withStonePattern(base, p2) }).message;

    const deliver = (r: SharedWorldReplica, m: CmdMessage) => r.receive(m);
    deliver(a, mb);
    deliver(b, ma);
    deliver(c, mb);
    deliver(c, ma);
    deliver(c, ma); // duplicate
    deliver(a, mb); // duplicate

    assert.equal(a.hash(), b.hash());
    assert.equal(b.hash(), c.hash());
    // Last writer wins per entity: equal revs, so the author breaks the tie the same everywhere.
    const winner = stonePatternOf(a.stateOf('s1')!)!;
    assert.ok(sameGrovePattern(winner, stonePatternOf(c.stateOf('s1')!)!));
    assert.ok(sameGrovePattern(winner, p1) || sameGrovePattern(winner, p2));
    assert.equal(documentStateHash(a.documentCommands()), documentStateHash(c.documentCommands()));
});

// ---------------------------------------------------------------------------
// Playback through the generative sequencer and engine
// ---------------------------------------------------------------------------

function stepsOf(seq: GenerativeSequencer, n: number) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        out.push(
            seq
                .tick(0.5)
                .map((e) => `${e.channel}:${e.note}@${e.step}/${e.velocity}`)
                .join(' ')
        );
    }
    return out;
}

await test('an authored pattern plays the same notes every time, in the biome key', () => {
    const profile = BIOME_PROFILES.arpeggio_grove;
    const seqA = new GenerativeSequencer(1, profile);
    const seqB = new GenerativeSequencer(99, profile); // a different generative seed
    seqA.setAuthoredPattern(p1);
    seqB.setAuthoredPattern(p1);
    const a = stepsOf(seqA, 64);
    const b = stepsOf(seqB, 64);
    assert.deepEqual(a, b, 'the generative seed does not leak into an authored pattern');
    assert.deepEqual(a.slice(0, 16), a.slice(16, 32), 'and it does not evolve bar to bar');

    // Every note is the cell's degree in G lydian, at the voice's octave.
    const seq = new GenerativeSequencer(1, profile);
    seq.setAuthoredPattern(p1);
    for (let s = 0; s < GROVE_STEPS; s++) {
        const events = seq.tick(0.5);
        const expected = p1.channels
            .map((row, ch) => ({ ch, d: row.notes[s] }))
            .filter(({ d }) => d !== GROVE_REST);
        assert.equal(events.length, expected.length, `step ${s}`);
        for (const { ch, d } of expected) {
            const ev = events.find((e) => e.channel === ch)!;
            assert.equal(ev.note, authoredNote(profile, ch, d));
            assert.equal(ev.velocity, AUTHORED_VELOCITY);
        }
    }
    assert.equal(authoredNote(profile, 2, 0), scaleNote('G', profile.scale, 0, 5));
    assert.equal(authoredNote(profile, 0, 0), scaleNote('G', profile.scale, 0, 1), 'kick an octave down');
    const inC = authoredNote(BIOME_PROFILES.global, 2, 0);
    assert.equal(inC, 'C5', 'the same degree follows the key of another biome');
});

await test('clearing the authored pattern resumes the generated score where it was', () => {
    const profile = BIOME_PROFILES.global;
    const plain = new GenerativeSequencer(5, profile);
    const generated = stepsOf(plain, 32);
    const seq = new GenerativeSequencer(5, profile);
    const first = stepsOf(seq, 16);
    seq.setAuthoredPattern(p1);
    stepsOf(seq, 64); // four authored bars: the generated patterns must not evolve meanwhile
    seq.setAuthoredPattern(null);
    assert.equal(seq.playingAuthored, false);
    assert.deepEqual(first, generated.slice(0, 16));
    assert.notDeepEqual(stepsOf(seq, 16), [], 'it plays again');
});

class RecordingSink implements GenerativeVoiceSink {
    notes: Array<{ note: string; channel: number; when: number }> = [];
    healthy = true;
    playNote(note: string, channel: number, _v: number, when: number): void {
        this.notes.push({ note, channel, when });
    }
    setBrightness(): void {}
    setReverbWet(): void {}
}

await test('the engine plays an authored pattern on its own voices and reports heard steps', async () => {
    const ctx = {
        currentTime: 0,
        state: 'running',
        outputLatency: 0,
        baseLatency: 0,
        resume: async () => {},
    };
    const sink = new RecordingSink();
    const engine = new GenerativeEngine({ seed: 3, biome: 'global' });
    engine.attach(ctx as unknown as AudioContext, {} as GainNode, { dsp: false, fallback: sink });
    const heard: number[] = [];
    const notes: string[] = [];
    engine.onNote((note) => notes.push(note));
    const off = engine.addStepListener((_row, events) => heard.push(events.length));
    engine.setAuthoredPattern(p1);
    assert.equal(engine.playingAuthored, true);
    await engine.start();
    for (let i = 0; i < 240; i++) {
        ctx.currentTime += 1 / 60;
        engine.update(1 / 60);
    }
    off();
    assert.ok(sink.notes.length > 0, 'notes reached the sink');
    const expected = new Set<string>();
    for (const [ch, row] of p1.channels.entries()) {
        for (const d of row.notes) {
            if (d !== GROVE_REST) expected.add(authoredNote(engine.getActiveProfile(), ch, d));
        }
    }
    for (const n of sink.notes) assert.ok(expected.has(n.note), `${n.note} is from the pattern`);
    assert.ok(heard.length > 0 && notes.length > 0, 'visual callbacks fired when heard');

    const preview = engine.previewNote(2, 4);
    assert.equal(preview, authoredNote(engine.getActiveProfile(), 2, 4));
    assert.equal(sink.notes.at(-1)!.note, preview, 'a preview sounds right away');
    assert.equal(engine.previewNote(2, -1), null);
});

// ---------------------------------------------------------------------------
// ComposerPlayback
// ---------------------------------------------------------------------------

class FakeEngine implements ComposerEngine {
    sent: Array<GrovePattern | null> = [];
    listeners: Array<(row: number, events: ReadonlyArray<{ channel: number }>) => void> = [];
    setAuthoredPattern(p: GrovePattern | null): void {
        this.sent.push(p);
    }
    addStepListener(fn: (row: number, events: ReadonlyArray<{ channel: number }>) => void) {
        this.listeners.push(fn);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== fn);
        };
    }
    step(channels: number[]): void {
        for (const l of this.listeners) l(0, channels.map((channel) => ({ channel })));
    }
}

function view(id: string, x: number, pattern: GrovePattern): StoneView {
    const keys = Array.from({ length: 8 }, () => ({ position: { y: 1 }, userData: {} }));
    return { id, x, y: 0, z: 0, pattern, keys: keys as never };
}

await test('playback: the nearest stone in earshot plays, with hysteresis at the edge', () => {
    const engine = new FakeEngine();
    const pb = new ComposerPlayback({ fireCue: () => true });
    pb.attach(engine);
    const a = view('a', 0, p1);
    const b = view('b', 40, p2);
    const at = (x: number) => pb.update({ x, y: 0, z: 0 }, [a, b]);

    at(-30);
    assert.equal(pb.source.kind, 'none');
    at(-(HEAR_RADIUS - 1));
    assert.deepEqual(pb.source, { kind: 'stone', stoneId: 'a' });
    assert.equal(engine.sent.at(-1), p1);
    at(HEAR_RADIUS + 1); // past the hear radius, inside the release radius: a keeps playing
    assert.deepEqual(pb.source, { kind: 'stone', stoneId: 'a' });
    at(RELEASE_RADIUS + 1);
    assert.equal(pb.source.kind, 'none', 'released past the release radius');
    assert.equal(engine.sent.at(-1), null, 'the generated score is back');
    at(38);
    assert.deepEqual(pb.source, { kind: 'stone', stoneId: 'b' });
    const sends = engine.sent.length;
    at(38.5);
    assert.equal(engine.sent.length, sends, 'an unchanged pattern is not re-sent');
});

await test('playback: an audition overrides proximity and stops cleanly', () => {
    const engine = new FakeEngine();
    const pb = new ComposerPlayback({ fireCue: () => true });
    pb.attach(engine);
    const a = view('a', 0, p1);
    pb.update({ x: 0, y: 0, z: 0 }, [a]);
    const draft = withGroveCell(p1, 7, 0, 3);
    pb.setAudition(draft, 'a');
    assert.equal(engine.sent.at(-1), draft);
    assert.deepEqual(pb.source, { kind: 'audition', stoneId: 'a' });
    pb.update({ x: 0, y: 0, z: 0 }, [a]);
    assert.equal(engine.sent.at(-1), draft, 'the stone does not take over mid-audition');
    pb.setAudition(null);
    assert.equal(engine.sent.at(-1), p1, 'the stone plays again after the audition');
    pb.dispose();
    assert.equal(engine.sent.at(-1), null, 'detaching hands the soundtrack back');
    assert.equal(engine.listeners.length, 0);
});

await test('playback: a bound cue fires once per heard step, and keys bob and settle', () => {
    const engine = new FakeEngine();
    const fired: string[] = [];
    const pb = new ComposerPlayback({
        fireCue: (id) => {
            fired.push(id);
            return id !== 'locked.cue';
        },
    });
    pb.attach(engine);
    let pattern = withGroveCue(emptyGrovePattern(1), 0, 'grove.geyser');
    pattern = withGroveCue(pattern, 3, 'grove.geyser');
    pattern = withGroveCue(pattern, 5, 'locked.cue');
    const a = view('a', 0, pattern);
    pb.update({ x: 0, y: 0, z: 0 }, [a]);

    engine.step([0, 3, 2]);
    assert.deepEqual(fired, ['grove.geyser'], 'two rows on one cue fire it once');
    engine.step([1]);
    assert.deepEqual(fired, ['grove.geyser'], 'a row with no cue fires nothing');
    engine.step([5]);
    assert.deepEqual(fired, ['grove.geyser', 'locked.cue']);
    assert.deepEqual(pb.cueLog, ['grove.geyser'], 'a refused (locked) cue is not logged as fired');

    const key = a.keys![0] as unknown as { position: { y: number }; userData: { restY?: number } };
    engine.step([0]);
    assert.ok(key.position.y > 1, 'the voice key bobs');
    for (let i = 0; i < 120; i++) pb.settle(1 / 60);
    assert.equal(key.position.y, 1, 'and settles back');
});

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

await test('voices: three to start, the rest from unlocks and finished Melodies', () => {
    const none = { isUnlocked: () => false, completedMelodies: new Set<string>() };
    assert.deepEqual(availableVoices(none), [true, false, true, true, false, false, false, false]);
    const some = {
        isUnlocked: (id: string) => id === 'arpeggio_shield',
        completedMelodies: new Set(['meadow']),
    };
    assert.deepEqual(availableVoices(some), [true, true, true, true, true, false, false, false]);
    const all = {
        isUnlocked: () => true,
        completedMelodies: new Set(['meadow', 'garden-rhythm', 'night-market']),
    };
    assert.ok(availableVoices(all).every(Boolean));
    for (const v of COMPOSER_VOICES) {
        if (v.requires) assert.ok(v.requires.label.length > 0, `${v.name} says what unlocks it`);
        assert.equal(isVoiceAvailable(v, all), true);
    }
});

if (failures > 0) {
    console.error(`\n${failures} grove composer test(s) failed`);
    process.exit(1);
}
console.log('\nAll grove composer tests passed');
