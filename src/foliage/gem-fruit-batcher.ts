// Gem Fruit Batcher — instanced hanging faceted crystals (ruby / sapphire / amethyst).
// One InstancedMesh draw call per jewel type; music-driven via gem_canopy biome uniforms.

import * as THREE from 'three';
import {
    color, float, vec3, positionLocal, sin, cos, mix, attribute, smoothstep, normalLocal, fract
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import { getCIAdjustedCount } from '../core/config.ts';
import type { BatcherInstanceRef } from '../systems/awakened/awakened-types.ts';
import { getBiomeUniforms, gemCanopyNoteColorNode, type BiomeId, uCircadianPoseOffset, circadianNightGlowMult } from '../systems/biome-uniforms.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { sampleEntityScale } from '../world/entity-scale.ts';
import { foliageGroup } from '../world/state.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { seasonDensityKeep, uSeasonSpawn } from './material-core/season-nodes.ts';
import {
    CandyPresets,
    uTime,
    uAudioLow,
    applyStandardDeformation,
    calculateWindSway,
    createJuicyRimLight,
    asNode,
    type FloatNode,
} from './material-core.ts';

const GEM_BIOME: BiomeId = 'gem_canopy';
const gemUniforms = getBiomeUniforms(GEM_BIOME);

/** Visual Impact: jewel base tints (ruby, sapphire, amethyst) */
const GEM_BASE_COLORS = [0xE0115F, 0x0F52BA, 0x9966CC] as const;
const MAX_GEMS_PER_TYPE = getCIAdjustedCount(512, 0.1, 80);

type GemTypeIndex = 0 | 1 | 2;

let _sharedGemGeo: THREE.BufferGeometry | null = null;

function getGemGeometry(): THREE.BufferGeometry {
    if (!_sharedGemGeo) {
        const geo = new THREE.IcosahedronGeometry(0.14, 0);
        geo.computeBoundingBox();
        const maxY = geo.boundingBox!.max.y;
        // Anchor hang point at local origin (top of strand)
        geo.translate(0, -maxY, 0);
        geo.computeVertexNormals();
        _sharedGemGeo = geo;
    }
    return _sharedGemGeo;
}

function createGemMaterial(baseHex: number): MeshStandardNodeMaterial {
    // Visual Impact: high clearcoat crystal gloss + strong emissive for candy-jewel pop
    const mat = CandyPresets.Crystal(baseHex, {
        emissive: baseHex,
        emissiveIntensity: 0.45,
        audioReactStrength: 0.6,
        rimStrength: 1.25,
        rimColor: 0xffffff,
        rimPower: 3.5,
        side: THREE.DoubleSide,
    }) as MeshStandardNodeMaterial;

    const aPhase = attribute('aPhase', 'float');
    const aArmLen = attribute('aArmLen', 'float');
    const aAwakened = attribute('aAwakened', 'float');
    const aEmissiveScale = attribute('aEmissiveScale', 'float');

    const baseColor = color(baseHex);
    const musicTint = mix(baseColor, gemCanopyNoteColorNode, gemUniforms.shimmer);
    mat.colorNode = musicTint;

    // Pendulum sway — bottom of gem swings more (wisteria-style normalized height)
    const armLen = aArmLen.max(0.15);
    const normH = positionLocal.y.abs().div(armLen).clamp(0.0, 1.0);
    const swayPhase = uTime.mul(1.4).add(aPhase);
    const audioBoost = uAudioLow.mul(0.35).add(1.0);
    const swayX = sin(swayPhase).mul(0.09).mul(normH).mul(audioBoost);
    const swayZ = cos(swayPhase.mul(0.85)).mul(0.07).mul(normH).mul(audioBoost);
    // Visual Impact: note-hit twist driven by hueShift uniform (beat shimmer proxy)
    const twist = asNode<FloatNode>(sin(uTime.mul(4.0).add(aPhase.mul(2.0))).mul(gemUniforms.hueShift).mul(0.12).mul(normH));

    const swayed = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    const circadianDroop = float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y);
    const twisted = vec3(
        swayed.x.mul(cos(twist)).sub(swayed.z.mul(sin(twist))),
        swayed.y.add(circadianDroop),
        swayed.x.mul(sin(twist)).add(swayed.z.mul(cos(twist)))
    );
    // Pendulum + wind: applyStandardDeformation gives the broad atmospheric drift and player interaction.
    // Seasons thin the gems (CONFIG.season.spawnScale.gemFruit). aPhase is uniform
    // in [0, 2π) and moves with its instance on swap-with-last removal, so it is a
    // stable per-gem key.
    const seasonKeep = seasonDensityKeep(fract(aPhase.mul(1 / (Math.PI * 2))), uSeasonSpawn.gemFruit);
    const baseDeformed = twisted.mul(seasonKeep);
    // 🎨 PALETTE: Apply Standard Deformation (which already includes player interaction)
    // AND explicitly add Wind Sway on top to make the gem fruits more dynamic
    // and visually cohesive with the twilight candy theme.

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    mat.positionNode = applyStandardDeformation(baseDeformed).add(calculateWindSway(baseDeformed, { amplitude: float(1.5) }));

    // Visual Impact: emissive pulse on shimmer — visible bloom response on crescendo.
    // shimmerGlow is the sustained melody glow; beatPulse is the kick-hit flash.
    const shimmerGlow = gemUniforms.shimmer.mul(3.0).add(0.4);
    const beatPulse = smoothstep(0.3, 1.0, uAudioLow).mul(0.6);
    const rim = createJuicyRimLight(
        musicTint,
        float(1.3).add(gemUniforms.shimmer.mul(2.0)), // Visual Impact: rim intensity swells with music
        float(3.0),                                   // Visual Impact: rim falloff
        normalLocal
    );
    mat.emissiveNode = musicTint.mul(shimmerGlow.add(beatPulse)).add(rim.mul(0.7))
        .add(musicTint.mul(aAwakened.mul(aEmissiveScale).mul(0.45)))
        .mul(circadianNightGlowMult());

    registerReactiveMaterial(mat);
    return mat;
}

