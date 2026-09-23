/**
 * Festival Night Market stall batcher (#1758).
 *
 * Three InstancedMeshes, one draw call each, shared by every stall:
 *   - frame   : counter + corner posts (Sugar clearcoat, per-stall tint)
 *   - awning  : striped candy canopy that unfurls after dusk
 *   - lantern : string of paper-lantern bulbs along the awning lip
 *
 * Night gate: geometry never pops. The counter is always present (a shuttered
 * stall by day); the awning folds up and the lanterns shrink + go dark as
 * `uCircadianPhase` rises. Once the phase is fully day the lantern mesh is
 * hidden on the CPU, so the day path is two cheap opaque draws.
 *
 * Streaming: every slot is freed by {@link NightMarketBatcher.removeInstance}
 * (swap-remove, count stays dense) so ChunkStreamer eviction never grows VRAM
 * (#1755). Lighting: one decorative descriptor per stall through
 * `src/rendering/lights.ts` — never a per-stall PointLight.
 *
 * @see docs/FESTIVAL_NIGHT_MARKET.md
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    attribute,
    color,
    cos,
    float,
    fract,
    mix,
    positionLocal,
    sin,
    smoothstep,
    step,
    uv,
    vec3,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { getCIAdjustedCount } from '../core/config.ts';
import { registerDecorativeFill, releaseLocalLight } from '../rendering/lights.ts';
import { BiomeUniforms, uCircadianPhase } from '../systems/biome-uniforms.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { foliageGroup } from '../world/state.ts';
import { CandyPresets, createJuicyRimLight, uAudioLow, uTime } from './index.ts';

export const MAX_NIGHT_MARKET_STALLS = getCIAdjustedCount(64, 0.25, 16);

/** Circadian phase at/above which the market is fully shut (lantern mesh hidden). */
export const NIGHT_MARKET_DAY_HIDE_PHASE = 0.98;

// Stall local space: front faces +Z, pivot on the ground at the counter centre.
const STALL_WIDTH = 3.0;
const STALL_DEPTH = 1.8;
const COUNTER_HEIGHT = 1.0;
const POST_HEIGHT = 2.7;
const LANTERN_COUNT = 5;

// PALETTE: awning stripe cream + default tints (strawberry, mint, butter, lilac, sky).
const STRIPE_CREAM = 0xfff4e6;
export const NIGHT_MARKET_TINTS = [0xff9ec4, 0x98fb98, 0xffe08a, 0xc3b1ff, 0x87cefa] as const;
const LANTERN_WARM = 0xffc9a8;

const _scratchMatrix = new THREE.Matrix4();
const _scratchColor = new THREE.Color();

export interface NightMarketStallOptions {
    /** Stall tint (hex). Defaults to a palette entry picked from `variant`. */
    color?: number;
    /** Palette index used when `color` is omitted. */
    variant?: number;
}

/**
 * Night-open factor: 1 at night, 0 in full day. Smoothstep over the circadian
 * transition so the awning unfurls instead of snapping.
 */
function nightOpenNode() {
    return float(1.0).sub(smoothstep(float(0.25), float(0.75), uCircadianPhase));
}

export class NightMarketBatcher {
    private initialized = false;
    private count = 0;

    frameMesh: THREE.InstancedMesh | null = null;
    awningMesh: THREE.InstancedMesh | null = null;
    lanternMesh: THREE.InstancedMesh | null = null;

    /** Per-instance [r, g, b, phase] shared by all three geometries. */
    private tint: THREE.InstancedBufferAttribute | null = null;
    private logic: THREE.Object3D[] = [];

    get instanceCount(): number {
        return this.count;
    }

    get capacity(): number {
        return MAX_NIGHT_MARKET_STALLS;
    }

