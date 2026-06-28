// Gem Fruit Batcher — instanced hanging faceted crystals (ruby / sapphire / amethyst).
// One InstancedMesh draw call per jewel type; music-driven via gem_canopy biome uniforms.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import {
    color, float, vec3, positionLocal, sin, cos, mix, attribute, smoothstep
} from 'three/tsl';
import {
    CandyPresets,
    uTime,
    uAudioLow,
    calculateWindSway,
    createJuicyRimLight,
} from './material-core.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { foliageGroup } from '../world/state.ts';
import { getBiomeUniforms, gemCanopyNoteColorNode, type BiomeId } from '../systems/biome-uniforms.ts';
import { getCIAdjustedCount } from '../core/config.ts';

const GEM_BIOME: BiomeId = 'gem_canopy';
const gemUniforms = getBiomeUniforms(GEM_BIOME);

/** Visual Impact: jewel base tints (ruby, sapphire, amethyst) */
const GEM_BASE_COLORS = [0xE0115F, 0x0F52BA, 0x9966CC] as const;
const MAX_GEMS_PER_TYPE = getCIAdjustedCount(512, 0.1, 80);

type GemTypeIndex = 0 | 1 | 2;

let _sharedGemGeo: THREE.BufferGeometry | null = null;

function getGemGeometry(): THREE.BufferGeometry {
    if (!_sharedGemGeo) {
        // Faceted low-poly crystal shape (Icosahedron detail 0 gives sharp candy-facet highlights).
        const geo = new THREE.IcosahedronGeometry(0.14, 0);
        geo.computeBoundingBox();
        const maxY = geo.boundingBox!.max.y;
        // Anchor hang point at local origin (top of strand) so gems dangle downward.
        geo.translate(0, -maxY, 0);
        geo.computeVertexNormals();
        _sharedGemGeo = geo;
    }
    return _sharedGemGeo;
}

function createGemMaterial(baseHex: number): MeshStandardNodeMaterial {
    // Visual Impact: CandyPresets.Crystal provides the "clearcoat" candy-glass look via
    // transmission:1.0, roughness:0.0 and ior:2.0 (diamond-like).  The rim + emissive
    // values below tune how juicy the gem appears inside god-ray light shafts.
    const mat = CandyPresets.Crystal(baseHex, {
        emissive: baseHex,
        emissiveIntensity: 0.75, // Visual Impact: base inner glow (raise for stronger bloom)
        audioReactStrength: 0.8, // Visual Impact: surface vibration on loud notes
        rimStrength: 1.4,        // Visual Impact: edge fairy-light intensity
        rimColor: 0xffffff,
        rimPower: 3.0,           // Visual Impact: rim tightness (lower = softer halo)
        side: THREE.DoubleSide,
    }) as MeshStandardNodeMaterial;

    const aPhase = attribute('aPhase', 'float');
    const aArmLen = attribute('aArmLen', 'float');

    const baseColor = color(baseHex);
    // Music Impact: gems inherit noteColor from the bound tracker channel via gemUniforms.noteColor.
    const musicTint = mix(baseColor, gemCanopyNoteColorNode, gemUniforms.shimmer);
    mat.colorNode = musicTint;

    // Pendulum sway — bottom of gem swings more (wisteria-style normalized height).
    const armLen = aArmLen.max(0.15);
    const normH = positionLocal.y.abs().div(armLen).clamp(0.0, 1.0);
    const swayPhase = uTime.mul(1.4).add(aPhase);
    // Music Impact: bass (uAudioLow) gently pumps the sway amplitude.
    const audioBoost = uAudioLow.mul(0.35).add(1.0);
    const swayX = sin(swayPhase).mul(0.09).mul(normH).mul(audioBoost);
    const swayZ = cos(swayPhase.mul(0.85)).mul(0.07).mul(normH).mul(audioBoost);

    // Music Impact: subtle note-hit twist scales with hueShift (melody channel energy).
    const twist = sin(uTime.mul(4.0).add(aPhase.mul(2.0)))
        .mul(gemUniforms.hueShift.add(uAudioLow.mul(0.5)))
        .mul(0.15)
        .mul(normH);

    const swayed = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    const twisted = vec3(
        swayed.x.mul(cos(twist)).sub(swayed.z.mul(sin(twist))),
        swayed.y,
        swayed.x.mul(sin(twist)).add(swayed.z.mul(cos(twist)))
    );
    // Pendulum + wind: calculateWindSway gives the broad atmospheric drift.
    mat.positionNode = twisted.add(calculateWindSway(twisted));

    // Visual Impact: emissive pulse on shimmer — visible bloom response on crescendo.
    // shimmerGlow is the sustained melody glow; beatPulse is the kick-hit flash.
    const shimmerGlow = gemUniforms.shimmer.mul(3.0).add(0.4);
    const beatPulse = smoothstep(0.3, 1.0, uAudioLow).mul(0.6);
    const rim = createJuicyRimLight(
        musicTint,
        float(1.3).add(gemUniforms.shimmer.mul(2.0)), // Visual Impact: rim intensity swells with music
        float(3.0),                                   // Visual Impact: rim falloff
        null
    );
    mat.emissiveNode = musicTint.mul(shimmerGlow.add(beatPulse)).add(rim.mul(0.7));

    registerReactiveMaterial(mat);
    return mat;
}

