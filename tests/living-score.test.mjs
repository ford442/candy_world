import './support/register-hooks.mjs';
import assert from 'node:assert/strict';

// We mock dependencies, load the cues and trigger onRowEdge.
import { unlockSystem } from '../src/systems/unlocks.ts';
import { attachLivingScoreAudioListener, updateLivingScore, initLivingScore, getLivingScoreDebugState } from '../src/systems/living-score.ts';

// Stub missing DOM elements if needed for testing (fetch is available in Node 18+)
const mockFetch = async () => ({
    ok: true,
    json: async () => ({
        version: 1,
        cues: [
            { id: 'market.lantern_fill', biome: 'night_market', channel: 3, instrument: 12, rowMod: 16, event: 'lanternPhrase' },
            { id: 'grove.geyser', biome: 'arpeggio_grove', channel: 1, note: 'C-5', event: 'geyserBurst' },
            { id: 'cave.shimmer', biome: 'sugar_caves', channel: 2, rowMod: 8, event: 'cavePulse' },
            { id: 'island.fauna', biome: 'lake_island', channel: 0, rowMod: 4, event: 'faunaImpulse', unlock: 'island_scholar' }
        ]
    })
});

globalThis.fetch = mockFetch;

// Mock audio system
class MockAudioSystem {
    constructor() {
        this.onRowEdge = null;
    }
    triggerRowEdge(order, row, channels) {
        if (this.onRowEdge) {
            this.onRowEdge(order, row, channels);
        }
    }
}

async function runTests() {
    console.log("Living Score Test");
    await initLivingScore();

    const audioSystem = new MockAudioSystem();
    attachLivingScoreAudioListener(audioSystem);

    // Simulate day/night bias
    let bias = 0.0; // Full night

    // Test 1: No edge trigger
    updateLivingScore(audioSystem, bias, 0.016);
    let state = getLivingScoreDebugState();
    assert.equal(state.lastFiredCues.length, 0);

    // Test 2: Channel 3 triggers market.lantern_fill at row 16, inst 12
    let channels = [];
    for(let i = 0; i < 4; i++) channels.push({});
    channels[3] = { instrument: 12, note: 'D-5' }; // matching row 16

    audioSystem.triggerRowEdge(0, 16, channels);
    updateLivingScore(audioSystem, bias, 0.016);

    state = getLivingScoreDebugState();
    assert.ok(state.lastFiredCues.includes('market.lantern_fill'));

    // Test 3: Channel 1 triggers grove.geyser on C-5
    channels[3] = {};
    channels[1] = { note: 'C-5' };

    audioSystem.triggerRowEdge(0, 17, channels);
    updateLivingScore(audioSystem, bias, 0.016);

    state = getLivingScoreDebugState();
    assert.equal(state.lastFiredCues[0], 'grove.geyser');

    // Test 4: Mismatch does not trigger
    channels[1] = { note: 'D-5' };
    audioSystem.triggerRowEdge(0, 18, channels);
    updateLivingScore(audioSystem, bias, 0.016);

    state = getLivingScoreDebugState();
    // lastFired is unshifted, so index 0 is still grove.geyser, length shouldn't change
    assert.equal(state.lastFiredCues[0], 'grove.geyser');

    // Test 5: a cue with an `unlock` stays silent until that unlock is earned
    channels[1] = {};
    channels[0] = { instrument: 3, note: 'E-4' };
    audioSystem.triggerRowEdge(0, 20, channels);
    updateLivingScore(audioSystem, bias, 0.016);
    assert.ok(!getLivingScoreDebugState().lastFiredCues.includes('island.fauna'));

    unlockSystem.restore(['island_scholar'], {});
    audioSystem.triggerRowEdge(0, 24, channels);
    updateLivingScore(audioSystem, bias, 0.016);
    assert.equal(getLivingScoreDebugState().lastFiredCues[0], 'island.fauna');

    console.log("✅ All living score tests passed!");
}

runTests();
