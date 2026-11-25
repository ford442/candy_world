import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstancedBatcher, updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { CandyDebrisBatcher, MAX_DEBRIS } from '../src/foliage/candy-debris-batcher.ts';
import {
    NightMarketBatcher, MAX_NIGHT_MARKET_STALLS, NIGHT_MARKET_DAY_HIDE_PHASE,
} from '../src/foliage/night-market-batcher.ts';
import { getLocalLightStats } from '../src/rendering/lights.ts';

const ctx = { dt: 0.02, rawDt: 0.02, time: 1, audio: null } as FrameContext;
const matrixAt = (mesh: THREE.InstancedMesh, slot: number) =>
    new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, slot * 16);

test('night market keeps linked streams, proxy slots and lights on swap and disposal', () => {
    const b = new NightMarketBatcher();
    assert.ok(b instanceof InstancedBatcher);
    const baseline = getLocalLightStats().decorative;
    const proxies = Array.from({ length: 3 }, (_, i) => {
        const p = new THREE.Object3D();
        p.position.set(i * 3, 2, i + 1);
        assert.equal(b.register(p, { color: [0xff0000, 0x00ff00, 0x0000ff][i] }), i);
        return p;
    });
    assert.equal(b.register(proxies[2]), 2);
    assert.equal(getLocalLightStats().decorative, baseline + 3);
    const meshes = b.meshes;
    const oldMatrix = matrixAt(meshes[0], 2).toArray();
    const tint = meshes[0].geometry.getAttribute('aStallTint');
    const oldTint = Array.from(tint.array.slice(8, 12));
    b.removeInstance(proxies[0]);
    assert.equal(getLocalLightStats().decorative, baseline + 2);
    assert.equal(proxies[0].userData.nightMarketSlot, undefined);
    assert.equal(proxies[0].userData.batchIndex, -1);
    assert.equal(proxies[2].userData.nightMarketSlot, 0);
    assert.equal(proxies[2].userData.batchIndex, 0);
    assert.equal(b.getStall(0), proxies[2]);
    for (const mesh of meshes) {
        assert.equal(mesh.count, 2);
        assert.deepEqual(matrixAt(mesh, 0).toArray(), oldMatrix);
        assert.deepEqual(Array.from(mesh.geometry.getAttribute('aStallTint').array.slice(0, 4)), oldTint);
    }
    b.update(NIGHT_MARKET_DAY_HIDE_PHASE);
    assert.equal(b.lanternMesh!.visible, false);
    updateInstancedBatchers(ctx);
    assert.equal(b.lanternMesh!.visible, false);
    b.update(0);
    assert.equal(b.lanternMesh!.visible, true);
    b.removeInstance(proxies[0]);
    assert.equal(b.instanceCount, 2);
    let disposed = 0;
    for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => disposed++);
    b.dispose();
    assert.equal(disposed, 3);
    assert.ok(meshes.every((mesh) => !mesh.parent));
    assert.equal(getLocalLightStats().decorative, baseline);
    assert.equal(proxies[2].userData.nightMarketSlot, undefined);
    assert.equal(b.register(proxies[2]), 0);
    b.dispose();
});

test('market capacity preserves -1 wrapper and counts skipped stalls with one warning', () => {
    const b = new NightMarketBatcher();
    const warns: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args) => warns.push(args);
    try {
        const proxies: THREE.Object3D[] = [];
        for (let i = 0; i < MAX_NIGHT_MARKET_STALLS; i++) {
            const proxy = new THREE.Object3D();
            proxies.push(proxy);
            assert.equal(b.register(proxy), i);
        }
        assert.equal(b.register(new THREE.Object3D()), -1);
        assert.equal(b.register(new THREE.Object3D()), -1);
        assert.equal(b.dropped, 2);
        assert.equal(warns.length, 1);
        assert.ok(b.meshes.every((m) => m.count === MAX_NIGHT_MARKET_STALLS));
        b.removeInstance(proxies[0]);
        assert.equal(proxies.at(-1)!.userData.batchIndex, 0);
        assert.equal(b.register(new THREE.Object3D()), MAX_NIGHT_MARKET_STALLS - 1);
    } finally {
        console.warn = warn;
        b.dispose();
    }
});

test('debris swap keeps physics and color, scheduler does not integrate twice', () => {
    const b = CandyDebrisBatcher.getInstance();
    b.clear();
    assert.ok(b instanceof InstancedBatcher);
    const random = Math.random;
    Math.random = () => 0.5;
    try {
        assert.equal(b.burst({ origin: { x: 1, y: 30, z: 0 }, count: 1, color: 0xff0000, life: 0.01 }), 1);
        assert.equal(b.burst({ origin: { x: 8, y: 30, z: 0 }, count: 1, color: 0x0000ff, life: 2 }), 1);
        const mesh = b.mesh!;
        b.update(0.02);
        assert.equal(mesh.count, 1);
        assert.equal(b.getStats().count, 1);
        assert.ok(Math.abs(matrixAt(mesh, 0).elements[12] - 7.9) < 0.01);
        const colors = mesh.instanceColor!;
        assert.equal(colors.getX(0), 0);
        assert.equal(colors.getZ(0), 1);
        const after = matrixAt(mesh, 0).toArray();
        updateInstancedBatchers(ctx);
        assert.deepEqual(matrixAt(mesh, 0).toArray(), after);
        b.update(0.02);
        assert.notDeepEqual(matrixAt(mesh, 0).toArray(), after);
        let disposed = 0;
        mesh.geometry.addEventListener('dispose', () => disposed++);
        b.dispose();
        assert.equal(disposed, 1);
        assert.equal(mesh.parent, null);
        assert.equal(CandyDebrisBatcher.peekMesh(), null);
        assert.equal(CandyDebrisBatcher.getInstance().burst({ origin: { x: 0, y: 20, z: 0 }, count: 1 }), 1);
    } finally {
        Math.random = random;
        b.dispose();
    }
});

test('debris capacity preserves burst count and warns once for dropped shards', () => {
    const b = CandyDebrisBatcher.getInstance();
    b.clear();
    const oldDropped = b.dropped;
    const warns: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args) => warns.push(args);
    try {
        const origin = { x: 0, y: 10, z: 0 };
        assert.equal(b.burst({ origin, count: MAX_DEBRIS + 2 }), MAX_DEBRIS);
        assert.equal(b.burst({ origin, count: 1 }), 0);
        assert.equal(b.dropped - oldDropped, 3);
        assert.equal(warns.length, oldDropped === 0 ? 1 : 0);
        assert.equal(b.mesh!.count, MAX_DEBRIS);
        b.clear();
        assert.equal(b.mesh!.count, 0);
        assert.equal(b.burst({ origin, count: 1 }), 1);
    } finally {
        console.warn = warn;
        b.dispose();
    }
});
