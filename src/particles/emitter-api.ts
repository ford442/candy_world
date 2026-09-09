/**
 * @file emitter-api.ts
 * @description Reusable emitter / attractor / music-hook API over the WebGPU
 * compute particle system.
 *
 * The point of this module is that gameplay, weather and debug tools all spawn
 * particles through one small surface instead of each copying `ComputeParticleSystem`
 * wiring or forking the WGSL. It adds no new GPU device: every emitter runs on the
 * system created by `compute-particles.ts`, which borrows the single renderer-owned
 * device via `awaitGpuDevice()` and fails closed to `CPUParticleSystem`.
 *
 * @example
 * ```ts
 * const puff = createEmitter({ preset: 'candy_puff', rate: 0, position: chest.position });
 * scene.add(puff.mesh);
 * puff.burst(48);                                  // one-shot pop
 * puff.addAttractor({ position: player.position, strength: 6, radius: 8 });
 * puff.bindMusic({ source: 'high', target: 'rate', min: 0, max: 120 });
 * // later
 * puff.dispose();                                  // releases GPU buffers, never the device
 * ```
 */

import * as THREE from 'three';
import {
    ComputeParticleSystem,
    MAX_PARTICLE_ATTRACTORS,
    createComputeFireflies,
    createComputePollen,
    createComputeBerries,
    createComputeRain,
    createComputeSparks,
    createComputeGemSparks,
    createComputeSparkBurst,
    createComputeCandyPuff,
} from './compute-particles.ts';
import type {
    ComputeParticleType,
    ParticleAttractor,
    ParticleAudioData,
} from './compute-particles-types.ts';
import { enforceCap, withinCap } from '../systems/performance-budget/systems-budget.ts';
import { profiler } from '../utils/profiler.ts';

// =============================================================================
// PUBLIC TYPES
// =============================================================================

/**
 * Emitter presets. `spark_burst` and `candy_puff` are one-shot pools built for
 * debris and abilities; the rest wrap the pre-existing ambient systems so callers
 * only ever learn one API.
 */
export type EmitterPreset = ComputeParticleType;

export type EmitterShapeType = 'point' | 'sphere' | 'box';

export interface EmitterShape {
    type: EmitterShapeType;
    /** Sphere radius (default 1). */
    radius?: number;
    /** Box half-extents (default 1,1,1). */
    size?: THREE.Vector3;
}

export interface EmitterOptions {
    /** Stable id used by the registry; auto-generated when omitted. */
    id?: string;
    /** Behaviour + material preset. Default `'spark_burst'`. */
    preset?: EmitterPreset;
    /** Spawn volume around `position`. Default a point. */
    shape?: EmitterShape;
    /** Continuous emission in particles/second. `0` (default) = burst-only. */
    rate?: number;
    /** Per-particle lifetime range in seconds. Preset default when omitted. */
    lifetime?: { min: number; max: number };
    /** Pool size — the maximum number of live particles. */
    count?: number;
    /** Emitter origin. Copied, not retained. */
    position?: THREE.Vector3;
    /** Particle size range. Preset default when omitted. */
    sizeRange?: { min: number; max: number };
    /** Simulation bounds for ambient (non-one-shot) presets. */
    bounds?: { x: number; y: number; z: number };
    /** Initial speed applied along the spawn direction. Preset default when omitted. */
    speed?: number;
}

/** Where a music hook reads its value from. */
export type MusicSource = 'low' | 'mid' | 'high' | 'groove' | 'beat';

/** What a music hook drives. */
export type MusicTarget = 'rate' | 'emitScale' | 'attractor';

export interface MusicBinding {
    source: MusicSource;
    target: MusicTarget;
    /** Output at source == 0. Default 0. */
    min?: number;
    /** Output at source == 1. Default 1. */
    max?: number;
    /** Exponential smoothing rate (1/s). 0 disables smoothing. Default 8. */
    smoothing?: number;
    /** For `target: 'attractor'` — which attractor slot to drive. Default 0. */
    attractorIndex?: number;
}

/** Live handle to one attractor slot. */
export interface AttractorHandle {
    readonly index: number;
    /** Move the attractor. The vector is copied. */
    setPosition(position: THREE.Vector3): void;
    setStrength(strength: number): void;
    setRadius(radius: number): void;
    /** Free the slot so another attractor can take it. */
    remove(): void;
}

