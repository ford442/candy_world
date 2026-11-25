import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { LuminousPlantBatcher } from '../src/foliage/luminous-plant-batcher.ts';
import { CloudBatcher, getSharedCloudMaterial } from '../src/foliage/cloud-batcher.ts';
import { createCloud } from '../src/foliage/clouds.ts';
import { getPlatforms } from '../src/systems/ground-system.ts';
import { updateFoliageBatcherLOD } from '../src/systems/batcher-lod.ts';
import { despawnEntity } from '../src/world/entity-despawn.ts';

const frame = { dt: 0.016, rawDt: 0.016, time: 1 } as unknown as FrameContext;

function plant(id: number, x: number): THREE.Group {
    const obj = new THREE.Group();
    obj.position.set(x, 2, 3);
    obj.userData.persistentId = id;
    return obj;
}

function matrices(mesh: THREE.InstancedMesh, start: number, count: number): number[] {
    return Array.from(mesh.instanceMatrix.array.slice(start * 16, (start + count) * 16));
}

test('luminous slots preserve transforms, awakened and LOD streams through swap and reuse', () => {
    const b = new LuminousPlantBatcher(3);
    const a = plant(0, 1), middle = plant(10, 2), last = plant(20, 3);
    b.applyAwakenedBulk([{ persistentId: 20, scale: 2.5 }]);
    assert.equal(b.register(a), 0);
    assert.equal(b.register(middle), 1);
    assert.equal(b.register(last), 2);
    const mesh = b.mesh;
    const attr = mesh.geometry.attributes;
    const original = matrices(mesh, 2, 1);
    const phase = attr.aPhaseOffset.getX(2);
    attr.instanceLodFactor.setX(2, 0.75);
    assert.equal(attr.aEmissiveScale.getX(2), 2.5);

    b.removeInstance(middle);
    assert.equal(mesh.count, 2);
    assert.equal(last.userData.batchIndex, 1);
    assert.equal(middle.userData.batchIndex, undefined);
    assert.deepEqual(matrices(mesh, 1, 1), original);
    assert.equal(attr.aPhaseOffset.getX(1), phase);
    assert.equal(attr.instanceLodFactor.getX(1), 0.75);
    assert.equal(attr.aEmissiveScale.getX(1), 2.5);
    assert.ok(b.hasPersistentId(0));
    b.applyAwakenedBulk([{ persistentId: 20, scale: 3 }]);
    assert.equal(attr.aEmissiveScale.getX(1), 3);
    b.removeInstance(a);
    assert.equal(b.hasPersistentId(0), false);
    assert.equal(last.userData.batchIndex, 0);
    assert.equal(b.register(plant(30, 4)), 1);
    assert.equal(attr.instanceLodFactor.getX(1), 0);
    b.dispose();
    assert.equal(last.userData.batchIndex, undefined);
    assert.equal(b.instanceCount, 0);
    assert.equal(b.register(plant(40, 5)), 0);
    b.dispose();
});

test('luminous preserves parent and slope transforms and counts capacity drops once per warning', () => {
    const b = new LuminousPlantBatcher(1);
    const parent = new THREE.Group();
    parent.position.set(7, 0, 0);
    parent.updateMatrixWorld(true);
    const p = plant(1, 2);
    p.userData.groundSlopeQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
    parent.add(p);
    const q = p.quaternion.clone();
    assert.equal(b.register(p), 0);
    assert.equal(b.mesh.instanceMatrix.array[12], 9);
    assert.ok(p.quaternion.equals(q));
    const warn = console.warn;
    let warnings = 0;
    console.warn = () => { warnings++; };
    try {
        assert.equal(b.register(plant(2, 2)), -1);
        assert.equal(b.register(plant(3, 3)), -1);
        assert.equal(b.dropped, 2);
        assert.equal(warnings, 1);
    } finally { console.warn = warn; b.dispose(); }
});

