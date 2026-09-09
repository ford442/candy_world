/**
 * @file soft-body.ts
 * @brief Experimental position-based cloth solver — one candy banner, opt-in.
 *
 * A deliberately tiny XPBD-flavoured cloth: a rectangular particle grid held
 * together by distance constraints (structural / shear / bend), integrated with
 * Verlet and relaxed Gauss-Seidel. It exists to make one hanging candy ribbon
 * squash and ripple; it is **not** a cloth engine for the foliage system, and
 * it does not replace the TSL wind deform in
 * `src/foliage/material-core/deformation.ts`.
 *
 * Design notes that keep it "candy" rather than "horror":
 *   - Heavily overdamped (`damping`), so motion settles into slow jelly wobble
 *     instead of whipping like a real flag.
 *   - Stretch is clamped per constraint (`MAX_STRETCH`), so the sheet can never
 *     draw out into thin spaghetti no matter how hard the player shoves it.
 *   - Collisions only ever *repel* (ground plane + player capsule); nothing
 *     grabs or pins the sheet, so it cannot be dragged inside out.
 *
 * Runtime shape: pure TypeScript on flat typed arrays, allocation-free after
 * construction (no WASM dependency — this is a prototype, and the whole sim is
 * a few hundred particles). Everything is finite-checked once per step; a
 * non-finite particle trips a full reset to the bind pose and bumps
 * `resetCount`, which the demo and the test both assert on.
 *
 * See docs/PERF_BUDGETS.md § "Soft Bodies (experimental)".
 */

import { getWindState } from '../wind-uniforms.ts';

/** Ground height query, in world space. */
export type GroundSampler = (x: number, z: number) => number;

/** One-way player capsule proxy — the cloth is pushed, the player is not. */
export interface SoftBodyPlayerProxy {
    active: boolean;
    x: number;
    y: number;
    z: number;
    /** Capsule radius. */
    radius: number;
    /** Total capsule height, measured downward from `y` (the eye/centre point). */
    height: number;
}

export interface ClothOptions {
    /** Particles across the sheet (>= 2). */
    cols: number;
    /** Particles down the sheet (>= 2). */
    rows: number;
    /** World-space spacing between neighbouring particles. */
    spacing: number;
    /** Top-left corner of the bind pose, in world space. */
    originX: number;
    originY: number;
    originZ: number;
    /** Gravity, world units/s². Negative pulls down. */
    gravity?: number;
    /** Velocity retained per second — lower is gooier. */
    damping?: number;
    /** Gauss-Seidel relaxation passes per substep. */
    iterations?: number;
    /** Fixed substep length, seconds. */
    substep?: number;
    /** Max substeps per frame — the tab-restore hitch guard. */
    maxSubsteps?: number;
    /** Wind acceleration scale. 0 disables the wind term entirely. */
    windStrength?: number;
    /** Wind direction (need not be normalized). */
    windX?: number;
    windY?: number;
    windZ?: number;
    /** Extra clearance kept between the sheet and the ground. */
    groundOffset?: number;
}

/** Longest a constraint may be relative to rest before it is hard-clamped. */
const MAX_STRETCH = 1.12;
/** Frame delta clamp, seconds — mirrors the rigid-body layer's MAX_FRAME_DT. */
const MAX_FRAME_DT = 0.1;
/** Per-substep speed clamp, world units/s. Keeps a bad bump from exploding. */
const MAX_SPEED = 24;

const DEFAULTS = {
    gravity: -9.0,
    damping: 0.86,
    iterations: 6,
    substep: 1 / 120,
    maxSubsteps: 4,
    windStrength: 3.2,
    windX: 1,
    windY: 0.15,
    windZ: 0.4,
    groundOffset: 0.08,
};

export class ClothSim {
    readonly cols: number;
    readonly rows: number;
    readonly count: number;
    readonly spacing: number;

    /** Current particle positions, xyz interleaved. */
    readonly positions: Float32Array;
    /** Previous positions — Verlet's velocity store. */
    private readonly prev: Float32Array;
    /** Bind pose, kept for pinning and for NaN recovery. */
    private readonly bind: Float32Array;
    /** 0 = pinned, 1 = free. */
    private readonly invMass: Float32Array;