interface GemRecord {
    tree: THREE.Object3D;
    /** The ref handed out in tree.userData.gemRefs; its instanceIndex follows swaps. */
    ref: BatcherInstanceRef;
    matrix: Float32Array;
    phase: number;
    armLen: number;
    awakened: number;
    emissiveScale: number;
}

/** One jewel type: its own InstancedMesh and slot space. */
class GemTypeBatcher extends InstancedBatcher<GemRecord> {
    private aPhase!: THREE.InstancedBufferAttribute;
    private aArmLen!: THREE.InstancedBufferAttribute;
    private aAwakened!: THREE.InstancedBufferAttribute;
    private aEmissiveScale!: THREE.InstancedBufferAttribute;

    constructor(
        readonly gemType: GemTypeIndex,
        private readonly group: THREE.Group
    ) {
        super(`gem-fruit-${gemType}`, 'animate', MAX_GEMS_PER_TYPE);
        this.rangedUploads = true;
        this.ensureMesh();
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        const geo = getGemGeometry().clone();
        const mat = createGemMaterial(GEM_BASE_COLORS[this.gemType]);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = true;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.count = 0;

        const attr = (name: string) => {
            const a = this.registerAttribute(
                new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
            );
            mesh.geometry.setAttribute(name, a);
            return a;
        };
        this.aPhase = attr('aPhase');
        this.aArmLen = attr('aArmLen');
        this.aAwakened = attr('aAwakened');
        this.aEmissiveScale = attr('aEmissiveScale');

        mesh.userData.gemType = this.gemType;
        this.group.add(mesh);
        return mesh;
    }

    protected writeRecord(r: GemRecord, slot: number, array: Float32Array): void {
        array.set(r.matrix, slot * 16);
        this.aPhase.setX(slot, r.phase);
        this.aArmLen.setX(slot, r.armLen);
        this.aAwakened.setX(slot, r.awakened);
        this.aEmissiveScale.setX(slot, r.emissiveScale);
        r.ref.instanceIndex = slot;
    }

    protected step(): void {
        // Static instances; sway and glow are in the TSL graph.
    }

    addGem(r: GemRecord): number | null {
        return this.add(r);
    }

    removeGem(handle: number): void {
        this.remove(handle);
    }

    awaken(slot: number, emissiveScale: number): void {
        const r = this.recordAt(slot);
        if (!r) return;
        r.awakened = 1;
        r.emissiveScale = emissiveScale;
        this.aAwakened.setX(slot, 1);
        this.aEmissiveScale.setX(slot, emissiveScale);
        this.markSlotDirty(slot);
        this.flush();
    }
}

/**
 * Hanging gems, three InstancedMeshes (one per jewel type). #2166: each type
 * is an InstancedBatcher; this facade keeps the public API.
 */
export class GemFruitBatcher {
    private static _instance: GemFruitBatcher | null = null;

    readonly group = new THREE.Group();
    private readonly types: GemTypeBatcher[] = [];
    private readonly _scratchMatrix = new THREE.Matrix4();
    private readonly _scratchPos = new THREE.Vector3();
    private readonly _scratchQuat = new THREE.Quaternion();
    private readonly _scratchScale = new THREE.Vector3(1, 1, 1);
    private readonly _scratchEuler = new THREE.Euler();

    /** Ref → batcher handle; a WeakMap so the refs stay plain data. */
    private readonly _handles = new WeakMap<BatcherInstanceRef, number>();

    static getInstance(): GemFruitBatcher {
        if (!GemFruitBatcher._instance) {
            GemFruitBatcher._instance = new GemFruitBatcher();
        }
        return GemFruitBatcher._instance;
    }