// =============================================================================
// PRESET TABLE
// =============================================================================

interface PresetDefaults {
    count: number;
    sizeRange: { min: number; max: number };
    lifetime: { min: number; max: number };
    speed: number;
    factory: (config: any) => ComputeParticleSystem;
}

const PRESETS: Record<EmitterPreset, PresetDefaults> = {
    spark_burst: {
        count: 2048,
        sizeRange: { min: 0.04, max: 0.1 },
        lifetime: { min: 0.25, max: 0.7 },
        speed: 9,
        factory: createComputeSparkBurst,
    },
    candy_puff: {
        count: 1024,
        sizeRange: { min: 0.12, max: 0.3 },
        lifetime: { min: 0.9, max: 2.0 },
        speed: 1.6,
        factory: createComputeCandyPuff,
    },
    fireflies: {
        count: 8000,
        sizeRange: { min: 0.1, max: 0.25 },
        lifetime: { min: 2, max: 6 },
        speed: 1,
        factory: createComputeFireflies,
    },
    pollen: {
        count: 6000,
        sizeRange: { min: 0.05, max: 0.15 },
        lifetime: { min: 2, max: 6 },
        speed: 0.5,
        factory: createComputePollen,
    },
    berries: {
        count: 2000,
        sizeRange: { min: 0.08, max: 0.15 },
        lifetime: { min: 3, max: 8 },
        speed: 3,
        factory: createComputeBerries,
    },
    rain: {
        count: 20000,
        sizeRange: { min: 0.02, max: 0.05 },
        lifetime: { min: 5, max: 5 },
        speed: 6,
        factory: createComputeRain,
    },
    sparks: {
        count: 4000,
        sizeRange: { min: 0.05, max: 0.12 },
        lifetime: { min: 0.3, max: 0.8 },
        speed: 5,
        factory: createComputeSparks,
    },
    gem_sparks: {
        count: 512,
        sizeRange: { min: 0.025, max: 0.045 },
        lifetime: { min: 10, max: 24 },
        speed: 0.12,
        factory: createComputeGemSparks,
    },
};

/** Presets whose pool is host-driven: nothing appears until you burst or set a rate. */
const ONE_SHOT_PRESETS: ReadonlySet<EmitterPreset> = new Set<EmitterPreset>([
    'spark_burst',
    'candy_puff',
]);

// =============================================================================
// SCRATCH — module-level so the per-frame path allocates nothing
// =============================================================================

const _scratchSpawnPos = new THREE.Vector3();
const _scratchSpawnVel = new THREE.Vector3();
const _scratchSpawnOptions: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    life: number;
    size: number;
    seed: number;
} = {
    position: _scratchSpawnPos,
    velocity: _scratchSpawnVel,
    life: 1,
    size: 0.1,
    seed: 0,
};

let emitterSerial = 0;

// =============================================================================
// EMITTER
// =============================================================================

export class Emitter {
    public readonly id: string;
    public readonly preset: EmitterPreset;
    /**
     * Add this to the scene. It is a stable wrapper: the underlying system swaps its
     * own mesh when it falls back to the CPU tier, so parenting the system mesh
     * directly would strand it.
     */
    public readonly mesh: THREE.Group;
    /** The underlying system, for callers that need the low-level surface. */
    public readonly system: ComputeParticleSystem;
    /** Pool size this emitter was granted — may be below the requested count when the particle budget was tight. */
    public readonly capacity: number;

    private readonly position = new THREE.Vector3();
    private readonly shape: EmitterShape;
    private readonly lifetime: { min: number; max: number };
    private readonly sizeRange: { min: number; max: number };
    private readonly speed: number;
    private rate: number;
    private emitAccumulator = 0;
    private disposed = false;

    /** Fixed-length attractor table; a free slot has radius 0. */
    private readonly attractors: ParticleAttractor[] = [];
    private readonly attractorSlotUsed: boolean[] = [];
    private readonly bindings: MusicBinding[] = [];
    private readonly bindingValues: number[] = [];
    /** Baselines captured at bind time so a hook can be removed cleanly. */
    private readonly bindingBaseStrength: number[] = [];

