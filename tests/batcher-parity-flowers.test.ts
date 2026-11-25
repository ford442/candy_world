import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { CONFIG } from '../src/core/config.ts';
import { updateFoliageBatcherLOD } from '../src/systems/batcher-lod.ts';
import { INSTANCE_LOD_ATTR } from '../src/foliage/batcher-lod-utils.ts';
import { flowerBatcher } from '../src/foliage/flower-batcher.ts';
import { SimpleFlowerBatcher } from '../src/foliage/simple-flower-batcher.ts';
import { PlantPoseMachine } from '../src/foliage/plant-pose-machine.ts';

function object(x: number): THREE.Group {
    const obj = new THREE.Group();
    obj.position.set(x, 2, 3);
    return obj;
}

function position(mesh: THREE.InstancedMesh, index: number): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(mesh.instanceMatrix.array, index * 16));
}

test('simple flowers swap linked streams, pose and pollen; dispose and refill', () => {
    const b = new SimpleFlowerBatcher();
    const a = object(1), c = object(5), d = object(9);
    b.register(a, { color: 0xff0000, forceBeam: true });
    b.register(c, { color: 0x00ff00, forceBeam: true });
    b.register(d, { color: 0x0000ff, forceBeam: true });
    const meshes = [b.stemMesh!, b.petalMesh!, b.centerMesh!, b.stamenMesh!, b.beamMesh!];
    assert.equal(position(meshes[0], 2).x, 9);
    assert.equal(position(meshes[1], 2).x, 9);
    const pollen = b.pollenPositions!.slice(30, 45);
    const offsets = b.pollenOffsets!.slice(30, 45);
    const colors = b.pollenColors!.slice(30, 45);
    const internals = b as unknown as {
        _gpuPositions: Float32Array;
        _lastGpuPoses: Float32Array;
        _poseMachine: PlantPoseMachine;
    };
    internals._lastGpuPoses = new Float32Array([0.1, 0.2, 0.75]);
    internals._poseMachine.reset(2, 0.75);
    for (const mesh of meshes) (mesh.geometry.getAttribute('aPoseState').array as Float32Array)[2] = 0.75;
    b.removeInstance(c);
    assert.equal(c.userData.batchIndex, -1);
    assert.equal(d.userData.batchIndex, 1);
    for (const mesh of meshes) {
        assert.equal(mesh.count, 2);
        assert.equal(position(mesh, 1).x, 9);
        assert.equal(mesh.geometry.getAttribute('aPoseState').getX(1), 0.75);
    }
    assert.deepEqual(b.pollenPositions!.slice(15, 30), pollen);
    assert.deepEqual(b.pollenOffsets!.slice(15, 30), offsets);
    assert.deepEqual(b.pollenColors!.slice(15, 30), colors);
    assert.equal(b.pollenPoints!.geometry.drawRange.count, 10);
    assert.equal(b.petalMesh!.instanceColor!.getZ(1), 1);
    assert.deepEqual(Array.from(internals._gpuPositions.slice(3, 6)), [9, 2, 3]);
    assert.equal(internals._lastGpuPoses[1], 0.75);
    assert.equal(internals._poseMachine.getPose(1), 0.75);
    const reused = object(12);
    b.register(reused);
    assert.equal(internals._poseMachine.getPose(2), 0);
    assert.equal(internals._lastGpuPoses[2], 0);
    for (const mesh of meshes) assert.equal(mesh.geometry.getAttribute('aPoseState').getX(2), 0);
    b.removeInstance(reused);
    updateInstancedBatchers({} as FrameContext);
    assert.equal(b.count, 2);
    b.dispose();
    assert.equal(d.userData.batchIndex, -1);
    assert.ok(meshes.every(mesh => mesh.parent === null));
    b.register(a);
    assert.equal(b.count, 1);
    assert.equal(a.userData.batchIndex, 0);
    b.dispose();
});

