/**
 * Batcher parity (#2166): one row per batcher ported to InstancedBatcher.
 *
 * Each row spawns and despawns objects in a seeded random order, then checks
 * what the GPU would draw against the objects still alive:
 *   - every mesh's draw count equals the live count (nothing hidden but drawn,
 *     nothing live but undrawn)
 *   - each live object owns exactly one slot, found by its translation, in
 *     every mesh the batcher draws
 *   - the row's own per-slot data (color, params) matches that object
 *   - nothing past the draw count is uploaded as live data, and the meshes
 *     are the same objects throughout (no reallocation below capacity)
 *
 * Add a row when a batcher is ported. Run: npm run test:batchers
 */
import { test } from 'node:test';
import * as assert from 'node:assert';
import * as THREE from 'three';
import { updateInstancedBatchers } from '../src/core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../src/core/scheduler/types.ts';
import { dandelionBatcher } from '../src/foliage/dandelion-batcher.ts';
import { FaunaBatcher } from '../src/foliage/fauna-batcher.ts';
import { glowingFlowerBatcher } from '../src/foliage/glowing-flower-batcher.ts';
import { subwooferLotusBatcher } from '../src/foliage/subwoofer-lotus-batcher.ts';
import { FaunaSpecies } from '../src/systems/fauna/types.ts';
import { KickDrumGeyserBatcher } from '../src/foliage/kick-drum-geyser-batcher.ts';
import { gemFruitBatcher } from '../src/foliage/gem-fruit-batcher.ts';
import { GlassMushroomBatcher } from '../src/foliage/glass-mushroom-batcher.ts';
import { lanternBatcher } from '../src/foliage/lantern-batcher.ts';
import { mushroomBatcher } from '../src/foliage/mushroom-batcher/index.ts';
import { sugarCaveBatcher } from '../src/foliage/sugar-cave-batcher.ts';
import { TreeBatcher } from '../src/foliage/tree-batcher/index.ts';
import { buildTestTree, TEST_TREE_LEAF_Y } from './support/tree-fixture.ts';
import { waterfallBatcher } from '../src/foliage/waterfall-batcher.ts';
import './batcher-parity-debris-market.test.ts';
import './batcher-parity-luminous-cloud.test.ts';
import './batcher-parity-flowers.test.ts';
import './batcher-parity-arpeggio-portamento.test.ts';

const ctx = { dt: 0.016, rawDt: 0.016, time: 1, audio: {} } as unknown as FrameContext;

/** mulberry32: a deterministic sequence per row. */
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

interface Row {
    name: string;
    capacity: number;
    register(obj: THREE.Object3D, i: number): void;
    remove(obj: THREE.Object3D): void;
    meshes(): THREE.InstancedMesh[];
    /** Instances each live object owns in mesh m (default 1). */
    perSlot?(m: number): number;
    /** Where mesh m puts the object's instance (default: obj.position). */
    translation?(obj: THREE.Object3D, i: number, m: number): THREE.Vector3 | null;
    /** Per-slot checks beyond the matrix translation. */
    check?(obj: THREE.Object3D, slot: number, i: number): void;
    reset(): void;
}

const colorOf = (i: number) => [0xff0000, 0x00ff00, 0x0000ff, 0xffa500][i % 4];

/** instanceColor holds Float32; compare against the hex's linear RGB within f32 precision. */
function assertColor(attr: THREE.BufferAttribute, slot: number, hex: number) {
    const c = new THREE.Color(hex);
    const got = [attr.getX(slot), attr.getY(slot), attr.getZ(slot)];
    const want = [c.r, c.g, c.b];
    for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(got[k] - want[k]) < 1e-6, `slot ${slot} color ${got} != ${want}`);
    }
}

