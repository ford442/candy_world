/**
 * Fauna orchestration — ECS + WASM boids + instanced batcher sync.
 */

import * as THREE from 'three';
import { CONFIG, FEATURE_FLAGS } from '../../core/config.ts';
import { updateFaunaDebug, isFaunaDebugEnabled } from '../../debug/tools-stub.ts';
import { FaunaBatcher } from '../../foliage/fauna-batcher.ts';
import { World } from '../ecs/world.ts';
import { sampleGroundNormal } from '../ground-system.ts';
import { player } from '../physics/physics-types.ts';
import { FaunaBehaviorRunner, setFaunaScatterSink, type FaunaBehaviorStats } from './behavior.ts';
import {
    allocateBoidsBuffer,
    bindBoidsWasm,
    freeBoidsBuffer,
    updateBoidsBatch,
} from './boids-bridge.ts';
import { profiler } from '../../utils/profiler.ts';
import { spawnFaunaPopulation } from './spawn.ts';
import { FAUNA_BOID_STRIDE, FaunaSpecies, type FaunaSpawnEntry } from './types.ts';

const _up = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

export class FaunaSystem {
    private static _instance: FaunaSystem | null = null;

    readonly world = new World();
    private _bufferPtr = 0;
    private _heap: Float32Array | null = null;
    private _entries: FaunaSpawnEntry[] = [];
    private _count = 0;
    private _initialized = false;
    private _behavior: FaunaBehaviorRunner | null = null;
    private _stats: FaunaBehaviorStats | null = null;

    static getInstance(): FaunaSystem {
        if (!FaunaSystem._instance) {
            FaunaSystem._instance = new FaunaSystem();
        }
        return FaunaSystem._instance;
    }

    get count(): number {
        return this._count;
    }

    /** Last frame's state histogram — null while the state machine is off. */
    get behaviorStats(): FaunaBehaviorStats | null {
        return this._stats;
    }

    init(): void {
        if (this._initialized || !FEATURE_FLAGS.fauna || !CONFIG.fauna?.enabled) return;

        bindBoidsWasm();

        const maxCount = CONFIG.fauna?.maxInstances ?? 96;
        const alloc = allocateBoidsBuffer(maxCount);
        if (alloc) {
            this._bufferPtr = alloc.ptr;
            this._heap = alloc.view;
        } else {
            this._bufferPtr = 0;
            this._heap = new Float32Array(maxCount * FAUNA_BOID_STRIDE);
        }

        FaunaBatcher.getInstance().init();

        this._entries = spawnFaunaPopulation({
            world: this.world,
            buffer: this._heap,
            bufferByteOffset: this._bufferPtr,
            maxCount,
            seed: CONFIG.fauna?.seed ?? 42,
        });
        this._count = this._entries.length;

        const batcher = FaunaBatcher.getInstance();
        for (const { component } of this._entries) {
            const b = component.slot * FAUNA_BOID_STRIDE;
            batcher.addInstance(
                component.species,
                this._heap![b],
                this._heap![b + 1],
                this._heap![b + 2],
                component.biome,
                this._heap![b + 6],
                component.slot
            );
        }

        if (CONFIG.fauna?.behavior?.enabled !== false) {
            this._behavior = new FaunaBehaviorRunner(CONFIG.fauna?.behavior?.seed ?? 0xfa);
            this._behavior.resize(this._count);
            installScatterSink();
        }

        this._initialized = true;
        publishFaunaCount(this._count);
        console.log(`[Fauna] Spawned ${this._count} ambient critters (cap ${maxCount})`);
    }