    constructor(options: EmitterOptions) {
        this.preset = options.preset ?? 'spark_burst';
        const defaults = PRESETS[this.preset];

        this.id = options.id ?? `emitter_${this.preset}_${++emitterSerial}`;
        this.shape = options.shape ?? { type: 'point' };
        this.lifetime = options.lifetime ?? defaults.lifetime;
        this.sizeRange = options.sizeRange ?? defaults.sizeRange;
        this.speed = options.speed ?? defaults.speed;
        this.rate = options.rate ?? 0;
        if (options.position) this.position.copy(options.position);

        this.capacity = options.count ?? defaults.count;
        this.system = defaults.factory({
            count: this.capacity,
            center: this.position.clone(),
            sizeRange: this.sizeRange,
            ...(options.bounds ? { bounds: options.bounds } : {}),
        });
        this.mesh = new THREE.Group();
        this.mesh.name = this.id;
        this.mesh.add(this.system.mesh);
        // The system replaces its mesh if WebGPU init fails and the CPU tier takes
        // over, so re-parent once initialisation settles.
        this.system.initPromise
            ?.then(() => {
                if (this.disposed) return;
                if (this.system.mesh.parent !== this.mesh) {
                    this.mesh.clear();
                    this.mesh.add(this.system.mesh);
                }
            })
            .catch(() => {
                /* system already logged; nothing to re-parent */
            });

        for (let i = 0; i < MAX_PARTICLE_ATTRACTORS; i++) {
            this.attractors.push({ position: new THREE.Vector3(), strength: 0, radius: 0 });
            this.attractorSlotUsed.push(false);
        }
    }

    /** True while this emitter's simulation runs on the GPU compute path. */
    get isGPU(): boolean {
        return this.system.isGPU;
    }

    /** Move the emitter origin. The vector is copied. */
    setPosition(position: THREE.Vector3): this {
        this.position.copy(position);
        return this;
    }

    /** Continuous emission in particles/second. `0` stops continuous emission. */
    setRate(rate: number): this {
        this.rate = Math.max(0, rate);
        return this;
    }

    /**
     * Emit `count` particles immediately from the emitter shape.
     * Safe on both tiers — the GPU path writes the pool slots directly, the CPU
     * fallback seeds the same slots.
     */
    burst(count: number, origin?: THREE.Vector3): this {
        if (this.disposed) return this;
        const from = origin ?? this.position;
        for (let i = 0; i < count; i++) {
            this.emitOne(from);
        }
        return this;
    }

    /**
     * Claim an attractor slot. Returns `null` when all
     * `MAX_PARTICLE_ATTRACTORS` slots are taken — callers should treat that as a
     * soft failure, not an error.
     */
    addAttractor(attractor: ParticleAttractor): AttractorHandle | null {
        const index = this.attractorSlotUsed.indexOf(false);
        if (index === -1) return null;

        this.attractorSlotUsed[index] = true;
        const slot = this.attractors[index];
        slot.position.copy(attractor.position);
        slot.strength = attractor.strength;
        slot.radius = attractor.radius;
        this.uploadAttractors();

        return {
            index,
            setPosition: (position: THREE.Vector3) => {
                slot.position.copy(position);
                this.uploadAttractors();
            },
            setStrength: (strength: number) => {
                slot.strength = strength;
                this.uploadAttractors();
            },
            setRadius: (radius: number) => {
                slot.radius = radius;
                this.uploadAttractors();
            },
            remove: () => {
                if (!this.attractorSlotUsed[index]) return;
                this.attractorSlotUsed[index] = false;
                slot.strength = 0;
                slot.radius = 0;
                this.uploadAttractors();
            },
        };
    }

    /**
     * Drive emit rate, respawn energy or an attractor's strength from the audio
     * analysis that already feeds `MusicReactivitySystem`. Evaluated in
     * `updateEmitters()` with no per-frame allocation.
     */
    bindMusic(binding: MusicBinding): this {
        this.bindings.push(binding);
        this.bindingValues.push(0);
        const attractorIndex = binding.attractorIndex ?? 0;
        this.bindingBaseStrength.push(
            binding.target === 'attractor' ? this.attractors[attractorIndex].strength : 0
        );
        return this;
    }

