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

assert(
    isValidPose({
        id: 'a',
        pos: [0, 1, 2],
        quat: [0, 0, 0, 1],
        biome: 'global',
        ts: now,
    }),
    'valid pose accepted'
);

assert(!isValidPose({ id: 'bad' }), 'invalid pose rejected');

mergePresenceMeta(
    peers,
    {
        peer1: [{ id: 'peer1', label: 'Alpha', emoji: '🍬' }],
    },
    'self',
    16
);
assert(peers.size === 1 && peers.get('peer1')?.label === 'Alpha', 'presence meta merged');

function pose(id, biome, ts, pos = [1, 2, 3]) {
    return { id, pos, quat: [0, 0, 0, 1], biome, ts };
}

ingestPose(peers, 'self', pose('peer1', 'gem_canopy', now));
const peer = peers.get('peer1');
assert(peer && peer.snapshots.length === 1, 'pose ingested');

let entered = detectPeerBiomeEntry(peer);
assert(entered === null, 'first different pose does not trigger entry (debounce 1/3)');

ingestPose(peers, 'self', pose('peer1', 'gem_canopy', now + 100, [2, 3, 4]));
entered = detectPeerBiomeEntry(peer);
assert(entered === null, 'second consecutive pose does not trigger entry (debounce 2/3)');

ingestPose(peers, 'self', pose('peer1', 'gem_canopy', now + 200, [3, 4, 5]));
entered = detectPeerBiomeEntry(peer);
assert(entered === 'gem_canopy', 'third consecutive pose triggers entry (debounce 3/3)');

peers.clear();
ingestPose(peers, 'self', pose('peer2', 'arpeggio_grove', now, [0, 0, 0]));
const peer2 = peers.get('peer2');
detectPeerBiomeEntry(peer2);
for (let i = 1; i <= 3; i++) {
    ingestPose(peers, 'self', pose('peer2', 'global', now + i * 100, [i, 0, 0]));
    entered = detectPeerBiomeEntry(peer2);
}
assert(entered === null, 'global biome does not trigger entry');

peers.clear();
ingestPose(peers, 'self', pose('peer3', 'global', now, [0, 0, 0]));
const peer3 = peers.get('peer3');
detectPeerBiomeEntry(peer3);
ingestPose(peers, 'self', pose('peer3', 'sky_islands', now + 100, [1, 0, 0]));
entered = detectPeerBiomeEntry(peer3);
assert(entered === null && peer3.pendingBiome === 'sky_islands', 'debounce starts (1/3)');
ingestPose(peers, 'self', pose('peer3', 'global', now + 200, [0, 0, 0]));
entered = detectPeerBiomeEntry(peer3);
assert(entered === null && peer3.pendingBiome === undefined, 'bounce back resets debounce');

peers.clear();
peers.set('stale_peer', { id: 'stale_peer', lastSeen: now - PRESENCE_STALE_MS - 1, snapshots: [] });
const removed = pruneStalePeers(peers, now, PRESENCE_STALE_MS);
assert(removed.length === 1 && peers.size === 0, 'stale peer pruned');

console.log(`presence-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
