/**
 * Presence protocol unit tests — mocked Realtime channel logic, no Supabase.
 * Run: node tests/presence-protocol.test.mjs
 */

import {
    isValidPose,
    pruneStalePeers,
    mergePresenceMeta,
    ingestPose,
    detectPeerBiomeEntry,
    PRESENCE_STALE_MS,
} from '../src/systems/net/presence-protocol.ts';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (cond) {
        passed++;
    } else {
        failed++;
        console.error(`FAIL: ${msg}`);
    }
}

const peers = new Map();
const now = 10_000;

assert(isValidPose({
    id: 'a',
    pos: [0, 1, 2],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now,
}), 'valid pose accepted');

assert(!isValidPose({ id: 'bad' }), 'invalid pose rejected');

mergePresenceMeta(peers, {
    peer1: [{ id: 'peer1', label: 'Alpha', emoji: '🍬' }],
}, 'self', 16);
assert(peers.size === 1 && peers.get('peer1')?.label === 'Alpha', 'presence meta merged');

ingestPose(peers, 'self', {
    id: 'peer1',
    pos: [1, 2, 3],
    quat: [0, 0, 0, 1],
    biome: 'gem_canopy',
    ts: now,
});
const peer = peers.get('peer1');
assert(peer && peer.snapshots.length === 1, 'pose ingested');

// Test 1: First pose does not trigger biome entry
let entered = detectPeerBiomeEntry(peer);
assert(entered === null, 'first different pose does not trigger entry (debounce 1/3)');

// Test 2: Second consecutive pose with same biome does not trigger
ingestPose(peers, 'self', {
    id: 'peer1',
    pos: [2, 3, 4],
    quat: [0, 0, 0, 1],
    biome: 'gem_canopy',
    ts: now + 100,
});
entered = detectPeerBiomeEntry(peer);
assert(entered === null, 'second consecutive pose does not trigger entry (debounce 2/3)');

// Test 3: Third consecutive pose with same biome DOES trigger
ingestPose(peers, 'self', {
    id: 'peer1',
    pos: [3, 4, 5],
    quat: [0, 0, 0, 1],
    biome: 'gem_canopy',
    ts: now + 200,
});
entered = detectPeerBiomeEntry(peer);
assert(entered === 'gem_canopy', 'third consecutive pose triggers entry (debounce 3/3)');

// Test 4: Global biome does not trigger entry
peers.clear();
ingestPose(peers, 'self', {
    id: 'peer2',
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'arpeggio_grove',
    ts: now,
});
const peer2 = peers.get('peer2');
detectPeerBiomeEntry(peer2); // Initialize lastBiome
ingestPose(peers, 'self', {
    id: 'peer2',
    pos: [1, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now + 100,
});
detectPeerBiomeEntry(peer2);
ingestPose(peers, 'self', {
    id: 'peer2',
    pos: [2, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now + 200,
});
detectPeerBiomeEntry(peer2);
ingestPose(peers, 'self', {
    id: 'peer2',
    pos: [3, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now + 300,
});
entered = detectPeerBiomeEntry(peer2);
assert(entered === null, 'global biome does not trigger entry');

// Test 5: Biome bounce resets debounce
peers.clear();
ingestPose(peers, 'self', {
    id: 'peer3',
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now,
});
const peer3 = peers.get('peer3');
detectPeerBiomeEntry(peer3); // Initialize lastBiome to 'global'
ingestPose(peers, 'self', {
    id: 'peer3',
    pos: [1, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'sky_islands',
    ts: now + 100,
});
entered = detectPeerBiomeEntry(peer3);
assert(entered === null && peer3.pendingBiome === 'sky_islands', 'debounce starts (1/3)');
ingestPose(peers, 'self', {
    id: 'peer3',
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    biome: 'global',
    ts: now + 200,
});
entered = detectPeerBiomeEntry(peer3);
assert(entered === null && peer3.pendingBiome === undefined, 'bounce back resets debounce');

// Test 6: Stale peer pruning
peers.clear();
peers.get = () => null;
peers.set('stale_peer', { lastSeen: now - PRESENCE_STALE_MS - 1, id: 'stale_peer' });
const removed = pruneStalePeers(peers, now, PRESENCE_STALE_MS);
assert(removed.length === 1 && peers.size === 0, 'stale peer pruned');

console.log(`presence-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