    /** Constraint endpoint pairs (2 ints per constraint). */
    private readonly links: Int32Array;
    /** Rest length per constraint. */
    private readonly rest: Float32Array;
    /** Stiffness per constraint, 0..1. */
    private readonly stiffness: Float32Array;
    readonly linkCount: number;

    private readonly opts: Required<ClothOptions>;
    private accumulator = 0;
    private time = 0;

    /** Number of times the sheet was reset after a non-finite state. */
    resetCount = 0;

    constructor(options: ClothOptions) {
        this.opts = { ...DEFAULTS, ...options } as Required<ClothOptions>;
        this.cols = Math.max(2, options.cols | 0);
        this.rows = Math.max(2, options.rows | 0);
        this.spacing = options.spacing;
        this.count = this.cols * this.rows;

        this.positions = new Float32Array(this.count * 3);
        this.prev = new Float32Array(this.count * 3);
        this.bind = new Float32Array(this.count * 3);
        this.invMass = new Float32Array(this.count);

        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const i = (r * this.cols + c) * 3;
                this.bind[i] = this.opts.originX + c * this.spacing;
                this.bind[i + 1] = this.opts.originY - r * this.spacing;
                this.bind[i + 2] = this.opts.originZ;
            }
        }

        // Structural (right / down), shear (both diagonals), bend (skip one).
        const links: number[] = [];
        const stiff: number[] = [];
        const push = (a: number, b: number, s: number) => {
            links.push(a, b);
            stiff.push(s);
        };
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const i = r * this.cols + c;
                if (c + 1 < this.cols) push(i, i + 1, 1.0);
                if (r + 1 < this.rows) push(i, i + this.cols, 1.0);
                if (c + 1 < this.cols && r + 1 < this.rows) {
                    push(i, i + this.cols + 1, 0.6);
                    push(i + 1, i + this.cols, 0.6);
                }
                if (c + 2 < this.cols) push(i, i + 2, 0.25);
                if (r + 2 < this.rows) push(i, i + 2 * this.cols, 0.25);
            }
        }
        this.linkCount = stiff.length;
        this.links = Int32Array.from(links);
        this.stiffness = Float32Array.from(stiff);
        this.rest = new Float32Array(this.linkCount);

        this.reset();
        for (let k = 0; k < this.linkCount; k++) {
            const a = this.links[k * 2] * 3;
            const b = this.links[k * 2 + 1] * 3;
            const dx = this.bind[b] - this.bind[a];
            const dy = this.bind[b + 1] - this.bind[a + 1];
            const dz = this.bind[b + 2] - this.bind[a + 2];
            this.rest[k] = Math.hypot(dx, dy, dz);
        }
    }

    /** Pin a particle in place (invMass 0). Pinned particles never move. */
    pin(col: number, row: number): void {
        const i = row * this.cols + col;
        if (i >= 0 && i < this.count) this.invMass[i] = 0;
    }

    /** Pin the whole top edge — the banner's hanging rod. */
    pinTopEdge(): void {
        for (let c = 0; c < this.cols; c++) this.pin(c, 0);
    }

    /** Snap back to the bind pose at rest. Also the NaN recovery path. */
    reset(): void {
        this.positions.set(this.bind);
        this.prev.set(this.bind);
        this.invMass.fill(1);
        this.accumulator = 0;
    }

    /** Live wind control, so the demo can follow weather without reallocating. */
    setWind(x: number, y: number, z: number, strength: number): void {
        this.opts.windX = x;
        this.opts.windY = y;
        this.opts.windZ = z;
        this.opts.windStrength = strength;
    }

    /**
     * Advance the sim. Fixed substeps with an accumulator, so behaviour does not
     * change with frame rate; leftover time carries to the next frame.
     */
    step(delta: number, ground: GroundSampler | null, player: SoftBodyPlayerProxy | null): void {
        if (!Number.isFinite(delta) || delta <= 0) return;
        this.accumulator += Math.min(delta, MAX_FRAME_DT);

        const h = this.opts.substep;
        let steps = 0;
        while (this.accumulator >= h && steps < this.opts.maxSubsteps) {
            this.accumulator -= h;
            steps++;
            this.time += h;
            this.integrate(h);
            for (let it = 0; it < this.opts.iterations; it++) this.solveLinks();
            this.collide(ground, player);
        }
        // Drop the backlog rather than spiral after a long stall.
        if (this.accumulator > h * this.opts.maxSubsteps) this.accumulator = 0;

        if (steps > 0 && !this.isFinite()) {
            this.reset();
            this.resetCount++;
        }
    }

    /** Verlet integration with damping, wind and a per-substep speed clamp. */
    private integrate(h: number): void {
        const pos = this.positions;
        const prev = this.prev;
        const im = this.invMass;
        const o = this.opts;

        // Per-substep velocity retention from a per-second damping coefficient.
        const keep = Math.pow(o.damping, h);
        const maxStep = MAX_SPEED * h;
        const g = o.gravity * h * h;

        // Gust comes from the unified wind (src/systems/wind-uniforms.ts), so
        // cloth ripples on the same swell as foliage and pollen instead of on a
        // private sine. Modulated per-row for a travelling wave.
        const gust = getWindState().gust;
        const wl = Math.hypot(o.windX, o.windY, o.windZ) || 1;
        const wScale = o.windStrength * gust * h * h;
        const wx = (o.windX / wl) * wScale;
        const wy = (o.windY / wl) * wScale;
        const wz = (o.windZ / wl) * wScale;

        for (let i = 0; i < this.count; i++) {
            if (im[i] === 0) continue;
            const p = i * 3;
            const row = (i / this.cols) | 0;
            const wave = 0.7 + 0.3 * Math.sin(this.time * 2.3 + row * 0.55);

            let vx = (pos[p] - prev[p]) * keep;
            let vy = (pos[p + 1] - prev[p + 1]) * keep;
            let vz = (pos[p + 2] - prev[p + 2]) * keep;

            const speed = Math.hypot(vx, vy, vz);
            if (speed > maxStep) {
                const s = maxStep / speed;
                vx *= s;
                vy *= s;
                vz *= s;
            }

            prev[p] = pos[p];
            prev[p + 1] = pos[p + 1];
            prev[p + 2] = pos[p + 2];

            pos[p] += vx + wx * wave;
            pos[p + 1] += vy + g + wy * wave;
            pos[p + 2] += vz + wz * wave;
        }
    }

    /** One Gauss-Seidel relaxation pass over the distance constraints. */
    private solveLinks(): void {
        const pos = this.positions;
        const im = this.invMass;

        for (let k = 0; k < this.linkCount; k++) {
            const ia = this.links[k * 2];
            const ib = this.links[k * 2 + 1];
            const wa = im[ia];
            const wb = im[ib];
            const w = wa + wb;
            if (w === 0) continue;

            const a = ia * 3;
            const b = ib * 3;
            const dx = pos[b] - pos[a];
            const dy = pos[b + 1] - pos[a + 1];
            const dz = pos[b + 2] - pos[a + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d < 1e-6) continue;

            const rest = this.rest[k];
            // Hard clamp first: a link may never exceed MAX_STRETCH × rest,
            // whatever the stiffness says. This is what stops candy from
            // pulling into strings.
            const limit = rest * MAX_STRETCH;
            const target = d > limit ? limit : rest;
            const scale = ((d - target) / d) * (d > limit ? 1 : this.stiffness[k]);

            const cx = dx * scale;
            const cy = dy * scale;
            const cz = dz * scale;
            const fa = wa / w;
            const fb = wb / w;

            pos[a] += cx * fa;
            pos[a + 1] += cy * fa;
            pos[a + 2] += cz * fa;
            pos[b] -= cx * fb;
            pos[b + 1] -= cy * fb;
            pos[b + 2] -= cz * fb;
        }
    }

    /** Repel-only contacts: terrain height field, then the player capsule. */
    private collide(ground: GroundSampler | null, player: SoftBodyPlayerProxy | null): void {
        const pos = this.positions;
        const im = this.invMass;
        const offset = this.opts.groundOffset;

        for (let i = 0; i < this.count; i++) {
            if (im[i] === 0) continue;
            const p = i * 3;

            if (ground) {
                const gh = ground(pos[p], pos[p + 2]);
                if (Number.isFinite(gh) && pos[p + 1] < gh + offset) {
                    pos[p + 1] = gh + offset;
                }
            }

            if (player && player.active) {
                // Vertical capsule: clamp the particle's height to the segment,
                // then push radially out of the cylinder around it.
                const bottom = player.y - player.height;
                const cy = Math.min(Math.max(pos[p + 1], bottom), player.y);
                const dx = pos[p] - player.x;
                const dz = pos[p + 2] - player.z;
                const dy = pos[p + 1] - cy;
                const d = Math.hypot(dx, dy, dz);
                const r = player.radius;
                if (d < r) {
                    if (d < 1e-5) {
                        // Degenerate: nudge along +X so the push has a direction.
                        pos[p] += r;
                    } else {
                        const s = (r - d) / d;
                        pos[p] += dx * s;
                        pos[p + 1] += dy * s;
                        pos[p + 2] += dz * s;
                    }
                }
            }
        }
    }

    /** Debug assert support — false as soon as any component goes non-finite. */
    isFinite(): boolean {
        const pos = this.positions;
        for (let i = 0; i < pos.length; i++) {
            if (!Number.isFinite(pos[i])) return false;
        }
        return true;
    }

    /**
     * Write smooth per-vertex normals for the current positions into `out`
     * (length `count * 3`). Accumulate-and-normalize over the two triangles of
     * each quad; allocation-free.
     */
    computeNormals(out: Float32Array): void {
        out.fill(0);
        const pos = this.positions;
        for (let r = 0; r + 1 < this.rows; r++) {
            for (let c = 0; c + 1 < this.cols; c++) {
                const i0 = (r * this.cols + c) * 3;
                const i1 = (r * this.cols + c + 1) * 3;
                const i2 = ((r + 1) * this.cols + c) * 3;

                const ax = pos[i1] - pos[i0];
                const ay = pos[i1 + 1] - pos[i0 + 1];
                const az = pos[i1 + 2] - pos[i0 + 2];
                const bx = pos[i2] - pos[i0];
                const by = pos[i2 + 1] - pos[i0 + 1];
                const bz = pos[i2 + 2] - pos[i0 + 2];

                const nx = ay * bz - az * by;
                const ny = az * bx - ax * bz;
                const nz = ax * by - ay * bx;

                const i3 = ((r + 1) * this.cols + c + 1) * 3;
                out[i0] += nx;
                out[i0 + 1] += ny;
                out[i0 + 2] += nz;
                out[i1] += nx;
                out[i1 + 1] += ny;
                out[i1 + 2] += nz;
                out[i2] += nx;
                out[i2 + 1] += ny;
                out[i2 + 2] += nz;
                out[i3] += nx;
                out[i3 + 1] += ny;
                out[i3 + 2] += nz;
            }
        }
        for (let i = 0; i < out.length; i += 3) {
            const l = Math.hypot(out[i], out[i + 1], out[i + 2]);
            if (l < 1e-6) {
                out[i] = 0;
                out[i + 1] = 0;
                out[i + 2] = 1;
            } else {
                out[i] /= l;
                out[i + 1] /= l;
                out[i + 2] /= l;
            }
        }
    }

    /** Triangle indices for the grid — built once by the renderer. */
    buildIndices(): Uint16Array {
        const quads = (this.cols - 1) * (this.rows - 1);
        const out = new Uint16Array(quads * 6);
        let o = 0;
        for (let r = 0; r + 1 < this.rows; r++) {
            for (let c = 0; c + 1 < this.cols; c++) {
                const i0 = r * this.cols + c;
                const i1 = i0 + 1;
                const i2 = i0 + this.cols;
                const i3 = i2 + 1;
                out[o++] = i0;
                out[o++] = i2;
                out[o++] = i1;
                out[o++] = i1;
                out[o++] = i2;
                out[o++] = i3;
            }
        }
        return out;
    }

    /** UVs for the grid, top-left origin. */
    buildUVs(): Float32Array {
        const out = new Float32Array(this.count * 2);
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const i = (r * this.cols + c) * 2;
                out[i] = c / (this.cols - 1);
                out[i + 1] = 1 - r / (this.rows - 1);
            }
        }
        return out;
    }
}
