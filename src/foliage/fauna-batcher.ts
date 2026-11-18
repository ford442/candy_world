/**
 * Instanced fauna batcher — one InstancedMesh per species (beetle / hopper / moth).
 * Candy Gummy materials + LOD registration + optional music-reactive glow.
 */

import * as THREE from 'three';
import { color, float, sin, attribute, mix, positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import { CONFIG, getCIAdjustedCount } from '../core/config.ts';
import { registerFoliageBatcherLod } from '../systems/batcher-lod.ts';
import { getBiomeUniforms, type BiomeId } from '../systems/biome-uniforms.ts';
import { FaunaSpecies } from '../systems/fauna/types.ts';
import { foliageGroup } from '../world/state.ts';
import { initInstanceLodAttribute } from './batcher-lod-utils.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { CandyPresets, uTime, uAudioLow, createJuicyRimLight } from './material-core.ts';

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

interface FaunaRecord {
    x: number;
    y: number;
    z: number;
    phase: number;
    glow: number;
    /** Set by setInstanceMatrix; otherwise the matrix is a translation to x, y, z. */
    matrix: THREE.Matrix4 | null;
}

/**
 * One species: its own mesh and its own slots. Callers address a critter by
 * the fauna-system slot (the key), not by instance index.
 */
class FaunaSpeciesBatcher extends InstancedBatcher<FaunaRecord> {
    private phases!: THREE.InstancedBufferAttribute;
    private glows!: THREE.InstancedBufferAttribute;

    constructor(private readonly species: number) {
        super(`fauna-${SPECIES_LABELS[species]}`, 'animate', MAX_PER_SPECIES);
        this.rangedUploads = true;
    }

    init(): void {
        this.ensureMesh();
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        const geo = createSpeciesGeometry(this.species as FaunaSpecies);
        geo.computeVertexNormals();
        const mat = createFaunaMaterial(SPECIES_COLORS[this.species]);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = true;
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.count = 0;
        mesh.name = `Fauna_${SPECIES_LABELS[this.species]}`;
        mesh.userData.faunaSpecies = this.species;

        this.phases = this.registerAttribute(
            new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
        );
        this.glows = this.registerAttribute(
            new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
        );
        geo.setAttribute('aPhase', this.phases);
        geo.setAttribute('aBiomeGlow', this.glows);
        initInstanceLodAttribute(mesh, capacity);

        foliageGroup.add(mesh);
        return mesh;
    }

    protected writeRecord(rec: FaunaRecord, slot: number, array: Float32Array): void {
        if (rec.matrix) rec.matrix.toArray(array, slot * 16);
        else _scratchMatrix.makeTranslation(rec.x, rec.y, rec.z).toArray(array, slot * 16);
        this.phases.array[slot] = rec.phase;
        this.glows.array[slot] = rec.glow;
    }

    protected step(): void {}

    /** Set a critter's matrix and phase in place; `slot` is the fauna-system slot. */
    pose(slot: number, matrix: THREE.Matrix4, phase: number): void {
        const at = this.slotOfKey(slot);
        const rec = at === undefined ? null : this.recordAt(at);
        if (at === undefined || !rec) return;
        // Copy into the record so a later swap re-writes the current pose.
        if (!rec.matrix) rec.matrix = new THREE.Matrix4();
        rec.matrix.copy(matrix);
        rec.phase = phase;
        this.writeRecord(rec, at, this.mesh!.instanceMatrix.array as Float32Array);
        this.markSlotDirty(at);
    }
}

const _scratchMatrix = new THREE.Matrix4();

export class FaunaBatcher {
    private static _instance: FaunaBatcher | null = null;

    private readonly _species: FaunaSpeciesBatcher[] = [];
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
            const sp = new FaunaSpeciesBatcher(s);
            sp.init();
            this._species.push(sp);
        }

        registerFoliageBatcherLod({
            id: 'fauna',
            getMeshes: () => this.getMeshes(),
        });

        this._initialized = true;
    }

    /** Returns the instance index (the draw slot at the time of the call), or -1 when full. */
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
        if (!sp) return -1;
        const rec: FaunaRecord = {
            x,
            y,
            z,
            phase,
            glow: biome === 'luminous_plants' || biome === 'crystalline_nebula' ? 1 : 0.3,
            matrix: null,
        };
        // Unkeyed critters (slot < 0) are never looked up again, so they only need a handle.
        const handle = slot >= 0 ? sp.addKeyed(slot, rec) : sp.add(rec);
        if (handle === null) return -1;
        return sp.slotOf(handle) ?? -1;
    }

    setInstanceMatrix(
        species: FaunaSpecies,
        slot: number,
        matrix: THREE.Matrix4,
        _biome: string,
        phase: number
    ): void {
        this._species[species]?.pose(slot, matrix, phase);
    }

    /** Upload pending changes now; the frame system also does this each frame. */
    syncMatrices(): void {
        for (const sp of this._species) sp.flush();
    }

    /** Swap-with-last removal for ChunkStreamer eviction / chunk unloading. */
    removeInstance(species: FaunaSpecies, slot: number): void {
        this._species[species]?.removeKeyed(slot);
    }

    getMeshes(): THREE.InstancedMesh[] {
        // ⚡ OPTIMIZATION: Zero-allocation loop replacing .map() to prevent GC spikes
        const len = this._species.length;
        const out = new Array(len);
        for (let i = 0; i < len; i++) {
            out[i] = this._species[i].mesh;
        }
        return out;
    }

    getTotalCount(): number {
        // ⚡ OPTIMIZATION: Zero-allocation loop replacing .reduce() to prevent GC spikes
        let total = 0;
        for (let i = 0; i < this._species.length; i++) {
            total += this._species[i].instanceCount;
        }
        return total;
    }
}
