/**
 * Objectives layer: the wiring between the world document and the lazy objective system
 * (#2028 slice B). Unlike `objectives.test.ts` this imports the real progress bridge and a real
 * `WorldDocumentSession`, which reach the WASM loader, so it runs with the wasm hooks.
 *
 * What it pins down:
 *   - a legacy save and a schema-0 document load with the empty `melodies` state;
 *   - a capture taken before the objectives chunk has loaded keeps the chains a document applied
 *     (the leaf holds them), and hands them over when the chunk registers;
 *   - `mergeLiveProgress` applies Melody state after inventory and discoveries are merged;
 *   - state arriving from a document is never announced, and local progress afterwards still is.
 *
 * Run: npx tsx --import ./tests/support/register-wasm-hooks.mjs tests/objectives-bridge.test.ts
 */

import assert from 'node:assert/strict';

// Inert DOM + Map-backed localStorage so the toast / announcer / persistence paths run in Node.
const noop = () => {};
const fakeEl: any = new Proxy(function () {}, {
    get: (_t, p) => (p === 'style' ? {} : p === 'classList' ? { add: noop, remove: noop } : fakeEl),
    apply: () => fakeEl,
    set: () => true,
});
(globalThis as any).document = {
    getElementById: () => null,
    createElement: () => fakeEl,
    body: { appendChild: noop, prepend: noop },
    head: { appendChild: noop },
    addEventListener: noop,
};
const data = new Map<string, string>();
(globalThis as any).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
};

const { EditHistory } = await import('../src/systems/edit-history.ts');
const { createObjectiveSystem } = await import('../src/gameplay/objectives/objective-system.ts');
const { parseMelodyFile } = await import('../src/gameplay/objectives/schema.ts');
const { parseWorldDocument } = await import('../src/world/document/migrations.ts');
const { readLiveProgress } = await import('../src/world/document/progress-bridge.ts');
const { createEmptyDocument } = await import('../src/world/document/schema.ts');
const { WorldDocumentSession } = await import('../src/world/document/session.ts');
const { MemoryDocumentStore } = await import('../src/world/document/store.ts');
const { unlockSystem } = await import('../src/systems/unlocks.ts');
const leaf = await import('../src/systems/melody-progress.ts');

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

/** Leave the registry leaf empty and unregistered, whatever a test did to it. */
function resetLeaf(): void {
    leaf.registerMelodyStore({ read: leaf.emptyMelodyProgress, apply: () => {} })();
}

function newSession(melodies?: { completed: string[]; step: Record<string, number> }) {
    const doc = createEmptyDocument({ seed: 7, mapVersion: 'test', id: 'doc-1', now: 100 });
    if (melodies) doc.progress.melodies = melodies;
    return new WorldDocumentSession(doc, {
        history: new EditHistory(),
        store: new MemoryDocumentStore(),
        saveDelayMs: 60_000, // no readProgress: capture() reads the live systems
    });
}

await test('a legacy save and a schema-0 document load with the empty melodies state', () => {
    const legacy = parseWorldDocument(
        { schema: 0, progress: { inventory: { fern_core: 2 } } },
        { seed: 3, mapVersion: 'test', now: 5 }
    );
    assert.ok(legacy.ok, legacy.ok ? '' : legacy.error.message);
    assert.deepEqual(legacy.doc.progress.melodies, { completed: [], step: {} });
    assert.deepEqual(legacy.doc.progress.inventory, { fern_core: 2 });
});

await test('readLiveProgress reads the leaf: empty at first, then what a document applied', () => {
    resetLeaf();
    assert.deepEqual(readLiveProgress().melodies, { completed: [], step: {} });
    leaf.applyMelodyProgress({ completed: ['meadow'], step: { 'night-market': 2 } });
    assert.deepEqual(readLiveProgress().melodies, {
        completed: ['meadow'],
        step: { 'night-market': 2 },
    });
    resetLeaf();
});

