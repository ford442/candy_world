/**
 * @file foliage-ecs-bridge.ts
 * @brief Zero-copy ECS ↔ Emscripten animation batch bridge for foliage hot paths.
 *
 * Strategy
 * --------
 * Each simple animation type (shiver / spring / float / cloudBob) gets its own
 * ECS component with strideBytes = ENTRY_SIZE (24 bytes = 6 f32s), matching the
 * ENTRY_STRIDE layout that batchShiver_c / batchSpring_c / … already expect.
 *
 * When the C++ ECS is active and entities are registered via `registerEntity`,
 * `runBatch` can:
 *   1. Call ecsQueryComponents(typeMask) entirely in C++ — O(n) sequential scan
 *      of the alive-entity bitmask array, no JS iteration.
 *   2. Call ecsQueryComponentPointers(typeMask, compType, …) to get the slab
 *      base pointer for each matching entity.  Because all entities of one type
 *      share the same slab, iterating results is a single sequential memory walk.
 *   3. Pass the contiguous slab data to batchShiver_c / … directly — zero JS
 *      marshalling of per-entity animation inputs.
 *
 * Three.js property writes (rotation.z etc.) must still happen in JS because
 * Three.js object graphs are not accessible from WASM.
 *
 * Usage
 * -----
 *   const bridge = FoliageEcsBridge.getInstance();
 *   // During world generation (once per entity):
 *   const entityId = bridge.registerEntity(mesh, 'shiver');
 *   // Per frame (called from FoliageBatcher.flushSimpleBatches):
 *   bridge.runBatch('shiver', time, intensity);
 */

import { World } from './world.ts';
import { getNativeFunc, isEmscriptenReady, getEmscriptenInstance } from '../../utils/wasm-loader-core.ts';
import type { NativeComponentCodec, Component } from './types.ts';
import type { FoliageObject } from '../types.ts';

// Must match ENTRY_STRIDE=6 and RESULT_STRIDE=4 in animation_batch_utils.h
const ENTRY_STRIDE = 6;  // floats per input entry
const RESULT_STRIDE = 4; // floats per output entry
const ENTRY_SIZE = ENTRY_STRIDE * 4;  // bytes
const RESULT_SIZE = RESULT_STRIDE * 4; // bytes

export type SimpleAnimType = 'shiver' | 'spring' | 'float' | 'cloudBob';

// Animation-type → apply function that writes WASM results back to Three.js mesh
type ApplyFn = (obj: FoliageObject, results: Float32Array, offset: number) => void;

const APPLY_FNS: Record<SimpleAnimType, ApplyFn> = {
    shiver: (obj, data, offset) => {
        obj.rotation.z = data[offset];
        obj.rotation.x = data[offset + 1];
    },
    spring: (obj, data, offset) => {
        obj.scale.y = data[offset];
        obj.scale.x = data[offset + 1];
        obj.scale.z = data[offset + 2];
    },
    float: (obj, data, offset) => {
        obj.position.y = data[offset];
    },
    cloudBob: (obj, data, offset) => {
        obj.position.y = data[offset];
        obj.rotation.y = data[offset + 1];
    },
};

// Component shape — only used for the TypeScript codec; actual data is f32 packed.
interface FoliageAnimInput extends Component {
    animOffset: number;
    intensity: number;
    originalY: number;
    _pad0: number;
    _pad1: number;
    _pad2: number;
}

interface FoliageAnimResult extends Component {
    out0: number;
    out1: number;
    out2: number;
    out3: number;
}

function makeInputCodec(maxEntities: number): NativeComponentCodec<FoliageAnimInput> {
    return {
        strideBytes: ENTRY_SIZE,
        maxEntities,
        write(view, c) {
            view.setFloat32(0,  c.animOffset, true);
            view.setFloat32(4,  c.intensity,  true);
            view.setFloat32(8,  c.originalY,  true);
            view.setFloat32(12, c._pad0,      true);
            view.setFloat32(16, c._pad1,      true);
            view.setFloat32(20, c._pad2,      true);
        },
        read(view) {
            return {
                animOffset: view.getFloat32(0,  true),
                intensity:  view.getFloat32(4,  true),
                originalY:  view.getFloat32(8,  true),
                _pad0:      view.getFloat32(12, true),
                _pad1:      view.getFloat32(16, true),
                _pad2:      view.getFloat32(20, true),
            };
        },
    };
}

