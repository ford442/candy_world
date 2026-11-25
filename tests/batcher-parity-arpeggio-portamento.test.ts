import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { ArpeggioFernBatcher } from '../src/foliage/arpeggio-batcher.ts';
import { PortamentoPineBatcher } from '../src/foliage/portamento-batcher.ts';
import { getGroundAlignedQuaternion } from '../src/world/placement-utils.ts';

const ctx = { dt: 0.016, rawDt: 0.016, time: 1 } as FrameContext;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

for (const kind of ['fern', 'pine'] as const) {
    test(`${kind}: dense slots, streams, updates, capacity and reuse`, () => {
        const batcher = kind === 'fern' ? new ArpeggioFernBatcher() : new PortamentoPineBatcher();
        const objects: THREE.Object3D[] = [];
        const register = (obj: THREE.Object3D, i: number) => kind === 'fern'
            ? (batcher as ArpeggioFernBatcher).register(obj, { color: i % 2 ? 0x00ff00 : 0xff0000, scale: 1 + i * 0.01 })
            : (batcher as PortamentoPineBatcher).register(obj);
        const validate = () => {
            for (const mesh of batcher.meshes) {
                assert.equal(mesh.count, objects.length);
                for (let i = 0; i < objects.length; i++) {
                    const matrix = new THREE.Matrix4();
                    mesh.getMatrixAt(i, matrix);
                    const expected = new THREE.Matrix4().compose(
                        objects[i].position,
                        getGroundAlignedQuaternion(objects[i], new THREE.Quaternion()),
                        objects[i].scale
                    );
                    matrix.elements.forEach((value, component) => close(value, expected.elements[component]));
                    assert.equal(objects[i].userData.batchIndex, i);
                }
            }
        };
        try {
            for (let i = 0; i < 12; i++) {
                const obj = new THREE.Object3D();
                obj.position.x = i + 1;
                obj.rotation.y = i * 0.1;
                if (kind === 'pine') obj.scale.set(1 + i * 0.1, 2, 0.5);
                assert.equal(register(obj, i), kind === 'fern' ? undefined : i);
                objects.push(obj);
            }
            const meshes = batcher.meshes;
            if (kind === 'pine') {
                const pine = batcher as PortamentoPineBatcher;
                pine.logicPines[11].userData.reactivityState.currentBend = 0.75;
                pine.update(1, null, 0);
                assert.notEqual(pine.bendAttribute!.getX(11), 0);
            }
            for (const index of [2, 6, 0]) {
                const removed = objects[index];
                batcher.removeInstance(removed);
                objects[index] = objects[objects.length - 1];
                objects.pop();
                assert.equal(removed.userData.batchIndex, undefined);
                batcher.removeInstance(removed);
                validate();
            }
            assert.deepEqual(batcher.meshes, meshes);
            if (kind === 'fern') {
                const color = (batcher as ArpeggioFernBatcher).mesh!.instanceColor!;
                for (const obj of objects) {
                    const original = obj.position.x - 1;
                    const expected = new THREE.Color(original % 2 ? 0x00ff00 : 0xff0000);
                    close(color.getX(obj.userData.batchIndex), expected.r);
                    close(color.getY(obj.userData.batchIndex), expected.g);
                }
            } else {
                const pine = batcher as PortamentoPineBatcher;
                assert.notEqual(pine.bendAttribute!.getX(objects.findIndex(o => o.position.x === 12)), 0);
            }
            objects[0].position.x = 999;
            batcher.updateInstance(0, objects[0]);
            updateInstancedBatchers(ctx);
            validate();

            while (objects.length < batcher.maxInstances) {
                const obj = new THREE.Object3D();
                register(obj, objects.length);
                objects.push(obj);
            }
            const oldWarn = console.warn;
            let warnings = 0;
            console.warn = () => { warnings++; };
            try {
                assert.equal(register(new THREE.Object3D(), 0), undefined);
                assert.equal(register(new THREE.Object3D(), 0), undefined);
            } finally {
                console.warn = oldWarn;
            }
            assert.equal(warnings, 1);
            assert.equal(batcher.dropped, 2);
            assert.equal(batcher.count, batcher.maxInstances);
            assert.deepEqual(batcher.meshes, meshes);
            const disposed: string[] = [];
            for (const mesh of meshes) {
                mesh.geometry.addEventListener('dispose', () => disposed.push('geometry'));
                (mesh.material as THREE.Material).addEventListener('dispose', () => disposed.push('material'));
            }
            batcher.dispose();
            assert.equal(disposed.length, meshes.length * 2);
            assert.ok(meshes.every(mesh => mesh.parent === null));
            assert.ok(objects.every(obj => obj.userData.batchIndex === undefined));
            assert.equal(batcher.count, 0);
            assert.equal(batcher.dropped, 0);
            const fresh = new THREE.Object3D();
            register(fresh, 0);
            assert.equal(fresh.userData.batchIndex, 0);
            assert.equal(batcher.count, 1);
        } finally {
            batcher.dispose();
        }
    });
}

test('scheduler flushes but does not advance music or spring poses', () => {
    const fern = new ArpeggioFernBatcher();
    const pine = new PortamentoPineBatcher();
    try {
        fern.register(new THREE.Object3D());
        const obj = new THREE.Object3D();
        pine.register(obj);
        const audio = { channelData: [{ activeEffect: 4, trigger: 1 }] };
        fern.update(audio, 0);
        pine.update(1, audio, 0);
        const unfurl = fern.globalUnfurl;
        const bend = obj.userData.reactivityState.currentBend;
        updateInstancedBatchers(ctx);
        assert.equal(fern.globalUnfurl, unfurl);
        assert.equal(obj.userData.reactivityState.currentBend, bend);
        fern.update(audio, 0);
        pine.update(2, audio, 0);
        assert.notEqual(fern.globalUnfurl, unfurl);
        assert.notEqual(obj.userData.reactivityState.currentBend, bend);
    } finally {
        fern.dispose();
        pine.dispose();
    }
});

test('pine envelopes follow a swap and a reused slot starts fresh', () => {
    const pine = new PortamentoPineBatcher();
    try {
        const objects = [new THREE.Object3D(), new THREE.Object3D(), new THREE.Object3D()];
        objects.forEach(obj => pine.register(obj));
        const audio = { channelData: [{}, {}, { volume: 1 }] };
        for (let i = 0; i < 10; i++) pine.update(i, audio, 0);
        const machines = (pine as unknown as { _poseMachines: Array<{ getPose(index: number): number }> })._poseMachines;
        const moved = machines[2];
        const pose = moved.getPose(0);
        assert.ok(pose > 0);
        pine.removeInstance(objects[0]);
        assert.equal(machines[0], moved);
        assert.equal(machines[0].getPose(0), pose);
        pine.register(new THREE.Object3D());
        assert.equal(machines[2].getPose(0), 0);
    } finally {
        pine.dispose();
    }
});