await test('a capture before the objectives chunk loads keeps the document’s chains', async () => {
    resetLeaf();
    unlockSystem.reset();
    const session = newSession({ completed: ['meadow'], step: { 'night-market': 4 } });
    // An autosave fires before the chunk has registered a store: nothing live to read, and the
    // empty live state is the identity, so the document's chains survive.
    assert.deepEqual(session.capture().progress.melodies, {
        completed: ['meadow'],
        step: { 'night-market': 4 },
    });
    // Loading the document hands the same state to the leaf …
    await session.mergeProgress();
    assert.deepEqual(readLiveProgress().melodies, {
        completed: ['meadow'],
        step: { 'night-market': 4 },
    });
    // … and the chunk registering later receives it, silently.
    const received: unknown[] = [];
    const unregister = leaf.registerMelodyStore({
        read: () => leaf.emptyMelodyProgress(),
        apply: (p) => received.push(p),
    });
    assert.deepEqual(received, [{ completed: ['meadow'], step: { 'night-market': 4 } }]);
    unregister();
    session.dispose();
    resetLeaf();
});

await test('mergeLiveProgress applies Melody state after inventory and discoveries are merged', async () => {
    resetLeaf();
    unlockSystem.reset();
    const session = newSession({ completed: [], step: { meadow: 1 } });
    session.doc.progress.inventory = { fern_core: 5 };
    session.doc.progress.discoveries = ['cave'];
    const seen: Array<{ fern: number }> = [];
    const unregister = leaf.registerMelodyStore({
        read: leaf.emptyMelodyProgress,
        apply: () => seen.push({ fern: unlockSystem.getItemCount('fern_core') }),
    });
    await session.mergeProgress();
    assert.deepEqual(
        seen,
        [{ fern: 5 }],
        'the document’s inventory was in place when Melodies applied'
    );
    unregister();
    session.dispose();
    resetLeaf();
    unlockSystem.reset();
});

const MEADOW = parseMelodyFile('meadow.json', {
    id: 'meadow',
    title: 'Meadow Melody',
    steps: [
        { id: 'fern', text: 'fern', trigger: { kind: 'harvest', item: 'fern_core', count: 1 } },
        {
            id: 'nectar',
            text: 'nectar',
            trigger: { kind: 'harvest', item: 'vibrato_nectar', count: 1 },
        },
    ],
});

await test('state from a document is silent end to end, and later local progress still announces', async () => {
    resetLeaf();
    unlockSystem.reset();
    const calls: Array<[string, string]> = [];
    const system = createObjectiveSystem({
        melodies: [MEADOW],
        snapshot: {
            itemCount: (id) => unlockSystem.getItemCount(id),
            isDiscovered: () => false,
            awakenedCount: () => 0,
        },
        announce: (event, title) => calls.push([event, title]),
    });
    const unregister = leaf.registerMelodyStore({
        read: system.getProgress,
        apply: system.apply,
    });
    const offHarvest = unlockSystem.onHarvest(() => system.evaluate());

    // A world whose inventory already satisfies step one: merged, so silent.
    const session = newSession({ completed: [], step: { meadow: 0 } });
    session.doc.progress.inventory = { fern_core: 1 };
    await session.mergeProgress();
    assert.deepEqual(calls, [], 'nothing announced for a merged document');
    assert.deepEqual(system.getProgress(), { completed: [], step: { meadow: 1 } });
    assert.deepEqual(session.capture().progress.melodies, { completed: [], step: { meadow: 1 } });

    // The player then does something themselves.
    unlockSystem.harvest('vibrato_nectar', 1, 'Vibrato Nectar');
    assert.deepEqual(calls, [['completed', 'Meadow Melody']]);
    assert.deepEqual(session.capture().progress.melodies, { completed: ['meadow'], step: {} });

    offHarvest();
    unregister();
    session.dispose();
    resetLeaf();
    unlockSystem.reset();
});

if (failures > 0) {
    console.error(`\n${failures} objectives-bridge test(s) failed`);
    process.exit(1);
}
console.log('\nobjectives-bridge: all tests passed');