function makeResultCodec(maxEntities: number): NativeComponentCodec<FoliageAnimResult> {
    return {
        strideBytes: RESULT_SIZE,
        maxEntities,
        write(view, c) {
            view.setFloat32(0,  c.out0, true);
            view.setFloat32(4,  c.out1, true);
            view.setFloat32(8,  c.out2, true);
            view.setFloat32(12, c.out3, true);
        },
        read(view) {
            return {
                out0: view.getFloat32(0,  true),
                out1: view.getFloat32(4,  true),
                out2: view.getFloat32(8,  true),
                out3: view.getFloat32(12, true),
            };
        },
    };
}

interface TypeSlot {
    inputCompName:  string;
    resultCompName: string;
    entities: FoliageObject[];  // parallel array: entityId → mesh
    entityIds: number[];
    batchFnName: string;
    applyFn: ApplyFn;
}

const MAX_FOLIAGE_PER_TYPE = 4000;

export class FoliageEcsBridge {
    private static _instance: FoliageEcsBridge | null = null;

    private world: World;
    private slots: Record<SimpleAnimType, TypeSlot>;
    private ready = false;

    // Pre-allocated result buffer in Emscripten heap
    private resultPtr = 0;
    private resultBuf: Float32Array | null = null;
    private emMalloc: ((n: number) => number) | null = null;
    private emFree:   ((p: number) => void) | null = null;
    private emHeapF32: Float32Array | null = null;
    private emHeapU8:  Uint8Array  | null = null;

    private constructor() {
        this.world = new World();

        const types: SimpleAnimType[] = ['shiver', 'spring', 'float', 'cloudBob'];
        const batchFns: Record<SimpleAnimType, string> = {
            shiver:   'batchShiver_c',
            spring:   'batchSpring_c',
            float:    'batchFloat_c',
            cloudBob: 'batchCloudBob_c',
        };

        this.slots = {} as Record<SimpleAnimType, TypeSlot>;
        for (const t of types) {
            this.slots[t] = {
                inputCompName:  `FoliageAnim_${t}_Input`,
                resultCompName: `FoliageAnim_${t}_Result`,
                entities:  [],
                entityIds: [],
                batchFnName: batchFns[t],
                applyFn: APPLY_FNS[t],
            };
        }

        this._tryInit();
    }

    static getInstance(): FoliageEcsBridge {
        if (!FoliageEcsBridge._instance) {
            FoliageEcsBridge._instance = new FoliageEcsBridge();
        }
        return FoliageEcsBridge._instance;
    }

    /** True when the C++ ECS backend is ready and components are registered */
    isReady(): boolean { return this.ready; }

    /**
     * Register a foliage mesh as an ECS entity.
     * @returns The ECS entity ID, or -1 if the bridge is not active.
     */
    registerEntity(mesh: FoliageObject, animType: SimpleAnimType): number {
        if (!this.ready) return -1;
        const slot = this.slots[animType];

        const entityId = this.world.createEntity();
        const animOffset = (mesh.userData.animationOffset as number) ?? 0;
        const originalY  = (mesh.userData.originalY    as number) ?? mesh.position.y;

        this.world.addComponent(entityId, slot.inputCompName, {
            animOffset,
            intensity: 1.0,
            originalY,
            _pad0: 0, _pad1: 0, _pad2: 0,
        } satisfies FoliageAnimInput);

        this.world.addComponent(entityId, slot.resultCompName, {
            out0: 0, out1: 0, out2: 0, out3: 0,
        } satisfies FoliageAnimResult);

        slot.entities.push(mesh);
        slot.entityIds.push(entityId);
        return entityId;
    }