export class GemFruitBatcher {
    private static _instance: GemFruitBatcher | null = null;

    readonly group = new THREE.Group();
    readonly meshes: THREE.InstancedMesh[] = [];
    private readonly _counts = [0, 0, 0];
    private readonly _scratchMatrix = new THREE.Matrix4();
    private readonly _scratchPos = new THREE.Vector3();
    private readonly _scratchQuat = new THREE.Quaternion();
    private readonly _scratchScale = new THREE.Vector3(1, 1, 1);

    static getInstance(): GemFruitBatcher {
        if (!GemFruitBatcher._instance) {
            GemFruitBatcher._instance = new GemFruitBatcher();
        }
        return GemFruitBatcher._instance;
    }

    constructor() {
        const geo = getGemGeometry();
        for (let t = 0; t < 3; t++) {
            const mat = createGemMaterial(GEM_BASE_COLORS[t as GemTypeIndex]);
            // Each jewel type must own its InstancedBufferAttributes (aPhase / aArmLen).
            // Cloning the shared geometry keeps the draw-call count at one per type while
            // isolating per-instance attribute storage.
            const meshGeo = geo.clone();
            const mesh = new THREE.InstancedMesh(meshGeo, mat, MAX_GEMS_PER_TYPE);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = true;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            mesh.count = 0;

            const phaseArray = new Float32Array(MAX_GEMS_PER_TYPE);
            const armArray = new Float32Array(MAX_GEMS_PER_TYPE);
            mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));
            mesh.geometry.setAttribute('aArmLen', new THREE.InstancedBufferAttribute(armArray, 1));

            mesh.userData.gemType = t;
            this.meshes.push(mesh);
            this.group.add(mesh);
        }
        this.group.userData.type = 'gem_fruit';
        foliageGroup.add(this.group);
    }

    /**
     * Place hanging gems along branch arcs on a tree group (world-space instance matrices).
     * Mirrors wisteria-cluster hanging-math: gems dangle from canopy radius with increasing drop.
     */
    attachToTree(
        treeGroup: THREE.Object3D,
        options: { height?: number; gemCount?: number } = {}
    ): number {
        treeGroup.updateWorldMatrix(true, true);
        const treeScale = treeGroup.scale.y || 1;
        const height = (options.height ?? 4.0) * treeScale;
        const targetGems = options.gemCount ?? (5 + Math.floor(Math.random() * 4));
        const branchCount = Math.max(4, Math.min(7, Math.floor(targetGems / 1.5)));
        let placed = 0;

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
                const scale = 0.75 + Math.random() * 0.55;
                this._scratchScale.set(scale, scale * (1.1 + drop * 0.15), scale);
                this._scratchQuat.setFromEuler(new THREE.Euler(0, angle + Math.random() * 0.5, Math.random() * 0.3));

                this._scratchMatrix.compose(this._scratchPos, this._scratchQuat, this._scratchScale);

                if (this._registerInstance(gemType, this._scratchMatrix, drop + 0.2)) {
                    placed++;
                }
            }
        }
        return placed;
    }

    private _registerInstance(type: GemTypeIndex, matrix: THREE.Matrix4, armLen: number): boolean {
        const mesh = this.meshes[type];
        const idx = this._counts[type];
        if (idx >= MAX_GEMS_PER_TYPE) {
            console.warn('[GemFruitBatcher] Max capacity reached for type', type);
            return false;
        }

        matrix.toArray(mesh.instanceMatrix.array, idx * 16);
        const phaseAttr = mesh.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute;
        const armAttr = mesh.geometry.getAttribute('aArmLen') as THREE.InstancedBufferAttribute;
        phaseAttr.setX(idx, Math.random() * Math.PI * 2);
        armAttr.setX(idx, armLen);

        this._counts[type] = idx + 1;
        mesh.count = idx + 1;
        mesh.instanceMatrix.needsUpdate = true;
        phaseAttr.needsUpdate = true;
        armAttr.needsUpdate = true;
        return true;
    }

    dispose(): void {
        for (let t = 0; t < this.meshes.length; t++) {
            const mesh = this.meshes[t];
            safeRemoveAndDispose(foliageGroup as unknown as THREE.Scene, mesh);
        }
        safeRemoveAndDispose(foliageGroup as unknown as THREE.Scene, this.group);
        if (_sharedGemGeo) {
            _sharedGemGeo.dispose();
            _sharedGemGeo = null;
        }
        this.meshes.length = 0;
        GemFruitBatcher._instance = null;
    }
}

export const gemFruitBatcher = GemFruitBatcher.getInstance();
