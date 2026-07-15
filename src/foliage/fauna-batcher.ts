/**
 * Instanced fauna batcher — one InstancedMesh per species (beetle / hopper / moth).
 * Candy Gummy materials + LOD registration + optional music-reactive glow.
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, sin, attribute, mix, positionLocal } from 'three/tsl';
import {
    CandyPresets,
    uTime,
    uAudioLow,
    createJuicyRimLight,
    registerReactiveMaterial,
} from './index.ts';
import { foliageGroup } from '../world/state.ts';
import { CONFIG, getCIAdjustedCount } from '../core/config.ts';
import { initInstanceLodAttribute } from './batcher-lod-utils.ts';
import { registerFoliageBatcherLod } from '../systems/batcher-lod.ts';
import { getBiomeUniforms, type BiomeId } from '../systems/biome-uniforms.ts';
import { FaunaSpecies } from '../systems/fauna/types.ts';

const SPECIES_LABELS = ['gumdrop_beetle', 'jellybean_hopper', 'sugar_moth'] as const;

/** PALETTE: pastel candy fauna tints */
const SPECIES_COLORS = [0xff6b9d, 0x98fb98, 0xe6e6fa] as const;

const MAX_PER_SPECIES = getCIAdjustedCount(CONFIG.fauna?.maxPerSpecies ?? 40, 0.2, 8);

function createFaunaMaterial(baseHex: number, biome: BiomeId = 'global'): MeshStandardNodeMaterial {
    const u = getBiomeUniforms(biome);
    const mat = CandyPresets.Gummy(baseHex, {
        roughness: 0.25,
        audioReactStrength: 0.6,
        rimStrength: 1.0,
        rimPower: 2.5,
    }) as MeshStandardNodeMaterial;

    const aPhase = attribute('aPhase', 'float');
    const aBiomeGlow = attribute('aBiomeGlow', 'float');

    const base = color(baseHex);
    const musicTint = mix(base, u.noteColor, u.shimmer.mul(0.35));
    mat.colorNode = musicTint;

    const wiggle = sin(uTime.mul(3.0).add(aPhase)).mul(0.03);
    mat.positionNode = positionLocal.add(positionLocal.mul(wiggle));

    const glow = u.shimmer.mul(2.0).add(uAudioLow.mul(0.5)).add(aBiomeGlow.mul(0.4));
    const rim = createJuicyRimLight(musicTint, float(1.2), float(2.5), null);
    mat.emissiveNode = musicTint.mul(glow).add(rim.mul(0.5));

    registerReactiveMaterial(mat);
    return mat;
}

function createSpeciesGeometry(species: FaunaSpecies): THREE.BufferGeometry {
    switch (species) {
        case FaunaSpecies.JellybeanHopper:
            return new THREE.SphereGeometry(0.22, 10, 8).scale(0.85, 1.2, 0.85);
        case FaunaSpecies.SugarMoth:
            return new THREE.BoxGeometry(0.35, 0.08, 0.5);
        default:
            return new THREE.SphereGeometry(0.18, 8, 6).scale(1.2, 0.65, 1.0);
    }
}

interface SpeciesSlot {
    mesh: THREE.InstancedMesh;
    count: number;
    phases: Float32Array;
    glows: Float32Array;
    slotToInstance: Map<number, number>;
}

export class FaunaBatcher {
    private static _instance: FaunaBatcher | null = null;

    private readonly _species: SpeciesSlot[] = [];
    private _initialized = false;

    static getInstance(): FaunaBatcher {
        if (!FaunaBatcher._instance) {
            FaunaBatcher._instance = new FaunaBatcher();
        }
        return FaunaBatcher._instance;
    }

    init(): void {
        if (this._initialized) return;

        for (let s = 0; s < 3; s++) {
            const geo = createSpeciesGeometry(s as FaunaSpecies);
            geo.computeVertexNormals();
            const mat = createFaunaMaterial(SPECIES_COLORS[s]);
            const mesh = new THREE.InstancedMesh(geo, mat, MAX_PER_SPECIES);
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            mesh.frustumCulled = true;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            mesh.count = 0;
            mesh.name = `Fauna_${SPECIES_LABELS[s]}`;
            mesh.userData.faunaSpecies = s;

            const phases = new Float32Array(MAX_PER_SPECIES);
            const glows = new Float32Array(MAX_PER_SPECIES);
            geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
            geo.setAttribute('aBiomeGlow', new THREE.InstancedBufferAttribute(glows, 1));
            initInstanceLodAttribute(mesh, MAX_PER_SPECIES);

            foliageGroup.add(mesh);
            this._species.push({
                mesh,
                count: 0,
                phases,
                glows,
                slotToInstance: new Map(),
            });
        }

        registerFoliageBatcherLod({
            id: 'fauna',
            getMeshes: () => this._species.map((s) => s.mesh),
        });

        this._initialized = true;
    }

    addInstance(
        species: FaunaSpecies,
        x: number,
        y: number,
        z: number,
        biome: string,
        phase: number,
        slot = -1
    ): number {
        const sp = this._species[species];
        if (!sp || sp.count >= MAX_PER_SPECIES) return -1;

        const idx = sp.count++;
        sp.mesh.count = sp.count;
        sp.phases[idx] = phase;
        sp.glows[idx] = biome === 'luminous_plants' || biome === 'crystalline_nebula' ? 1 : 0.3;
        if (slot >= 0) sp.slotToInstance.set(slot, idx);

        const m = new THREE.Matrix4().makeTranslation(x, y, z);
        sp.mesh.setMatrixAt(idx, m);
        return idx;
    }

    setInstanceMatrix(
        species: FaunaSpecies,
        slot: number,
        matrix: THREE.Matrix4,
        _biome: string,
        phase: number
    ): void {
        const sp = this._species[species];
        const idx = sp.slotToInstance.get(slot);
        if (idx === undefined) return;
        sp.mesh.setMatrixAt(idx, matrix);
        sp.phases[idx] = phase;
    }

    syncMatrices(): void {
        for (const sp of this._species) {
            if (sp.count > 0) {
                sp.mesh.instanceMatrix.needsUpdate = true;
                const phaseAttr = sp.mesh.geometry.getAttribute(
                    'aPhase'
                ) as THREE.InstancedBufferAttribute;
                const glowAttr = sp.mesh.geometry.getAttribute(
                    'aBiomeGlow'
                ) as THREE.InstancedBufferAttribute;
                phaseAttr.needsUpdate = true;
                glowAttr.needsUpdate = true;
            }
        }
    }

    getMeshes(): THREE.InstancedMesh[] {
        return this._species.map((s) => s.mesh);
    }

    getTotalCount(): number {
        return this._species.reduce((n, s) => n + s.count, 0);
    }
}