test('luminous LOD unregisters disposed meshes and tracks each replacement independently', () => {
    const b = new LuminousPlantBatcher(2);
    const other = new LuminousPlantBatcher(1);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(200, 0, 0);
    camera.updateMatrixWorld();
    b.register(plant(41, 0));
    other.register(plant(42, 0));
    const oldMesh = b.mesh;
    const oldLod = oldMesh.geometry.getAttribute('instanceLodFactor');
    assert.equal(oldMesh.userData.foliageLodTracked, true);
    assert.equal(other.mesh.userData.foliageLodTracked, true);
    updateFoliageBatcherLOD(camera, 1);
    assert.ok(oldLod.getX(0) > 0);
    b.dispose();
    assert.equal(oldMesh.userData.foliageLodTracked, undefined);
    oldLod.setX(0, -1);
    b.register(plant(43, 0));
    assert.notEqual(b.mesh, oldMesh);
    assert.equal(b.mesh.userData.foliageLodTracked, true);
    updateFoliageBatcherLOD(camera, 1);
    assert.equal(oldLod.getX(0), -1);
    assert.ok(b.mesh.geometry.getAttribute('instanceLodFactor').getX(0) > 0);
    assert.ok(other.mesh.geometry.getAttribute('instanceLodFactor').getX(0) > 0);
    b.dispose();
    other.dispose();
});

test('luminous reattaches to its previous parent on reuse without attaching initially', () => {
    const b = new LuminousPlantBatcher(1);
    const scene = new THREE.Scene();
    assert.equal(b.mesh.parent, null);
    const oldMesh = b.mesh;
    scene.add(oldMesh);
    b.register(plant(61, 0));
    b.dispose();
    b.dispose();
    assert.equal(oldMesh.parent, null);
    b.register(plant(62, 1));
    assert.notEqual(b.mesh, oldMesh);
    assert.equal(b.mesh.parent, scene);
    b.mesh.removeFromParent();
    b.dispose();
    b.register(plant(63, 2));
    assert.equal(b.mesh.parent, null);
    b.dispose();
});

test('luminous slot uploads cannot restrict independent LOD or awakened updates', () => {
    const b = new LuminousPlantBatcher(3);
    b.register(plant(51, 0));
    b.applyAwakenedBulk([{ persistentId: 51, scale: 2 }]);
    const awakened = b.mesh.geometry.getAttribute('aAwakened');
    assert.ok(awakened.updateRanges.length > 0);
    b.register(plant(52, 1));
    assert.equal(awakened.updateRanges.length, 0);
    const lod = b.mesh.geometry.getAttribute('instanceLodFactor');
    assert.equal(lod.updateRanges.length, 0);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(200, 0, 0);
    camera.updateMatrixWorld();
    const version = lod.version;
    updateFoliageBatcherLOD(camera, 1);
    assert.ok(lod.version > version);
    assert.ok(lod.getX(0) > 0 && lod.getX(1) > 0);
    assert.equal(lod.updateRanges.length, 0);
    b.dispose();
});