    /**
     * Hot-path: iterate all registered entities of animType entirely through C++.
     *
     * Flow:
     *   1. Update per-entity intensity in the input slab (one DataView write per entity).
     *   2. C++ ecsQueryComponentPointers returns the slab base pointer — O(n) C++ scan.
     *   3. C++ batchShiver_c / … operates on the slab in-place — zero extra copies.
     *   4. JS applies output floats to Three.js mesh properties.
     *
     * @returns number of entities processed, or -1 if bridge not active.
     */
    runBatch(animType: SimpleAnimType, time: number, intensity: number): number {
        if (!this.ready || !this.emHeapF32 || !this.resultBuf) return -1;
        const slot = this.slots[animType];
        if (slot.entities.length === 0) return 0;

        const count = slot.entities.length;

        // Step 1 — refresh per-entity intensity in the C++ input slab
        // We use queryNativeTable to get the slab pointers, then write intensity.
        const table = this.world.queryNativeTable([slot.inputCompName]);
        if (!table || table.count !== count) return -1;

        const inputPtrs = table.pointers[slot.inputCompName];
        const heapU8    = this.emHeapU8!;

        for (let i = 0; i < count; i++) {
            const ptr = inputPtrs[i];
            // Float32 offset 1 (bytes 4-7) = intensity field
            heapU8[ptr + 4]  =  (intensity * 1000 | 0) & 0xFF;
            const view = new DataView(heapU8.buffer, ptr, ENTRY_SIZE);
            view.setFloat32(4, intensity, true);
        }

        // Step 2 — get the input slab base pointer for the first entity.
        // Because entities were registered sequentially their slab slots are
        // contiguous; the base pointer of slot[0] is the start of the dense array.
        const slabBase = inputPtrs[0];

        // Step 3 — call the C++ batch animation function on the slab.
        const batchFn = getNativeFunc(slot.batchFnName);
        if (!batchFn) return -1;

        batchFn(slabBase, count, time, intensity, this.resultPtr);

        // Step 4 — apply results to Three.js meshes.
        const results = this.resultBuf;
        const applyFn = slot.applyFn;
        for (let i = 0; i < count; i++) {
            applyFn(slot.entities[i], results, i * RESULT_STRIDE);
        }

        return count;
    }

    /** Remove all registered entities (call on scene teardown). */
    clear(): void {
        // ⚡ OPTIMIZATION: Use for-in loop to prevent Object.keys() GC spikes
        for (const t in this.slots) {
            const type = t as SimpleAnimType;
            const slot = this.slots[type];
            for (const id of slot.entityIds) this.world.destroyEntity(id);
            slot.entities.length  = 0;
            slot.entityIds.length = 0;
        }
    }

    // -------------------------------------------------------------------------

    private _tryInit(): void {
        if (!isEmscriptenReady()) return;
        if (!this.world.isUsingCpp()) return;

        try {
            const emInst = getEmscriptenInstance() as any;
            this.emMalloc  = emInst?._malloc;
            this.emFree    = emInst?._free;
            this.emHeapF32 = emInst?.HEAPF32 as Float32Array;
            this.emHeapU8  = emInst?.HEAPU8  as Uint8Array;

            if (!this.emMalloc || !this.emHeapF32 || !this.emHeapU8) return;

            // Allocate a result buffer large enough for MAX_FOLIAGE_PER_TYPE results
            this.resultPtr = this.emMalloc(MAX_FOLIAGE_PER_TYPE * RESULT_SIZE);
            if (!this.resultPtr) return;

            // Create a persistent Float32Array view over the result buffer
            this.resultBuf = new Float32Array(
                this.emHeapF32.buffer,
                this.resultPtr,
                MAX_FOLIAGE_PER_TYPE * RESULT_STRIDE
            );

            // Register native components for each animation type
            // ⚡ OPTIMIZATION: Use for-in loop to prevent Object.keys() GC spikes
            for (const t in this.slots) {
                const type = t as SimpleAnimType;
                const slot = this.slots[type];
                const inputOk  = this.world.registerNativeComponent(
                    slot.inputCompName, makeInputCodec(MAX_FOLIAGE_PER_TYPE));
                const resultOk = this.world.registerNativeComponent(
                    slot.resultCompName, makeResultCodec(MAX_FOLIAGE_PER_TYPE));
                if (!inputOk || !resultOk) return;
            }

            this.ready = true;
            console.log('[FoliageEcsBridge] C++ ECS animation hot path active');
        } catch {
            this.ready = false;
        }
    }
}
