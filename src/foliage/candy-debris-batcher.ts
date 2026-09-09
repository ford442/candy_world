/**
 * Candy Debris Batcher — chunky instanced sugar shards for ability impacts.
 *
 * Deliberately *not* a particle system: one InstancedMesh of opaque, faceted
 * candy shards that take lighting (and optionally shadows), integrated on the
 * CPU. GPU compute particles own the 10k-point sparkle bursts; this owns the
 * few hundred solid chunks you can actually read as broken candy.
 *
 *   burstCandyDebris({ origin, count: 24, color: 0xff66cc, speed: 6 });
 *
 * Instances are capped, recycled from a compacted active range (swap-remove),
 * and ground-clamped against `getUnifiedGroundHeightTyped`.
 */

import * as THREE from 'three';
import { varyingProperty, float } from 'three/tsl';
import { getCIAdjustedCount } from '../core/config.ts';
import { getUnifiedGroundHeightTyped } from '../systems/physics.core.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { foliageGroup } from '../world/state.ts';
import { CandyPresets, createJuicyRimLight } from './material-core.ts';

/** Hard instance cap. Sized for one InstancedMesh draw + a 512-shard budget. */
export const MAX_DEBRIS = getCIAdjustedCount(768, 0.1, 32);

/**
 * Above this active count shards stop casting shadows — CSM cost scales with
 * caster count, and a full burst is exactly when the frame is most loaded.
 */
const SHADOW_INSTANCE_LIMIT = 96;

const GRAVITY = -18.0;
/** Per-second velocity retention; keeps shards from skating forever. */
const AIR_DRAG = 0.86;
const BOUNCE_RESTITUTION = 0.32;
const GROUND_FRICTION = 0.55;
/** Seconds of fade-out at the tail of a shard's life. */
const FADE_TIME = 0.5;
/** Re-query ground height after a shard drifts this far horizontally. */
const GROUND_REQUERY_DIST_SQ = 0.25;

const _scratchMatrix = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchEuler = new THREE.Euler();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();

export interface DebrisBurstOptions {
    /** World-space spawn point. */
    origin: THREE.Vector3 | { x: number; y: number; z: number };
    /** Shards to spawn; clamped to remaining capacity. */
    count?: number;
    /** Base tint; each shard jitters lightness around it. */
    color?: number | string | THREE.Color;
    /** Initial speed in units/sec (randomized ±35%). */
    speed?: number;
    /** Shard half-extent in world units. */
    size?: number;
    /** Seconds before recycle (randomized ±25%). */
    life?: number;
    /** Bias the cone upward (1 = straight up, 0 = spherical). */
    upBias?: number;
}

export interface DebrisStats {
    count: number;
    capacity: number;
    drawCalls: number;
    castingShadows: boolean;
}

/** Faceted flake: an icosahedron squashed on Z so it reads as a broken chip. */
function createShardGeometry(): THREE.BufferGeometry {
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    geo.scale(1.0, 0.75, 0.42);
    geo.computeVertexNormals();
    return geo;
}

export class CandyDebrisBatcher {
    private static _instance: CandyDebrisBatcher | null = null;

    mesh: THREE.InstancedMesh | null = null;

    /** Active shards occupy [0, count) in every array below. */
    private count = 0;
    private readonly capacity = MAX_DEBRIS;

    private readonly pos = new Float32Array(MAX_DEBRIS * 3);
    private readonly vel = new Float32Array(MAX_DEBRIS * 3);
    private readonly rot = new Float32Array(MAX_DEBRIS * 3);
    private readonly spin = new Float32Array(MAX_DEBRIS * 3);
    private readonly life = new Float32Array(MAX_DEBRIS);
    private readonly maxLife = new Float32Array(MAX_DEBRIS);
    private readonly size = new Float32Array(MAX_DEBRIS);
    private readonly groundY = new Float32Array(MAX_DEBRIS);
    /** Last XZ the ground height was sampled at, so we re-query only on drift. */
    private readonly groundSampleXZ = new Float32Array(MAX_DEBRIS * 2);
    private readonly resting = new Uint8Array(MAX_DEBRIS);

    private shadowsEnabled = false;

    static getInstance(): CandyDebrisBatcher {
        if (!CandyDebrisBatcher._instance) CandyDebrisBatcher._instance = new CandyDebrisBatcher();
        return CandyDebrisBatcher._instance;
    }

    /** The live mesh without forcing construction — for telemetry. */
    static peekMesh(): THREE.InstancedMesh | null {
        return CandyDebrisBatcher._instance?.mesh ?? null;
    }