    /** Remove every music hook, restoring attractor strengths captured at bind time. */
    clearMusicBindings(): this {
        for (let i = 0; i < this.bindings.length; i++) {
            const binding = this.bindings[i];
            if (binding.target === 'attractor') {
                this.attractors[binding.attractorIndex ?? 0].strength = this.bindingBaseStrength[i];
            }
        }
        this.bindings.length = 0;
        this.bindingValues.length = 0;
        this.bindingBaseStrength.length = 0;
        this.uploadAttractors();
        this.system.setEmitScale(1);
        return this;
    }

    /**
     * Advance continuous emission and music hooks. Called for every registered
     * emitter by `updateEmitters()`; the underlying system is stepped separately by
     * the compute/integration update so a system is never dispatched twice.
     */
    step(deltaTime: number, audioData: ParticleAudioData): void {
        if (this.disposed) return;

        if (this.bindings.length > 0) {
            this.applyMusicBindings(deltaTime, audioData);
        }

        if (this.rate > 0) {
            this.emitAccumulator += this.rate * deltaTime;
            // Cap the catch-up so a long frame (tab restore, shader compile) cannot
            // dump the whole pool in one go.
            let budget = Math.min(Math.floor(this.emitAccumulator), 512);
            this.emitAccumulator -= budget;
            while (budget-- > 0) {
                this.emitOne(this.position);
            }
        }
    }

    /** Release this emitter's GPU buffers. Never destroys the shared device. */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.bindings.length = 0;
        this.mesh.removeFromParent();
        this.system.dispose();
    }

    // -------------------------------------------------------------------------

    private emitOne(origin: THREE.Vector3): void {
        this.sampleShape(origin, _scratchSpawnPos, _scratchSpawnVel);
        _scratchSpawnOptions.life =
            this.lifetime.min + Math.random() * (this.lifetime.max - this.lifetime.min);
        _scratchSpawnOptions.size =
            this.sizeRange.min + Math.random() * (this.sizeRange.max - this.sizeRange.min);
        _scratchSpawnOptions.seed = Math.random() * 1000;
        this.system.spawn(_scratchSpawnOptions);
    }

    /** Writes a spawn position and an outward velocity into the supplied vectors. */
    private sampleShape(origin: THREE.Vector3, outPos: THREE.Vector3, outVel: THREE.Vector3): void {
        // Uniform direction on the sphere, reused for both offset and velocity.
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.max(0, 1 - u * u));
        const dx = r * Math.cos(theta);
        const dy = u;
        const dz = r * Math.sin(theta);

        switch (this.shape.type) {
            case 'sphere': {
                const radius = (this.shape.radius ?? 1) * Math.cbrt(Math.random());
                outPos.set(origin.x + dx * radius, origin.y + dy * radius, origin.z + dz * radius);
                break;
            }
            case 'box': {
                const size = this.shape.size;
                const hx = (size?.x ?? 1) * 0.5;
                const hy = (size?.y ?? 1) * 0.5;
                const hz = (size?.z ?? 1) * 0.5;
                outPos.set(
                    origin.x + (Math.random() * 2 - 1) * hx,
                    origin.y + (Math.random() * 2 - 1) * hy,
                    origin.z + (Math.random() * 2 - 1) * hz
                );
                break;
            }
            default:
                outPos.copy(origin);
        }

        const speed = this.speed * (0.6 + Math.random() * 0.8);
        outVel.set(dx * speed, Math.abs(dy) * speed, dz * speed);
    }

    private applyMusicBindings(deltaTime: number, audioData: ParticleAudioData): void {
        let attractorsDirty = false;

        for (let i = 0; i < this.bindings.length; i++) {
            const binding = this.bindings[i];
            const raw = readMusicSource(binding.source, audioData);

            // Exponential smoothing, matching the MusicReactivitySystem convention:
            // frame-rate independent and allocation-free.
            const smoothing = binding.smoothing ?? 8;
            const blend = smoothing > 0 ? 1 - Math.exp(-smoothing * deltaTime) : 1;
            this.bindingValues[i] += (raw - this.bindingValues[i]) * blend;

            const min = binding.min ?? 0;
            const max = binding.max ?? 1;
            const value = min + (max - min) * this.bindingValues[i];

            switch (binding.target) {
                case 'rate':
                    this.rate = Math.max(0, value);
                    break;
                case 'emitScale':
                    this.system.setEmitScale(value);
                    break;
                case 'attractor': {
                    const slot = this.attractors[binding.attractorIndex ?? 0];
                    if (slot.strength !== value) {
                        slot.strength = value;
                        attractorsDirty = true;
                    }
                    break;
                }
            }
        }

        if (attractorsDirty) this.uploadAttractors();
    }

    private uploadAttractors(): void {
        this.system.setAttractors(this.attractors);
    }
}

