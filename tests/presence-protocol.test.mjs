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

const entered = detectPeerBiomeEntry(peer);
assert(entered === 'gem_canopy', 'biome entry detected');

peers.get('peer1').lastSeen = now - PRESENCE_STALE_MS - 1;
const removed = pruneStalePeers(peers, now, PRESENCE_STALE_MS);
assert(removed.length === 1 && peers.size === 0, 'stale peer pruned');

console.log(`presence-protocol: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