    init(): void {
        if (this.initialized) return;
        this.tint = new THREE.InstancedBufferAttribute(
            new Float32Array(MAX_NIGHT_MARKET_STALLS * 4),
            4
        );
        this.tint.setUsage(THREE.DynamicDrawUsage);

        this.frameMesh = this.buildFrame();
        this.awningMesh = this.buildAwning();
        this.lanternMesh = this.buildLanterns();

        for (const mesh of [this.frameMesh, this.awningMesh, this.lanternMesh]) {
            mesh.count = 0;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            // Instances span the whole map; the bounding sphere is never recomputed per stall.
            mesh.frustumCulled = false;
            foliageGroup?.add(mesh);
        }
        this.initialized = true;
    }

    private buildFrame(): THREE.InstancedMesh {
        const counter = new THREE.BoxGeometry(
            STALL_WIDTH,
            COUNTER_HEIGHT,
            STALL_DEPTH * 0.6,
            1,
            1,
            1
        );
        counter.translate(0, COUNTER_HEIGHT * 0.5, STALL_DEPTH * 0.2);
        const parts: THREE.BufferGeometry[] = [counter];
        const hx = STALL_WIDTH * 0.5 - 0.1;
        const hz = STALL_DEPTH * 0.5 - 0.1;
        for (const [px, pz] of [
            [-hx, -hz],
            [hx, -hz],
            [-hx, hz],
            [hx, hz],
        ]) {
            const post = new THREE.CylinderGeometry(0.07, 0.09, POST_HEIGHT, 8);
            post.translate(px, POST_HEIGHT * 0.5, pz);
            parts.push(post);
        }
        const geo = mergeGeometries(
            parts.map((g) => g.toNonIndexed()),
            false
        )!;
        for (const g of parts) g.dispose();
        geo.setAttribute('aStallTint', this.tint!);

        const tint = attribute('aStallTint', 'vec4');
        // PALETTE: frosted pastel counter — tint the light, never desaturate the albedo.
        const mat = CandyPresets.Sugar(0xffffff, {
            colorNode: mix(tint.xyz, color(STRIPE_CREAM), float(0.35)),
            roughness: 0.35,
        });
        // Warm lantern spill on the counter after dusk (emissive, not a GPU light).
        const spill = color(LANTERN_WARM).mul(nightOpenNode()).mul(float(0.12));
        mat.emissiveNode = mat.emissiveNode ? (mat.emissiveNode as any).add(spill) : spill;

        const mesh = new THREE.InstancedMesh(geo, mat, MAX_NIGHT_MARKET_STALLS);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'NightMarketFrame';
        return mesh;
    }

    private buildAwning(): THREE.InstancedMesh {
        // Sloped canopy: a thin box pitched towards the customer side.
        const geo = new THREE.BoxGeometry(STALL_WIDTH + 0.5, 0.08, STALL_DEPTH + 0.7, 12, 1, 1);
        geo.rotateX(-0.28);
        geo.setAttribute('aStallTint', this.tint!);

        const tint = attribute('aStallTint', 'vec4');
        const open = nightOpenNode();
        const m = BiomeUniforms.nightMarket;

        // Fold: by day the canopy collapses to a narrow roll at the back rail.
        const fold = mix(float(0.18), float(1.0), open);
        const ripple = sin(uTime.mul(2.2).add(positionLocal.x.mul(2.0)).add(tint.w))
            .mul(float(0.04).add(m.hueShift.mul(0.12)))
            .mul(open);
        const awningPos = vec3(
            positionLocal.x,
            positionLocal.y.add(POST_HEIGHT + 0.05).add(ripple),
            positionLocal.z.mul(fold).sub(
                float(1.0)
                    .sub(fold)
                    .mul(STALL_DEPTH * 0.45)
            )
        );

        // PALETTE: candy-stripe awning — tint / cream bands along the width.
        const stripe = step(float(0.5), fract(uv().x.mul(6.0)));
        const stripeColor = mix(tint.xyz, color(STRIPE_CREAM), stripe);

        const mat = CandyPresets.Sugar(0xffffff, {
            colorNode: stripeColor,
            deformationNode: awningPos,
            roughness: 0.4,
            side: THREE.DoubleSide,
        });
        const mesh = new THREE.InstancedMesh(geo, mat, MAX_NIGHT_MARKET_STALLS);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = 'NightMarketAwning';
        return mesh;
    }