    private constructor() {
        // 🎨 PALETTE: Sugar gives the glazed crust; per-instance color carries the
        // ability tint so one draw call covers every candy hue.
        const instanceColor = varyingProperty('vec3', 'vInstanceColor');
        const mat = CandyPresets.Sugar(0xffffff, {
            roughness: 0.45,
            clearcoat: 0.85,
            clearcoatRoughness: 0.18,
            noiseScale: 90.0,
        });
        mat.colorNode = instanceColor;
        // Visual Impact: a tight rim keeps shards legible against pastel terrain
        // even when they tumble out of the key light.
        mat.emissiveNode = instanceColor.mul(
            createJuicyRimLight(instanceColor, float(0.9), float(3.5), null)
        ).mul(float(0.6));

        const mesh = new THREE.InstancedMesh(createShardGeometry(), mat, this.capacity);
        mesh.name = 'CandyDebris';
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const colors = new Float32Array(this.capacity * 3);
        colors.fill(1.0);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.geometry.setAttribute('instanceColor', mesh.instanceColor);
        this.mesh = mesh;
        foliageGroup.add(mesh);
    }

    /** Enable shard shadows (LOD0 only — see SHADOW_INSTANCE_LIMIT). */
    setShadowsEnabled(enabled: boolean): void {
        this.shadowsEnabled = enabled;
    }