function readMusicSource(source: MusicSource, audioData: ParticleAudioData): number {
    switch (source) {
        case 'low':
            return audioData.low;
        case 'mid':
            return audioData.mid;
        case 'high':
            return audioData.high;
        case 'groove':
            return audioData.groove;
        case 'beat':
            return audioData.beat ? 1 : 0;
        default:
            return 0;
    }
}

// =============================================================================
// REGISTRY
// =============================================================================

const emitters = new Map<string, Emitter>();

/** Optional default parent so `burstAt()` can attach pools it creates on demand. */
let emitterParent: THREE.Object3D | null = null;

/**
 * Register the object that `burstAt()` should attach lazily-created pools to
 * (normally the scene). Emitters made with `createEmitter()` are still parented by
 * the caller.
 */
export function setEmitterParent(parent: THREE.Object3D | null): void {
    emitterParent = parent;
}

/** Particles already committed across every live emitter. */
export function getTotalParticleCapacity(): number {
    let total = 0;
    for (const emitter of emitters.values()) total += emitter.capacity;
    return total;
}

/**
 * Create and register an emitter, subject to the particle budget
 * (`SYSTEM_BUDGETS.particles` — emitter count and total pooled particles).
 *
 * The budget is enforced, not advised: a request that would overrun the total
 * particle cap is granted a smaller pool, and one that arrives with no headroom
 * left — or past the emitter cap — is refused with `null`. Callers must handle
 * that, the same way they already handle a full attractor table.
 */
export function createEmitter(options: EmitterOptions = {}): Emitter | null {
    if (!withinCap('particles', 'emitters', emitters.size + 1)) return null;

    const requested = options.count ?? PRESETS[options.preset ?? 'spark_burst'].count;
    const used = getTotalParticleCapacity();
    const granted = enforceCap('particles', 'totalParticles', used + requested) - used;
    if (granted <= 0) return null;

    const emitter = new Emitter({ ...options, count: granted });
    emitters.set(emitter.id, emitter);
    return emitter;
}

export function getEmitter(id: string): Emitter | undefined {
    return emitters.get(id);
}

export function getEmitters(): ReadonlyMap<string, Emitter> {
    return emitters;
}

/** Unregister and dispose one emitter, releasing its GPU buffers. */
export function disposeEmitter(id: string): void {
    const emitter = emitters.get(id);
    if (!emitter) return;
    emitters.delete(id);
    emitter.dispose();
}

/** Unregister and dispose every emitter (scene teardown / hot reload). */
export function disposeAllEmitters(): void {
    for (const emitter of emitters.values()) {
        emitter.dispose();
    }
    emitters.clear();
}

/**
 * Advance every registered emitter: music hooks, then continuous emission, then the
 * particle system's own simulation step. Called once per frame from the particle
 * phase of the game loop. Allocation-free.
 */
export function updateEmitters(
    renderer: THREE.Renderer,
    deltaTime: number,
    playerPosition: THREE.Vector3,
    audioData: ParticleAudioData
): void {
    const t0 = performance.now();
    for (const emitter of emitters.values()) {
        emitter.step(deltaTime, audioData);
        emitter.system.update(renderer, deltaTime, playerPosition, audioData);
    }
    profiler.mark('particles.update', performance.now() - t0);
}

/** Convenience: fire a one-shot burst at a world position from a shared pool. */
export function burstAt(
    preset: EmitterPreset,
    position: THREE.Vector3,
    count: number = 32
): Emitter | null {
    const id = `shared_${preset}`;
    let emitter: Emitter | null = emitters.get(id) ?? null;
    if (!emitter) {
        emitter = createEmitter({ id, preset, shape: { type: 'sphere', radius: 0.35 } });
        // Particle budget exhausted — the burst is dropped rather than queued.
        if (!emitter) return null;
        emitterParent?.add(emitter.mesh);
    }
    emitter.burst(count, position);
    return emitter;
}

/** True for presets whose pool is host-driven rather than self-recycling. */
export function isOneShotPreset(preset: EmitterPreset): boolean {
    return ONE_SHOT_PRESETS.has(preset);
}
