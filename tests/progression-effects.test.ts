/**
 * Progression effects (#1976 slice A): the item sources and unlock effects that
 * make the loop whole.
 *
 * Run with: npx tsx tests/progression-effects.test.ts
 */

import assert from 'node:assert/strict';

// Minimal DOM so the toast / announcer paths are inert.
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

const { unlockSystem } = await import('../src/systems/unlocks.ts');
const { BOUNCES_TO_RIPEN, recordMushroomBounce, harvestBounceShroom } = await import(
    '../src/systems/bounce-shrooms.ts'
);
const { pickNextShrine } = await import('../src/systems/shrine-travel.ts');
const { buildDiscoveryLogEntries, DISCOVERY_MAP } = await import('../src/systems/discovery-map.ts');
const { createHeavyStone } = await import('../src/foliage/heavy-stone.ts');

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`  ok  ${name}`);
    } catch (err) {
        failures++;
        console.error(`  FAIL ${name}\n`, err);
    }
}

const shroom = (x: number, z: number, radius = 3) => ({
    position: { x, y: 0, z },
    userData: { type: 'mushroom', radius } as Record<string, any>,
});

console.log('Bounce shrooms');
await test('ripen after BOUNCES_TO_RIPEN bounces, harvest once', () => {
    unlockSystem.reset();
    const a = shroom(0, 0);
    const field = [a, shroom(50, 50)];
    let now = 0;
    for (let i = 0; i < BOUNCES_TO_RIPEN - 1; i++) {
        assert.equal(recordMushroomBounce(0.5, 0.5, field, (now += 1000)), false);
    }
    assert.equal(a.userData.bounceRipe, undefined);
    assert.equal(recordMushroomBounce(0.5, 0.5, field, (now += 1000)), true);
    assert.equal(a.userData.bounceRipe, true);
    assert.ok(String(a.userData.interactionText).includes('Harvest'));

    a.userData.onInteract();
    assert.equal(unlockSystem.getItemCount('bounce_shroom'), 1);
    assert.equal(a.userData.bounceHarvested, true);
    assert.equal(harvestBounceShroom(a), false, 'cannot harvest twice');
    assert.equal(recordMushroomBounce(0.5, 0.5, field, (now += 1000)), false, 'spent shrooms stay spent');
});

await test('bounces inside the cooldown are one bounce', () => {
    const a = shroom(0, 0);
    recordMushroomBounce(0, 0, [a], 1000);
    recordMushroomBounce(0, 0, [a], 1100);
    assert.equal(a.userData.bounceCount, 1);
});

await test('only the mushroom under the player counts; non-mushrooms are ignored', () => {
    const near = shroom(0, 0);
    const far = shroom(20, 0);
    const flower = { position: { x: 0, y: 0, z: 0 }, userData: { type: 'flower' } as Record<string, any> };
    recordMushroomBounce(1, 0, [flower, far, near], 1000);
    assert.equal(near.userData.bounceCount, 1);
    assert.equal(far.userData.bounceCount, undefined);
    assert.equal(flower.userData.bounceCount, undefined);
});

await test(`5 ripe mushrooms earn Groove Boots`, () => {
    unlockSystem.reset();
    for (let i = 0; i < 5; i++) {
        const s = shroom(i * 20, 0);
        for (let b = 0; b < BOUNCES_TO_RIPEN; b++) recordMushroomBounce(i * 20, 0, [s], (b + 1) * 1000);
        s.userData.onInteract();
    }
    assert.ok(unlockSystem.isUnlocked('groove_boots'));
});

console.log('Heavy stones');
await test('three stones earn Wind Anchor; a stone only harvests once', () => {
    unlockSystem.reset();
    for (let i = 0; i < 3; i++) {
        const stone = createHeavyStone();
        stone.userData.onInteract();
        stone.userData.onInteract?.();
        assert.equal(stone.visible, false);
    }
    assert.equal(unlockSystem.getItemCount('heavy_stone'), 3);
    assert.ok(unlockSystem.isUnlocked('wind_anchor'));
});

console.log('Shrine Master');
await test('pickNextShrine walks the visited shrines in order and wraps', () => {
    const v = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 80, z: 0 }];
    assert.deepEqual(pickNextShrine(v, { x: 0.2, z: 0 }), v[1]);
    assert.deepEqual(pickNextShrine(v, v[2]), v[0]);
    assert.deepEqual(pickNextShrine(v, { x: 500, z: 500 }), v[0], 'unknown start goes to the first');
    assert.equal(pickNextShrine([v[0]], v[0]), null, 'nowhere to go with one shrine');
    assert.equal(pickNextShrine([], v[0]), null);
});

console.log('Resonance Tuner');
await test('hidden harmonics stay out of the log until found or tuned', () => {
    const none = () => false;
    const plain = buildDiscoveryLogEntries(DISCOVERY_MAP, none, false);
    const tuned = buildDiscoveryLogEntries(DISCOVERY_MAP, none, true);
    const hiddenIds = Object.keys(DISCOVERY_MAP).filter((id) => DISCOVERY_MAP[id].hidden);
    assert.ok(hiddenIds.length > 0, 'some discoveries are hidden harmonics');
    for (const id of hiddenIds) {
        assert.ok(!plain.some((e) => e.id === id), `${id} hidden without the tuner`);
        assert.equal(tuned.find((e) => e.id === id)?.state, 'sensed', `${id} sensed with the tuner`);
    }
    assert.equal(tuned.length, plain.length + hiddenIds.length);

    const found = buildDiscoveryLogEntries(DISCOVERY_MAP, (id) => id === hiddenIds[0], false);
    assert.equal(found.find((e) => e.id === hiddenIds[0])?.state, 'found');
});

console.log('Island Scholar');
await test('island score cues are gated on island_scholar', async () => {
    const cues = JSON.parse(
        (await import('node:fs')).readFileSync(new URL('../assets/score-cues.json', import.meta.url), 'utf8')
    ).cues as Array<{ biome: string; unlock?: string }>;
    const island = cues.filter((c) => c.biome === 'lake_island');
    assert.ok(island.length >= 3, 'the island has a cue set');
    assert.ok(island.every((c) => c.unlock === 'island_scholar'));
});

console.log('Generative music default');
await test('generative by default; tracker only when opted out', async () => {
    const { FEATURE_FLAGS } = await import('../src/core/config.ts');
    // No URL in node, so the default applies.
    assert.equal(FEATURE_FLAGS.generativeMusic, true);
    const { resolveMusicMode } = await import('../src/audio/generative/music-mode.ts');
    assert.equal(resolveMusicMode(), 'generative');
});

if (failures > 0) {
    console.error(`\n${failures} progression-effects test(s) failed`);
    process.exit(1);
}
console.log('\nAll progression-effects tests passed');