    update(dt: number, time: number): void {
        if (!this._initialized || !this._heap || this._count === 0) return;
        const t0 = performance.now();

        updateBoidsBatch(
            this._heap,
            this._bufferPtr,
            this._count,
            dt,
            player.position.x,
            player.position.z,
            time
        );

        const base = this._bufferPtr >> 2;

        // State machine runs on this frame's positions; its velocity writes are
        // consumed by the next boids step.
        if (this._behavior) {
            this._stats = this._behavior.update(
                this._entries,
                this._heap,
                base,
                dt,
                player.position.x,
                player.position.y,
                player.position.z
            );
        }

        const batcher = FaunaBatcher.getInstance();

        for (const { component } of this._entries) {
            const b = base + component.slot * FAUNA_BOID_STRIDE;
            const x = this._heap[b];
            const y = this._heap[b + 1];
            const z = this._heap[b + 2];
            const vx = this._heap[b + 3];
            const vz = this._heap[b + 5];
            const phase = this._heap[b + 6];

            sampleGroundNormal(x, z, _normal);
            component.normalX = _normal.x;
            component.normalY = _normal.y;
            component.normalZ = _normal.z;

            _pos.set(x, y, z);
            _fwd.set(vx, 0, vz);
            if (_fwd.lengthSq() < 0.0001) {
                _fwd.set(Math.sin(phase), 0, Math.cos(phase));
            }
            _fwd.normalize();
            _normal.set(component.normalX, component.normalY, component.normalZ);
            if (_normal.lengthSq() < 0.01) _normal.set(0, 1, 0);
            else _normal.normalize();

            _tiltQuat.setFromUnitVectors(_up, _normal);
            const yaw = Math.atan2(_fwd.x, _fwd.z);
            _yawQuat.setFromAxisAngle(_normal, yaw);
            _quat.copy(_tiltQuat).multiply(_yawQuat);

            const scaleMul =
                component.species === FaunaSpecies.JellybeanHopper
                    ? 1.1
                    : component.species === FaunaSpecies.SugarMoth
                      ? 0.9
                      : 1.0;
            _scale.set(scaleMul, scaleMul, scaleMul);

            _mat.compose(_pos, _quat, _scale);
            batcher.setInstanceMatrix(
                component.species,
                component.slot,
                _mat,
                component.biome,
                phase
            );
        }

        batcher.syncMatrices();
        profiler.mark('fauna.update', performance.now() - t0);

        if (isFaunaDebugEnabled()) {
            updateFaunaDebug(this._heap, this._bufferPtr, this._count, this._entries);
        }
    }

    dispose(): void {
        if (this._bufferPtr) {
            freeBoidsBuffer(this._bufferPtr);
        }
        this._bufferPtr = 0;
        this._heap = null;
        this._entries = [];
        this._count = 0;
        this._behavior = null;
        this._stats = null;
        setFaunaScatterSink(null);
        publishFaunaCount(0);
        this._initialized = false;
        FaunaSystem._instance = null;
    }
}

/**
 * Publish the live critter count for `window.__worldHealth` and smoke tests.
 * A window shim rather than an import so world-health keeps no fauna dependency.
 */
function publishFaunaCount(count: number): void {
    try {
        (window as any).__faunaCount = count;
    } catch {
        /* SSR / node */
    }
}

/**
 * Optional physical reaction: a scatter burst shoves nearby dynamic bodies.
 * The rigid-body module is imported lazily so fauna keeps booting when the RB
 * layer is absent or disabled.
 */
function installScatterSink(): void {
    const cfg = CONFIG.fauna?.behavior;
    if (!cfg?.rigidBodyBump) {
        setFaunaScatterSink(null);
        return;
    }
    void import('../physics/rigid-bodies.ts')
        .then(({ applyRigidBodyRadialImpulse }) => {
            setFaunaScatterSink((x, y, z) => {
                applyRigidBodyRadialImpulse(x, y, z, cfg.bumpRadius ?? 5, cfg.bumpStrength ?? 2.5);
            });
        })
        .catch(() => {
            /* RB layer unavailable — scatter stays purely visual */
        });
}

export function initFaunaSystem(): void {
    if (!CONFIG.fauna?.enabled) return;
    FaunaSystem.getInstance().init();
}

export function updateFaunaSystem(dt: number, time: number): void {
    if (!CONFIG.fauna?.enabled) return;
    FaunaSystem.getInstance().update(dt, time);
}