    private buildLanterns(): THREE.InstancedMesh {
        const parts: THREE.BufferGeometry[] = [];
        const lipZ = STALL_DEPTH * 0.5 + 0.3;
        for (let i = 0; i < LANTERN_COUNT; i++) {
            const t = i / (LANTERN_COUNT - 1);
            const bulb = new THREE.SphereGeometry(0.16, 10, 8);
            bulb.scale(1.0, 1.25, 1.0);
            bulb.translate(
                (t - 0.5) * STALL_WIDTH,
                POST_HEIGHT - 0.35 - Math.sin(t * Math.PI) * 0.18,
                lipZ
            );
            parts.push(bulb);
        }
        const geo = mergeGeometries(
            parts.map((g) => g.toNonIndexed()),
            false
        )!;
        for (const g of parts) g.dispose();
        geo.setAttribute('aStallTint', this.tint!);

        const tint = attribute('aStallTint', 'vec4');
        const open = nightOpenNode();
        const m = BiomeUniforms.nightMarket;

        // Lanterns tuck up under the awning by day (scale → 0.25) and swing gently
        // at night; hueShift (harmony channel) widens the swing.
        const shrink = mix(float(0.25), float(1.0), open);
        const swingAmp = float(0.03).add(m.hueShift.mul(0.1)).mul(open);
        const phase = uTime.mul(2.6).add(positionLocal.x.mul(1.7)).add(tint.w);
        const lanternPos = vec3(
            positionLocal.x.add(sin(phase).mul(swingAmp)),
            positionLocal.y.sub(POST_HEIGHT).mul(shrink).add(POST_HEIGHT),
            positionLocal.z.add(cos(phase.mul(0.8)).mul(swingAmp))
        );

        const mat = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.0 });
        mat.positionNode = lanternPos;
        // PALETTE: paper-lantern warmth mixed with the stall tint — pastel, not sodium orange.
        const paper = mix(color(LANTERN_WARM), tint.xyz, float(0.35));
        mat.colorNode = paper;
        // Music Impact: melody + chord pad flare the bulbs; note colour tints them.
        const flare = float(1.0).add(m.shimmer.mul(1.6)).add(uAudioLow.mul(0.3));
        const note = m.noteColor.mul(m.shimmer.mul(0.6));
        const rim = createJuicyRimLight(paper, float(1.2), float(3.0), null);
        mat.emissiveNode = paper.mul(flare).add(note).add(rim.mul(0.4)).mul(open);

        const mesh = new THREE.InstancedMesh(geo, mat, MAX_NIGHT_MARKET_STALLS);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.name = 'NightMarketLanterns';
        return mesh;
    }

    /**
     * Register a stall's logic proxy. Returns the dense slot, or -1 at capacity.
     * The proxy's world transform is baked once; stalls are static.
     */
    register(proxy: THREE.Object3D, options: NightMarketStallOptions = {}): number {
        if (!this.initialized) this.init();
        if (proxy.userData.nightMarketSlot !== undefined) return proxy.userData.nightMarketSlot;
        if (this.count >= MAX_NIGHT_MARKET_STALLS) {
            console.warn(
                `[NightMarketBatcher] capacity ${MAX_NIGHT_MARKET_STALLS} reached; stall skipped`
            );
            return -1;
        }

        const i = this.count++;
        this.logic[i] = proxy;
        proxy.userData.nightMarketSlot = i;
        proxy.userData.isBatched = true;

        proxy.updateMatrix();
        _scratchMatrix.copy(proxy.matrix);
        if (proxy.parent) {
            proxy.parent.updateMatrixWorld();
            _scratchMatrix.premultiply(proxy.parent.matrixWorld);
        }
        this.writeMatrix(i, _scratchMatrix);

        const variant = Math.abs(Math.floor(options.variant ?? i)) % NIGHT_MARKET_TINTS.length;
        _scratchColor.setHex(options.color ?? NIGHT_MARKET_TINTS[variant]);
        this.tint!.setXYZW(
            i,
            _scratchColor.r,
            _scratchColor.g,
            _scratchColor.b,
            Math.random() * Math.PI * 2
        );
        this.tint!.needsUpdate = true;

        this.setCount(this.count);

        const lightId = `night-market-${proxy.uuid}`;
        // Decorative descriptor only — the clustered pass sees it, no GPU light allocated.
        if (
            registerDecorativeFill({
                id: lightId,
                parent: proxy,
                color: LANTERN_WARM,
                intensity: 0.4,
                distance: 5,
                position: [0, POST_HEIGHT - 0.4, STALL_DEPTH * 0.5 + 0.3],
            })
        ) {
            proxy.userData.nightMarketLightId = lightId;
        }
        return i;
    }

    /** ChunkStreamer eviction contract (#1755): frees the slot, keeps count dense. */
    removeInstance(proxy: THREE.Object3D): void {
        if (!this.initialized || !proxy) return;
        const i = proxy.userData?.nightMarketSlot;
        if (typeof i !== 'number' || i < 0 || i >= this.count || this.logic[i] !== proxy) return;

        const last = this.count - 1;
        if (i !== last) {
            const moved = this.logic[last];
            this.logic[i] = moved;
            moved.userData.nightMarketSlot = i;
            for (const mesh of this.meshes()) {
                const arr = mesh.instanceMatrix.array;
                arr.copyWithin(i * 16, last * 16, last * 16 + 16);
            }
            const t = this.tint!.array as Float32Array;
            t.copyWithin(i * 4, last * 4, last * 4 + 4);
            this.tint!.needsUpdate = true;
        }
        this.logic.length = last;
        proxy.userData.nightMarketSlot = undefined;

        const lightId = proxy.userData.nightMarketLightId;
        if (typeof lightId === 'string') {
            releaseLocalLight(lightId);
            proxy.userData.nightMarketLightId = undefined;
        }
        this.setCount(last);
    }

    /**
     * Per-frame: hide the lantern mesh once the day is fully up. O(1), no allocation.
     */
    update(circadianPhase: number = uCircadianPhase.value as number): void {
        if (!this.lanternMesh) return;
        this.lanternMesh.visible = this.count > 0 && circadianPhase < NIGHT_MARKET_DAY_HIDE_PHASE;
    }

    /** Logic proxy at a slot — used by the stamp system for proximity checks. */
    getStall(i: number): THREE.Object3D | undefined {
        return i < this.count ? this.logic[i] : undefined;
    }

    private *meshes(): Generator<THREE.InstancedMesh> {
        if (this.frameMesh) yield this.frameMesh;
        if (this.awningMesh) yield this.awningMesh;
        if (this.lanternMesh) yield this.lanternMesh;
    }

    private writeMatrix(i: number, m: THREE.Matrix4): void {
        for (const mesh of this.meshes()) {
            m.toArray(mesh.instanceMatrix.array, i * 16);
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    private setCount(n: number): void {
        this.count = n;
        for (const mesh of this.meshes()) {
            mesh.count = n;
            mesh.instanceMatrix.needsUpdate = true;
        }
    }

    dispose(): void {
        for (const proxy of this.logic) {
            const lightId = proxy?.userData?.nightMarketLightId;
            if (typeof lightId === 'string') releaseLocalLight(lightId);
        }
        for (const mesh of [...this.meshes()]) {
            if (mesh.parent) safeRemoveAndDispose(mesh.parent, mesh);
        }
        this.frameMesh = this.awningMesh = this.lanternMesh = null;
        this.tint = null;
        this.logic = [];
        this.count = 0;
        this.initialized = false;
    }
}

export const nightMarketBatcher = new NightMarketBatcher();