const rows: Row[] = [
    (() => {
        // A flowering tree: a trunk at the group origin and a leaf ball above it.
        const b = new TreeBatcher(64);
        return {
            name: 'TreeBatcher',
            capacity: b.capacity,
            register: (obj, i) => b.register(buildTestTree(obj, colorOf(i)), 'floweringTree'),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.trunks, b.spheres],
            translation: (obj, _i, m) =>
                m === 0
                    ? obj.position
                    : obj.position.clone().setY(obj.position.y + TEST_TREE_LEAF_Y),
            check: (_obj, slot, i) => assertColor(b.trunks.instanceColor!, slot, colorOf(i)),
            reset: () => {
                b.dispose();
                b.init();
            },
        };
    })(),
    (() => {
        const b = lanternBatcher;
        return {
            name: 'LanternBatcher',
            capacity: b.maxInstances,
            register: (obj, i) =>
                b.register(obj, { height: 1 + i * 0.25, color: colorOf(i), spawnTime: i }),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.topMesh!, b.stemMesh!],
            check: (_obj, slot, i) => {
                assertColor(b.topMesh!.instanceColor!, slot, colorOf(i));
                const top = b.topMesh!.geometry.getAttribute(
                    'instanceParams'
                ) as THREE.InstancedBufferAttribute;
                const stem = b.stemMesh!.geometry.getAttribute(
                    'instanceParams'
                ) as THREE.InstancedBufferAttribute;
                assert.equal(top.getX(slot), 1 + i * 0.25, 'top height');
                assert.equal(top.getW(slot), i, 'top spawnTime');
                assert.equal(stem.getX(slot), 1 + i * 0.25, 'stem height');
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        let b = new KickDrumGeyserBatcher();
        return {
            name: 'KickDrumGeyserBatcher',
            capacity: 500,
            register: (obj, i) => b.register(obj, { maxHeight: 2 + i }),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.baseMesh, b.coreMesh, b.plumeMesh],
            reset: () => {
                b.dispose();
                b = new KickDrumGeyserBatcher();
            },
        };
    })(),
    (() => {
        const b = mushroomBatcher;
        return {
            name: 'MushroomBatcher',
            capacity: b.maxInstances,
            register: (obj, i) => b.register(obj, { noteColor: colorOf(i), noteIndex: i % 12 }),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.mesh!],
            check: (_obj, slot, i) => {
                assertColor(b.mesh!.instanceColor!, slot, colorOf(i));
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        const b = waterfallBatcher;
        const SPLASHES = 8;
        const heightOf = (i: number) => 3 + (i % 5);
        return {
            name: 'WaterfallBatcher',
            capacity: b.maxInstances,
            register: (obj, i) => b.add(obj.uuid, obj.position, heightOf(i), 2),
            remove: (obj) => b.remove(obj.uuid),
            meshes: () => [b.mesh!, b.splashMesh!],
            perSlot: (m) => (m === 1 ? SPLASHES : 1),
            // The column stores its mid point; splashes are placed by TSL.
            translation: (obj, i, m) =>
                m === 0 ? obj.position.clone().setY(obj.position.y - heightOf(i) / 2) : null,
            check: (obj, slot, i) => {
                const origin = b.splashMesh!.geometry.getAttribute('aOrigin');
                for (let k = 0; k < SPLASHES; k++) {
                    const s = slot * SPLASHES + k;
                    assert.ok(
                        Math.abs(origin.getY(s) - (obj.position.y - heightOf(i))) < 1e-5,
                        'splash at the foot'
                    );
                    assert.ok(
                        Math.abs(origin.getX(s) - obj.position.x) <= 1 + 1e-5,
                        'splash within the width'
                    );
                }
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        const b = sugarCaveBatcher;
        return {
            name: 'SugarCaveBatcher',
            capacity: 150,
            register: (obj, i) => {
                obj.scale.setScalar(1 + (i % 3));
                b.register(obj);
            },
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.mesh!],
            check: (obj, slot) => {
                // Ribs are scaled (0.5, 1, 0.5) × scale.y.
                const m = new THREE.Matrix4().fromArray(b.mesh!.instanceMatrix.array, slot * 16);
                const sc = new THREE.Vector3().setFromMatrixScale(m);
                assert.ok(
                    Math.abs(sc.y - obj.scale.y) < 1e-5 && Math.abs(sc.x - obj.scale.y * 0.5) < 1e-5
                );
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        let b = new GlassMushroomBatcher(64);
        return {
            name: 'GlassMushroomBatcher',
            capacity: 64,
            register: (obj) => void b.register(obj),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.mesh!],
            reset: () => {
                b.dispose();
                b = new GlassMushroomBatcher(64);
            },
        };
    })(),
    (() => {
        const b = dandelionBatcher;
        return {
            name: 'DandelionBatcher',
            capacity: 500,
            register: (obj, i) => b.register(obj, { scale: 1 + (i % 3) * 0.5 }),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.mesh!],
            check: (obj, slot, i) => {
                assert.equal(obj.userData.batchIndex, slot, 'batchIndex is the slot');
                const m = new THREE.Matrix4().fromArray(b.mesh!.instanceMatrix.array, slot * 16);
                const sc = new THREE.Vector3().setFromMatrixScale(m);
                assert.ok(Math.abs(sc.x - (1 + (i % 3) * 0.5)) < 1e-5, 'scale');
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        const b = subwooferLotusBatcher;
        return {
            name: 'SubwooferLotusBatcher',
            capacity: b.maxInstances,
            register: (obj, i) => b.register(obj, { scale: 1 + (i % 3) * 0.5 }),
            remove: (obj) => b.removeInstance(obj),
            meshes: () => [b.padMesh, b.ringsMesh, b.centerMesh],
            check: (obj, slot, i) => {
                const s = 1 + (i % 3) * 0.5;
                assert.equal(obj.userData.batchIndex, slot, 'batchIndex is the slot');
                const pad = new THREE.Matrix4().fromArray(b.padMesh.instanceMatrix.array, slot * 16);
                const sc = new THREE.Vector3().setFromMatrixScale(pad);
                assert.ok(Math.abs(sc.x - 1.5 * s) < 1e-5 && Math.abs(sc.y - 0.2 * s) < 1e-5, 'pad');
                const ring = new THREE.Matrix4().fromArray(b.ringsMesh.instanceMatrix.array, slot * 16);
                assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(ring).x - s) < 1e-5, 'rings');
            },
            reset: () => b.dispose(),
        };
    })(),
    (() => {
        const b = glowingFlowerBatcher;
        return {
            name: 'GlowingFlowerBatcher',
            capacity: b.maxInstances,
            register: (obj, i) => b.register(obj, { color: colorOf(i) }),
            remove: (obj) => b.removeInstance(obj),
            // The stem sits at the object; head and wash sit above it.
            meshes: () => [b.stemMesh!, b.headMesh!, b.washMesh!],
            translation: (obj, _i, m) => (m === 0 ? obj.position : null),
            check: (obj, slot, i) => {
                for (const mesh of [b.headMesh!, b.washMesh!]) {
                    const a = mesh.instanceMatrix.array;
                    assert.ok(Math.abs(a[slot * 16 + 12] - obj.position.x) < 1e-4, 'x');
                    assert.ok(Math.abs(a[slot * 16 + 14] - obj.position.z) < 1e-4, 'z');
                    const rise = a[slot * 16 + 13] - obj.position.y;
                    assert.ok(rise >= 0.6 - 1e-4 && rise <= 1.0 + 1e-4, `rise ${rise}`);
                    assertColor(mesh.instanceColor!, slot, colorOf(i));
                }
                assertColor(b.stemMesh!.instanceColor!, slot, colorOf(i));
            },
            reset: () => b.dispose(),
        };
    })(),
];

function slotByTranslation(mesh: THREE.InstancedMesh, p: THREE.Vector3): number[] {
    const a = mesh.instanceMatrix.array;
    const hits: number[] = [];
    for (let s = 0; s < mesh.count; s++) {
        if (
            Math.abs(a[s * 16 + 12] - p.x) < 1e-4 &&
            Math.abs(a[s * 16 + 13] - p.y) < 1e-4 &&
            Math.abs(a[s * 16 + 14] - p.z) < 1e-4
        ) {
            hits.push(s);
        }
    }
    return hits;
}

function verify(row: Row, live: Map<THREE.Object3D, number>, label: string) {
    updateInstancedBatchers(ctx);
    for (const [m, mesh] of row.meshes().entries()) {
        assert.equal(
            mesh.count,
            live.size * (row.perSlot?.(m) ?? 1),
            `${label}: mesh ${m} draw count`
        );
    }
    for (const [obj, i] of live) {
        for (const [m, mesh] of row.meshes().entries()) {
            const at = row.translation ? row.translation(obj, i, m) : obj.position;
            if (!at) continue;
            const hits = slotByTranslation(mesh, at);
            assert.equal(
                hits.length,
                1,
                `${label}: object ${i} in mesh ${m} has ${hits.length} slots`
            );
            if (m === 0) row.check?.(obj, hits[0], i);
        }
    }
}

for (const row of rows) {
    test(`${row.name}: spawn/despawn parity`, () => {
        row.reset();
        const rand = rng(0x2166 + row.name.length);
        const live = new Map<THREE.Object3D, number>();
        let next = 0;
        const spawn = (n: number) => {
            // Clamp to capacity: CI and low-memory runs shrink some batchers.
            for (let k = 0; k < n && live.size < row.capacity; k++) {
                const obj = new THREE.Object3D();
                // Distinct translations so slots are identified unambiguously.
                obj.position.set(next * 3 + 0.5, (next % 7) * 0.25, -next * 2);
                obj.updateMatrixWorld();
                row.register(obj, next);
                live.set(obj, next++);
            }
        };
        const despawn = (n: number) => {
            for (let k = 0; k < n && live.size; k++) {
                const objs = [...live.keys()];
                const obj = objs[Math.floor(rand() * objs.length)];
                row.remove(obj);
                live.delete(obj);
            }
        };

        spawn(24);
        const meshes = row.meshes();
        verify(row, live, 'after 24 spawns');
        despawn(9);
        verify(row, live, 'after 9 random despawns');
        spawn(12);
        verify(row, live, 'after 12 more spawns');
        despawn(live.size - 3);
        verify(row, live, 'down to 3');
        despawn(3);
        verify(row, live, 'empty');
        spawn(5);
        verify(row, live, 'refilled');
        assert.deepEqual(row.meshes(), meshes, 'meshes were reallocated below capacity');

        // Despawning an object twice, or one never registered, changes nothing.
        const [first] = live.keys();
        row.remove(first);
        live.delete(first);
        row.remove(first);
        row.remove(new THREE.Object3D());
        verify(row, live, 'after double remove');

        // dispose() frees what the renderer counts in info.memory (a geometry
        // 'dispose' event is what decrements it) and detaches every mesh.
        const geometries = new Set(row.meshes().map((m) => m.geometry));
        let freed = 0;
        for (const g of geometries) g.addEventListener('dispose', () => freed++);
        const drawn = row.meshes();
        row.reset();
        assert.equal(freed, geometries.size, 'every geometry disposed');
        assert.ok(
            drawn.every((m) => m.parent === null),
            'every mesh detached'
        );
    });
}

test('GemFruitBatcher: refs follow swaps across random tree attach/remove', () => {
    const rand = rng(0x6e3);
    const trees = new Map<THREE.Object3D, Float32Array[]>();
    const total = () => gemFruitBatcher.meshes.reduce((n, m) => n + m.count, 0);
    const base = total();
    const matrixAt = (gemType: number, slot: number) =>
        gemFruitBatcher.meshes[gemType].instanceMatrix.array.slice(
            slot * 16,
            slot * 16 + 16
        ) as Float32Array;

    const check = (label: string) => {
        updateInstancedBatchers(ctx);
        let refs = 0;
        for (const [tree, want] of trees) {
            const got = tree.userData.gemRefs as { gemType: number; instanceIndex: number }[];
            refs += got.length;
            got.forEach((r, k) =>
                assert.deepEqual(
                    Array.from(matrixAt(r.gemType, r.instanceIndex)),
                    Array.from(want[k]),
                    `${label}: ref ${k}`
                )
            );
        }
        assert.equal(total() - base, refs, `${label}: draw count == live refs`);
    };

    for (let round = 0; round < 6; round++) {
        for (let k = 0; k < 8; k++) {
            const tree = new THREE.Group();
            tree.position.set(rand() * 100, 0, rand() * 100);
            const { refs } = gemFruitBatcher.attachToTree(tree, { gemCount: 3 + (k % 4) });
            trees.set(
                tree,
                refs.map((r) => matrixAt(r.gemType!, r.instanceIndex))
            );
        }
        check(`round ${round} attach`);
        for (const tree of [...trees.keys()]) {
            if (rand() < 0.5) {
                gemFruitBatcher.removeInstance(tree);
                trees.delete(tree);
            }
        }
        check(`round ${round} remove`);
    }
    // Awakening a gem survives the swaps that later removals cause.
    const [first] = trees.keys();
    const ref = (first.userData.gemRefs as { gemType: number; instanceIndex: number }[])[0];
    gemFruitBatcher.setAwakened(ref.gemType, ref.instanceIndex, 0.7);
    for (const tree of [...trees.keys()].slice(1)) {
        gemFruitBatcher.removeInstance(tree);
        trees.delete(tree);
    }
    const aw = gemFruitBatcher.meshes[ref.gemType].geometry.getAttribute('aEmissiveScale');
    assert.ok(
        Math.abs(aw.getX(ref.instanceIndex) - 0.7) < 1e-6,
        'awakened gem kept its emissive scale'
    );
    check('after awaken');
    for (const tree of [...trees.keys()]) gemFruitBatcher.removeInstance(tree);
    assert.equal(total(), base);
});

test('GlassMushroomBatcher: updateObject after a swap moves the right instance', () => {
    const b = new GlassMushroomBatcher(8);
    const objs = [0, 1, 2].map((i) => {
        const o = new THREE.Object3D();
        o.position.set(i * 10, 0, 0);
        b.register(o);
        return o;
    });
    const staleIndex = 2; // what register() returned for objs[2]
    b.removeInstance(objs[0]); // objs[2] moves into slot 0
    objs[2].scale.setScalar(1.2);
    objs[2].updateMatrixWorld(true);
    b.updateObject(objs[2], objs[2].matrixWorld);
    const a = b.mesh!.instanceMatrix.array;
    assert.equal(b.mesh!.count, 2);
    assert.ok(Math.abs(a[0] - 1.2) < 1e-6, 'objs[2] (now slot 0) was scaled');
    assert.equal(a[16 + 12], 10, 'objs[1] untouched');
    // The old index-based call is out of range now and changes nothing.
    b.updateInstance(staleIndex, new THREE.Matrix4());
    assert.equal(a[16 + 12], 10);
    b.dispose();
});

test('DandelionBatcher: a harvested head stays hidden through swaps', () => {
    const b = dandelionBatcher;
    b.dispose();
    const objs = [0, 1, 2, 3].map((i) => {
        const o = new THREE.Object3D();
        o.position.set(i * 10 + 1, 0, 0);
        b.register(o);
        return o;
    });
    b.harvest(objs[3].userData.batchIndex); // last slot, harvested
    b.removeInstance(objs[0]); // objs[3] moves into slot 0
    updateInstancedBatchers(ctx);
    assert.equal(objs[3].userData.batchIndex, 0, 'harvested head follows the swap');
    const a = b.mesh!.instanceMatrix.array;
    assert.equal(a[0], 0, 'still scaled to zero');
    assert.equal(a[5], 0);
    assert.equal(a[16 + 12], 11, 'objs[1] untouched');
    assert.equal(objs[0].userData.batchIndex, -1, 'removed object is unmapped');
    b.dispose();
});

test('SubwooferLotusBatcher: updateInstance and the interactive stand-in follow swaps', () => {
    const b = subwooferLotusBatcher;
    b.dispose();
    const objs = [0, 1, 2].map((i) => {
        const o = new THREE.Object3D();
        o.position.set(i * 10, 0, 0);
        b.register(o);
        return o;
    });
    const group2 = objs[2].userData.interactiveGroup as THREE.Group;
    b.removeInstance(objs[0]); // objs[2] moves into slot 0
    assert.equal(objs[2].userData.batchIndex, 0);
    objs[2].position.set(99, 0, 0);
    b.updateInstance(objs[2].userData.batchIndex, objs[2]);
    assert.equal(b.padMesh.instanceMatrix.array[12], 99, 'moved the swapped instance');
    assert.equal(b.padMesh.instanceMatrix.array[16 + 12], 10, 'objs[1] untouched');
    assert.equal(group2.position.x, 99, 'stand-in follows its lotus');
    assert.equal(objs[0].userData.interactiveGroup.parent, null, 'removed stand-in detached');
    b.dispose();
});

test('FaunaBatcher: keyed slots, poses and phases follow swap-removes per species', () => {
    const fb = FaunaBatcher.getInstance();
    fb.init();
    const rand = rng(0xfa17a);
    for (const species of [FaunaSpecies.GumdropBeetle, FaunaSpecies.JellybeanHopper, FaunaSpecies.SugarMoth]) {
        const mesh = fb.getMeshes()[species];
        const cap = mesh.instanceMatrix.count;
        const live = new Map<number, { x: number; phase: number }>();
        let nextSlot = 0;
        const phaseAttr = () => mesh.geometry.getAttribute('aPhase');
        const check = (label: string) => {
            updateInstancedBatchers(ctx);
            assert.equal(mesh.count, live.size, `${label}: draw count`);
            for (const [slot, want] of live) {
                const hits = slotByTranslation(mesh, new THREE.Vector3(want.x, 0, 0));
                assert.equal(hits.length, 1, `${label}: critter ${slot} has ${hits.length} slots`);
                assert.equal(phaseAttr().getX(hits[0]), want.phase, `${label}: phase`);
            }
        };
        const add = (n: number) => {
            for (let k = 0; k < n && live.size < cap; k++) {
                const slot = nextSlot++;
                const x = slot * 2 + 0.5;
                const idx = fb.addInstance(species, x, 0, 0, 'global', slot * 0.25, slot);
                assert.ok(idx >= 0 && idx < live.size + 1, 'returns an instance index');
                live.set(slot, { x, phase: slot * 0.25 });
            }
        };
        const drop = (n: number) => {
            for (let k = 0; k < n && live.size; k++) {
                const slots = [...live.keys()];
                const slot = slots[Math.floor(rand() * slots.length)];
                fb.removeInstance(species, slot);
                live.delete(slot);
            }
        };
        add(Math.min(12, cap));
        check('added');
        drop(5);
        check('after drops');
        // Pose a critter after swaps: its matrix and phase are what the swap-removes must keep.
        const [slot] = live.keys();
        const posed = new THREE.Matrix4().makeTranslation(500 + species, 0, 0);
        fb.setInstanceMatrix(species, slot, posed, 'global', 7);
        live.set(slot, { x: 500 + species, phase: 7 });
        check('posed');
        drop(2);
        add(4);
        check('after more churn');
        // Removing a slot twice, or one never added, changes nothing.
        const [again] = live.keys();
        fb.removeInstance(species, again);
        live.delete(again);
        fb.removeInstance(species, again);
        fb.removeInstance(species, 9999);
        check('double remove');
        drop(live.size);
        check('empty');
    }
    assert.equal(fb.getTotalCount(), 0);
});