    constructor() {
        for (let t = 0; t < 3; t++) this.types.push(new GemTypeBatcher(t as GemTypeIndex, this.group));
        this.group.userData.type = 'gem_fruit';
        foliageGroup.add(this.group);
    }

    /** One InstancedMesh per jewel type, indexed by gemType. */
    get meshes(): THREE.InstancedMesh[] {
        const out: THREE.InstancedMesh[] = [];
        for (const t of this.types) if (t.mesh) out.push(t.mesh);
        return out;
    }

    /**
     * Place hanging gems along branch arcs on a tree group (world-space instance matrices).
     */
    attachToTree(
        treeGroup: THREE.Object3D,
        options: { height?: number; gemCount?: number } = {}
    ): { placed: number; refs: BatcherInstanceRef[] } {
        // ⚡ OPTIMIZATION: Bypassed expensive treeGroup.updateWorldMatrix() recursion.
        // We compose the world matrix directly assuming the parent (if any) is the scene root or has an up-to-date matrix.
        treeGroup.matrixWorld.compose(treeGroup.position, treeGroup.quaternion, treeGroup.scale);
        if (treeGroup.parent) {
            treeGroup.matrixWorld.multiplyMatrices(treeGroup.parent.matrixWorld, treeGroup.matrixWorld);
        }
        const treeScale = treeGroup.scale.y || 1;
        const height = (options.height ?? 4.0) * treeScale;
        const targetGems = options.gemCount ?? (5 + Math.floor(Math.random() * 4));
        const branchCount = Math.max(4, Math.min(7, Math.floor(targetGems / 1.5)));
        let placed = 0;
        const refs: BatcherInstanceRef[] = [];

        for (let b = 0; b < branchCount && placed < targetGems; b++) {
            const angle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.4;
            const radius = 0.35 + Math.random() * 0.55;
            const gemsOnBranch = 1 + (placed + b < targetGems ? Math.floor(Math.random() * 2) : 0);

            for (let g = 0; g < gemsOnBranch && placed < targetGems; g++) {
                const along = 0.25 + g * 0.38;
                const canopyY = height * (0.72 + Math.random() * 0.12);
                const drop = along * (0.55 + Math.random() * 0.35);

                this._scratchPos.set(
                    Math.cos(angle) * radius * along,
                    canopyY - drop,
                    Math.sin(angle) * radius * along
                );
                this._scratchPos.applyMatrix4(treeGroup.matrixWorld);

                const gemType = (placed % 3) as GemTypeIndex;
                const scale = sampleEntityScale('gem_fruit', { biome: 'gem_canopy' });
                this._scratchScale.set(scale, scale * (1.1 + drop * 0.15), scale);
                this._scratchQuat.setFromEuler(
                    this._scratchEuler.set(0, angle + Math.random() * 0.5, Math.random() * 0.3)
                );
                this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

                const armLen = 0.5 + Math.random() * 1.5;
                const ref: BatcherInstanceRef = { batcher: 'gem_fruit', gemType, instanceIndex: -1 };
                const handle = this.types[gemType].addGem({
                    tree: treeGroup,
                    ref,
                    matrix: new Float32Array(this._scratchMatrix.elements),
                    phase: Math.random() * Math.PI * 2,
                    armLen,
                    awakened: 0,
                    emissiveScale: 0,
                });
                if (handle === null) {
                    console.warn('[GemFruitBatcher] Max capacity reached for type', gemType);
                    continue;
                }
                this._handles.set(ref, handle);
                refs.push(ref);
                placed++;
            }
        }
        // Trees attach during generation, outside the frame; upload now.
        for (const t of this.types) t.flush();

        treeGroup.userData.gemRefs = refs;
        return { placed, refs };
    }

    removeInstance(logicObject: THREE.Object3D): void {
        const refs = logicObject.userData.gemRefs as BatcherInstanceRef[] | null | undefined;
        if (!refs || refs.length === 0) return;
        for (const ref of refs) {
            const handle = this._handles.get(ref);
            const type = this.types[ref.gemType ?? -1];
            if (handle === undefined || !type) continue;
            this._handles.delete(ref);
            type.removeGem(handle);
        }
        for (const t of this.types) t.flush();
        logicObject.userData.gemRefs = null;
    }

    setAwakened(gemType: number, instanceIndex: number, emissiveScale: number): void {
        this.types[gemType]?.awaken(instanceIndex, emissiveScale);
    }

    dispose(): void {
        for (const t of this.types) t.dispose();
        safeRemoveAndDispose(foliageGroup, this.group);
        if (_sharedGemGeo) {
            _sharedGemGeo.dispose();
            _sharedGemGeo = null;
        }
        GemFruitBatcher._instance = null;
    }
}

export const gemFruitBatcher = GemFruitBatcher.getInstance();