test('flower part capacity returns no slot and counts drops once', () => {
    const b = flowerBatcher;
    b.dispose();
    const original = console.warn;
    let warnings = 0;
    console.warn = () => { warnings++; };
    try {
        b.init();
        const capacity = b.getLODMeshes()[0].instanceMatrix.count;
        for (let i = 0; i < capacity; i++) b.register(object(i), 'none');
        const extra = object(capacity + 1);
        assert.equal(b.register(extra, 'none'), undefined);
        assert.equal(extra.userData.batchIndex, -1);
        assert.equal(b.getLODMeshes()[0].count, capacity);
        assert.equal(b.dropped, 5);
        assert.equal(warnings, 1);
    } finally {
        console.warn = original;
        b.dispose();
    }
});

test('mixed flower shapes remove all owned parts after repeated swaps', () => {
    const b = flowerBatcher;
    b.dispose();
    const a = object(1), c = object(5), d = object(9);
    b.register(a, 'layered', { color: 0xff0000 });
    b.register(c, 'multi', { color: 0x00ff00 });
    b.register(d, 'layered', { color: 0x0000ff });
    const meshes = b.getLODMeshes();
    assert.deepEqual(meshes.map(m => m.count), [3, 3, 9, 20, meshes[4].count, 0]);
    (meshes[0].geometry.getAttribute('aPoseState').array as Float32Array)[2] = 0.7;
    b.removeInstance(a);
    assert.equal(d.userData.batchIndex, 0);
    assert.equal(position(meshes[0], 0).x, 9);
    assert.ok(Math.abs(meshes[0].geometry.getAttribute('aPoseState').getX(0) - 0.7) < 1e-6);
    assert.equal(meshes[3].count, 10);
    for (let i = 0; i < meshes[3].count; i++) assert.equal(meshes[3].instanceColor!.getZ(i), 1);
    b.removeInstance(d);
    b.removeInstance(c);
    assert.ok(meshes.every(m => m.count === 0));
    b.dispose();
    assert.ok(meshes.every(m => m.parent === null));
    b.register(a, 'spiral');
    assert.equal(b.getLODMeshes()[5].count, 10);
    b.dispose();
});

test('flower disposal removes LOD tracks and reinitialization tracks new meshes', () => {
    const b = flowerBatcher;
    b.dispose();
    const config = CONFIG.foliage.lod;
    const previous = { ...config };
    Object.assign(config, { enabled: true, useImpostors: false, heroMax: 10, midMax: 30, blendWidth: 2, blendSeconds: 0, farCull: 100 });
    try {
        b.register(object(50), 'simple');
        const old = b.getLODMeshes();
        assert.ok(old.every(mesh => mesh.userData.foliageLodTracked));
        b.dispose();
        assert.ok(old.every(mesh => !mesh.userData.foliageLodTracked));

        const oldAttr = old[0].geometry.getAttribute(INSTANCE_LOD_ATTR);
        oldAttr.setX(0, 0.25);
        old[0].count = 1;
        b.register(object(50), 'simple');
        const current = b.getLODMeshes();
        assert.ok(current.every(mesh => mesh.userData.foliageLodTracked));
        const camera = new THREE.PerspectiveCamera();
        updateFoliageBatcherLOD(camera, 1);
        assert.equal(oldAttr.getX(0), 0.25, 'disposed mesh is no longer updated');
        assert.equal(current[0].geometry.getAttribute(INSTANCE_LOD_ATTR).getX(0), 2);
    } finally {
        b.dispose();
        Object.assign(config, previous);
    }
});

test('simple flower capacity drops are counted and warned once', () => {
    const b = new SimpleFlowerBatcher();
    const original = console.warn;
    let warnings = 0;
    console.warn = () => { warnings++; };
    try {
        for (let i = 0; i < 1000; i++) b.register(object(i));
        const extra = object(1001);
        assert.equal(b.register(extra), undefined);
        b.register(object(1002));
        assert.equal(extra.userData.batchIndex, -1);
        assert.equal(b.count, 1000);
        assert.equal(b.dropped, 2);
        assert.equal(warnings, 1);
    } finally {
        console.warn = original;
        b.dispose();
    }
});