    burst(options: DebrisBurstOptions): number {
        const mesh = this.mesh;
        if (!mesh) return 0;

        const requested = Math.max(0, Math.floor(options.count ?? 16));
        const spawned = Math.min(requested, this.capacity - this.count);
        if (spawned <= 0) return 0;

        const origin = options.origin;
        const speed = options.speed ?? 5.0;
        const size = options.size ?? 0.16;
        const life = options.life ?? 2.2;
        const upBias = options.upBias ?? 0.45;
        _scratchColor.set((options.color ?? 0xffb7e5) as THREE.ColorRepresentation);

        const colorArray = mesh.instanceColor!.array as Float32Array;

        for (let n = 0; n < spawned; n++) {
            const i = this.count++;
            const i3 = i * 3;

            this.pos[i3] = origin.x + (Math.random() - 0.5) * 0.2;
            this.pos[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.2;
            this.pos[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.2;

            // Cone-biased sphere: even spread, lifted so shards arc rather than skid.
            const theta = Math.random() * Math.PI * 2;
            const z = Math.random() * 2 - 1;
            const r = Math.sqrt(Math.max(0, 1 - z * z));
            const s = speed * (0.65 + Math.random() * 0.7);
            this.vel[i3] = Math.cos(theta) * r * s;
            this.vel[i3 + 1] = (z * (1 - upBias) + upBias) * s + speed * 0.35;
            this.vel[i3 + 2] = Math.sin(theta) * r * s;

            this.rot[i3] = Math.random() * Math.PI * 2;
            this.rot[i3 + 1] = Math.random() * Math.PI * 2;
            this.rot[i3 + 2] = Math.random() * Math.PI * 2;
            this.spin[i3] = (Math.random() - 0.5) * 14;
            this.spin[i3 + 1] = (Math.random() - 0.5) * 14;
            this.spin[i3 + 2] = (Math.random() - 0.5) * 14;

            const maxLife = life * (0.75 + Math.random() * 0.5);
            this.life[i] = maxLife;
            this.maxLife[i] = maxLife;
            this.size[i] = size * (0.6 + Math.random() * 0.8);
            this.resting[i] = 0;
            this.groundY[i] = getUnifiedGroundHeightTyped(this.pos[i3], this.pos[i3 + 2]);
            this.groundSampleXZ[i * 2] = this.pos[i3];
            this.groundSampleXZ[i * 2 + 1] = this.pos[i3 + 2];

            // Lightness jitter keeps a burst from reading as one flat blob.
            const tint = 0.75 + Math.random() * 0.5;
            colorArray[i3] = Math.min(1, _scratchColor.r * tint);
            colorArray[i3 + 1] = Math.min(1, _scratchColor.g * tint);
            colorArray[i3 + 2] = Math.min(1, _scratchColor.b * tint);
        }

        mesh.instanceColor!.needsUpdate = true;
        return spawned;
    }

    update(delta: number): void {
        const mesh = this.mesh;
        if (!mesh || this.count === 0) return;

        const dt = Math.min(delta, 0.05);
        const drag = Math.pow(AIR_DRAG, dt);
        const colorArray = mesh.instanceColor!.array as Float32Array;

        let i = 0;
        while (i < this.count) {
            this.life[i] -= dt;
            if (this.life[i] <= 0) {
                this.swapRemove(i, colorArray);
                continue;
            }

            const i3 = i * 3;
            const half = this.size[i] * 0.5;

            if (!this.resting[i]) {
                this.vel[i3] *= drag;
                this.vel[i3 + 1] = this.vel[i3 + 1] * drag + GRAVITY * dt;
                this.vel[i3 + 2] *= drag;

                this.pos[i3] += this.vel[i3] * dt;
                this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
                this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

                this.rot[i3] += this.spin[i3] * dt;
                this.rot[i3 + 1] += this.spin[i3 + 1] * dt;
                this.rot[i3 + 2] += this.spin[i3 + 2] * dt;

                // Ground height is the expensive part of the step; only re-sample
                // once a shard has actually travelled away from its last probe.
                const dx = this.pos[i3] - this.groundSampleXZ[i * 2];
                const dz = this.pos[i3 + 2] - this.groundSampleXZ[i * 2 + 1];
                if (dx * dx + dz * dz > GROUND_REQUERY_DIST_SQ) {
                    this.groundY[i] = getUnifiedGroundHeightTyped(this.pos[i3], this.pos[i3 + 2]);
                    this.groundSampleXZ[i * 2] = this.pos[i3];
                    this.groundSampleXZ[i * 2 + 1] = this.pos[i3 + 2];
                }

                const floor = this.groundY[i] + half;
                if (this.pos[i3 + 1] <= floor) {
                    this.pos[i3 + 1] = floor;
                    if (this.vel[i3 + 1] < 0) this.vel[i3 + 1] *= -BOUNCE_RESTITUTION;
                    this.vel[i3] *= GROUND_FRICTION;
                    this.vel[i3 + 2] *= GROUND_FRICTION;
                    this.spin[i3] *= GROUND_FRICTION;
                    this.spin[i3 + 1] *= GROUND_FRICTION;
                    this.spin[i3 + 2] *= GROUND_FRICTION;
                    // Settle once the bounce is spent, so shards stop costing math.
                    if (this.vel[i3 + 1] < 0.4) this.resting[i] = 1;
                }
            }

            const fade = Math.min(1, this.life[i] / FADE_TIME);
            const scale = this.size[i] * fade;
            _scratchPos.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
            _scratchEuler.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
            _scratchQuat.setFromEuler(_scratchEuler);
            _scratchScale.set(scale, scale, scale);
            _scratchMatrix.compose(_scratchPos, _scratchQuat, _scratchScale);
            mesh.setMatrixAt(i, _scratchMatrix);
            i++;
        }

        mesh.count = this.count;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = this.shadowsEnabled && this.count <= SHADOW_INSTANCE_LIMIT;
    }

    /** Move the last active shard into slot `i` so the active range stays dense. */
    private swapRemove(i: number, colorArray: Float32Array): void {
        const last = --this.count;
        if (i === last) return;
        const i3 = i * 3;
        const l3 = last * 3;
        for (let c = 0; c < 3; c++) {
            this.pos[i3 + c] = this.pos[l3 + c];
            this.vel[i3 + c] = this.vel[l3 + c];
            this.rot[i3 + c] = this.rot[l3 + c];
            this.spin[i3 + c] = this.spin[l3 + c];
            colorArray[i3 + c] = colorArray[l3 + c];
        }
        this.life[i] = this.life[last];
        this.maxLife[i] = this.maxLife[last];
        this.size[i] = this.size[last];
        this.groundY[i] = this.groundY[last];
        this.groundSampleXZ[i * 2] = this.groundSampleXZ[last * 2];
        this.groundSampleXZ[i * 2 + 1] = this.groundSampleXZ[last * 2 + 1];
        this.resting[i] = this.resting[last];
        (this.mesh!.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }

    clear(): void {
        this.count = 0;
        if (this.mesh) this.mesh.count = 0;
    }

    getStats(): DebrisStats {
        return {
            count: this.count,
            capacity: this.capacity,
            drawCalls: this.mesh && this.count > 0 ? 1 : 0,
            castingShadows: this.mesh?.castShadow ?? false,
        };
    }

    dispose(): void {
        if (this.mesh) safeRemoveAndDispose(foliageGroup, this.mesh);
        this.mesh = null;
        this.count = 0;
        CandyDebrisBatcher._instance = null;
    }
}

/**
 * Fire a shard burst. Constructs the batcher on first use so a normal boot
 * never pays for the material until an ability actually needs it.
 */
export function burstCandyDebris(options: DebrisBurstOptions): number {
    try {
        return CandyDebrisBatcher.getInstance().burst(options);
    } catch (err) {
        console.warn('[candy-debris] burst failed', err);
        return 0;
    }
}

/** Per-frame integration. No-op until the first burst builds the batcher. */
export function updateCandyDebris(delta: number): void {
    const mesh = CandyDebrisBatcher.peekMesh();
    if (!mesh) return;
    CandyDebrisBatcher.getInstance().update(delta);
}

/** Telemetry-safe stats; zeroed when nothing has spawned yet. */
export function getCandyDebrisStats(): DebrisStats {
    if (!CandyDebrisBatcher.peekMesh()) {
        return { count: 0, capacity: MAX_DEBRIS, drawCalls: 0, castingShadows: false };
    }
    return CandyDebrisBatcher.getInstance().getStats();
}

/** Toggle LOD0 shard shadows. */
export function setCandyDebrisShadows(enabled: boolean): void {
    if (!CandyDebrisBatcher.peekMesh() && !enabled) return;
    CandyDebrisBatcher.getInstance().setShadowsEnabled(enabled);
}