test('cloud ranges stay contiguous after removal; movement runs once and walkable streams stay isolated', () => {
    const b = new CloudBatcher(9);
    const other = new CloudBatcher(4);
    const clouds = [new THREE.Group(), new THREE.Group(), new THREE.Group()];
    clouds[0].userData.isWalkable = true;
    clouds[1].position.x = 10;
    clouds[2].position.x = 20;
    clouds[2].userData.isWalkable = true;
    assert.equal(b.register(clouds[0], { puffCount: 2 }), 0);
    assert.equal(b.register(clouds[1], { puffCount: 3 }), 2);
    assert.equal(b.register(clouds[2], { puffCount: 4 }), 5);
    other.register(new THREE.Group(), { puffCount: 1 });
    assert.notEqual(b.mesh!.geometry, other.mesh!.geometry);
    assert.notEqual(b.isWalkableAttribute, other.isWalkableAttribute);
    const records = (b as unknown as { puffs: { recordAt(slot: number): unknown } }).puffs;
    const firstRecord = records.recordAt(0);
    const lastRecord = records.recordAt(5);
    const lastMatrices = matrices(b.mesh!, 5, 4);
    b.removeInstance(clouds[1]);
    assert.equal(b.count, 6);
    assert.equal(clouds[2].userData.batchStart, 2);
    assert.equal(clouds[2].userData.batchIndex, 2);
    assert.equal(records.recordAt(0), firstRecord);
    assert.equal(records.recordAt(2), lastRecord);
    assert.deepEqual(matrices(b.mesh!, 2, 4), lastMatrices);
    assert.deepEqual(Array.from(b.isWalkableAttribute!.array.slice(0, 6)), [1, 1, 1, 1, 1, 1]);
    let calls = 0;
    clouds[2].userData.onAnimate = () => { calls++; clouds[2].position.x++; };
    updateInstancedBatchers(frame);
    assert.equal(calls, 0);
    b.update(0.016);
    assert.equal(calls, 1);
    assert.notDeepEqual(matrices(b.mesh!, 2, 4), lastMatrices);
    b.removeInstance(clouds[2]);
    assert.equal(b.count, 2);
    const shared = getSharedCloudMaterial();
    let materialDisposals = 0, geometryDisposals = 0;
    shared.addEventListener('dispose', () => materialDisposals++);
    b.mesh!.geometry.addEventListener('dispose', () => geometryDisposals++);
    b.dispose();
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 0);
    assert.equal(b.mesh, null);
    assert.equal(clouds[0].userData.batchStart, undefined);
    assert.equal(b.register(new THREE.Group(), { puffCount: 1 }), 0);
    b.dispose();
    other.dispose();
});

test('cloud capacity is atomic and warns once for multiple rejected clouds', () => {
    const b = new CloudBatcher(2);
    const warn = console.warn;
    let warnings = 0;
    console.warn = () => { warnings++; };
    try {
        b.register(new THREE.Group(), { puffCount: 1 });
        const rejected = new THREE.Group();
        assert.equal(b.register(rejected, { puffCount: 2 }), -1);
        assert.equal(b.register(new THREE.Group(), { puffCount: 2 }), -1);
        assert.equal(b.count, 1);
        assert.equal(rejected.userData.batchStart, undefined);
        assert.equal(b.dropped, 2);
        assert.equal(warnings, 1);
    } finally { console.warn = warn; b.dispose(); }
});

test('cloud removal retains remaining non-walkable puffs and their last uploaded transforms', () => {
    const b = new CloudBatcher(5);
    const walkable = new THREE.Group();
    const decorative = new THREE.Group();
    walkable.userData.isWalkable = true;
    b.register(walkable, { puffCount: 2 });
    b.register(decorative, { puffCount: 3 });
    const original = matrices(b.mesh!, 2, 3);
    decorative.position.x = 100;
    b.removeInstance(walkable);
    assert.deepEqual(matrices(b.mesh!, 0, 3), original);
    assert.deepEqual(Array.from(b.isWalkableAttribute!.array.slice(0, 3)), [0, 0, 0]);
    b.update(0.016);
    assert.notDeepEqual(matrices(b.mesh!, 0, 3), original);
    b.dispose();
});

test('despawning a walkable cloud unregisters its platform and preserves the moved proxy', () => {
    const b = CloudBatcher.getWalkableInstance();
    const a = createCloud({ tier: 1, puffCount: 2 });
    const next = createCloud({ tier: 1, puffCount: 3 });
    a.userData.persistentId = 'parity-cloud-a';
    next.userData.persistentId = 'parity-cloud-b';
    a.userData.onPlacement();
    next.userData.onPlacement();
    assert.ok(getPlatforms().some((p) => p.id === 'cloud:parity-cloud-a'));
    assert.equal(despawnEntity(a), true);
    assert.ok(!getPlatforms().some((p) => p.id === 'cloud:parity-cloud-a'));
    assert.ok(getPlatforms().some((p) => p.id === 'cloud:parity-cloud-b'));
    assert.equal(next.userData.batchStart, 0);
    assert.equal(b.mesh!.count, 3);
    assert.equal(despawnEntity(next), true);
    assert.equal(b.mesh!.count, 0);
    assert.ok(!getPlatforms().some((p) => p.id === 'cloud:parity-cloud-b'));
    b.dispose();
});
