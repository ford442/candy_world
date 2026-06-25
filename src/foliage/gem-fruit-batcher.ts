// Gem Fruit Batcher — instanced hanging faceted crystals (ruby / sapphire / amethyst).
// One InstancedMesh draw call per jewel type; music-driven via gem_canopy biome uniforms.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
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
const MAX_GEMS_PER_TYPE = getCIAdjustedCount(512, 0.1, 50);

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
    const twist = sin(uTime.mul(4.0).add(aPhase.mul(2.0))).mul(gemUniforms.hueShift).mul(0.12).mul(normH);

    const swayed = positionLocal.add(vec3(swayX, float(0.0), swayZ));
    const twisted = vec3(
        swayed.x.mul(cos(twist)).sub(swayed.z.mul(sin(twist))),
        swayed.y,
        swayed.x.mul(sin(twist)).add(swayed.z.mul(cos(twist)))
    );
    mat.positionNode = twisted.add(calculateWindSway(twisted));

    // Visual Impact: emissive pulse on shimmer — visible bloom response on crescendo
    const shimmerGlow = gemUniforms.shimmer.mul(2.8).add(0.35);
    const beatPulse = smoothstep(0.3, 1.0, uAudioLow).mul(0.5);
    const rim = createJuicyRimLight(musicTint, float(1.2).add(gemUniforms.shimmer.mul(1.8)), float(3.5), null);
    mat.emissiveNode = musicTint.mul(shimmerGlow.add(beatPulse)).add(rim.mul(0.65));

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
            const mesh = new THREE.InstancedMesh(geo, mat, MAX_GEMS_PER_TYPE);
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
            if (mesh.geometry && mesh.geometry !== _sharedGemGeo) {
                mesh.geometry.dispose();
            }
            const phaseAttr = mesh.geometry?.getAttribute('aPhase');
            const armAttr = mesh.geometry?.getAttribute('aArmLen');
            if (phaseAttr && typeof (phaseAttr as any).dispose === 'function') {
                try { (phaseAttr as any).dispose(); } catch { /* noop */ }
            }
            if (armAttr && typeof (armAttr as any).dispose === 'function') {
                try { (armAttr as any).dispose(); } catch { /* noop */ }
            }
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((m) => m.dispose());
                } else {
                    (mesh.material as THREE.Material).dispose();
                }
            }
            if (mesh.instanceMatrix && typeof (mesh.instanceMatrix as any).dispose === 'function') {
                try { (mesh.instanceMatrix as any).dispose(); } catch { /* noop */ }
            }
            foliageGroup.remove(mesh);
        }
        foliageGroup.remove(this.group);
        if (_sharedGemGeo) {
            _sharedGemGeo.dispose();
            _sharedGemGeo = null;
        }
        this.meshes.length = 0;
        GemFruitBatcher._instance = null;
    }
}

export const gemFruitBatcher = GemFruitBatcher.getInstance();
