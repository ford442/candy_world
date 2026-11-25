import * as THREE from 'three';
import { addMergedRange, InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import type { FrameContext } from '../core/scheduler/types.ts';
import { color, float, sin, positionLocal, normalLocal, mix, attribute } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import {
    computePersistentId,
    persistentIdFromString,
    LUMINOUS_PLANT_TYPE_ID,
} from '../systems/awakened/awakened-persistent-id.ts';
import { registerFoliageBatcherLod, unregisterFoliageBatcherLod } from '../systems/batcher-lod.ts';
import { LuminousPlantUniforms, luminousPlantsNoteColorNode, getBiomeUniforms, uCircadianPoseOffset, circadianNightGlowMult, type BiomeId } from '../systems/biome-uniforms.ts';
import { getGroundAlignedQuaternion } from '../world/placement-utils.ts';
import { initInstanceLodAttribute } from './batcher-lod-utils.ts';
import {
    scaleEmissiveByLod,
    applyStandardDeformationWithLod,
    applyFoliageLodMaterialFade} from './lod-nodes.ts';
import { uSeasonLuminousBoost } from './material-core/season-nodes.ts';
import { uTime, createJuicyRimLight, applyBaseContactAO, getBaseContactHeight, $sn } from './material-core.ts';
import { uTwilight } from './sky.ts';

const AWAKENED_ATTR_ENABLED = FEATURE_FLAGS.awakenedPersistence;
const LUMINOUS_TYPE_ID = LUMINOUS_PLANT_TYPE_ID;

const LUMINOUS_BIOME: BiomeId = 'luminous_plants';
const luminousUniforms = getBiomeUniforms(LUMINOUS_BIOME);

const _scratchPos = new THREE.Vector3();
const _scratchOriginalQuaternion = new THREE.Quaternion();
const _scratchFinalQuaternion = new THREE.Quaternion();
let nextLodTargetId = 0;

interface LuminousRecord {
    group: THREE.Group;
    matrix: Float32Array;
}

export class LuminousPlantBatcher extends InstancedBatcher<LuminousRecord> {
    private static instance: LuminousPlantBatcher;

    public static getInstance(): LuminousPlantBatcher {
        if (!LuminousPlantBatcher.instance) {
            LuminousPlantBatcher.instance = new LuminousPlantBatcher(CONFIG.luminousPlants.density);
        }
        return LuminousPlantBatcher.instance;
    }

    declare mesh: THREE.InstancedMesh;
    public readonly isReady = true;
    dropped = 0;

    private readonly persistentIdToIndex = new Map<number, number>();
    private readonly indexToPersistentId = new Uint32Array(0);

    private pendingBulk: Array<{ persistentId: number; scale: number }> = [];
    private uploadMin = Infinity;
    private uploadMax = -1;
    private flushScheduled = false;
    private readonly lodTargetId: string;
    private previousParent: THREE.Object3D | null = null;

    constructor(maxInstances: number = 1200) {
        super('luminous-plants', 'animate', maxInstances);
        const lodId = nextLodTargetId++;
        this.lodTargetId = lodId === 0 ? 'luminous' : `luminous:${lodId}`;
        this.indexToPersistentId = new Uint32Array(maxInstances);
        this.ensureMesh();
        this.registerLod();
    }

    private registerLod(): void {
        registerFoliageBatcherLod({ id: this.lodTargetId, getMeshes: () => this.mesh ? [this.mesh] : [] });
    }

    flush(): void {
        if (this.matricesDirty && this.mesh && AWAKENED_ATTR_ENABLED) {
            // A slot swap/add uploads the whole streams, including any earlier
            // pending narrow awakened ranges.
            (this.mesh.geometry.getAttribute('aAwakened') as THREE.InstancedBufferAttribute).clearUpdateRanges();
            (this.mesh.geometry.getAttribute('aEmissiveScale') as THREE.InstancedBufferAttribute).clearUpdateRanges();
        }
        super.flush();
    }

    protected createMesh(maxInstances: number): THREE.InstancedMesh {
        const stemGeo = new THREE.CylinderGeometry(0.2, 0.4, 4, 8, 4);
        stemGeo.translate(0, 2, 0);

        const pos = stemGeo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            const factor = y / 4.0;
            pos.setX(i, pos.getX(i) + Math.sin(y * 2) * 0.3 * factor);
            pos.setZ(i, pos.getZ(i) + Math.cos(y * 2) * 0.3 * factor);
        }
        stemGeo.computeVertexNormals();

        const mat = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.1,
            transparent: true,
            opacity: 0.95
        });

        const aPhaseOffset = attribute('aPhaseOffset', 'float');
        const baseColor = color(0x66CCFF);

        const pulseSpeed = float(CONFIG.luminousPlants?.pulseSpeed || 1.5);
        const pulseDepth = float(CONFIG.luminousPlants?.pulseDepth || 0.3);
        const localTime = uTime.mul(pulseSpeed).add(aPhaseOffset);

        const heightFactor = positionLocal.y.div(4.0);
        const breathe = sin(localTime).mul(pulseDepth).mul(heightFactor);
        const shockwave = LuminousPlantUniforms.intensity.mul(heightFactor).mul(1.5);
        const circadianSwell = normalLocal.mul(uCircadianPoseOffset).mul(heightFactor);
        const totalDisplacement = normalLocal.mul(breathe.add(shockwave)).add(circadianSwell);
        const animatedBase = positionLocal.add(totalDisplacement);
        mat.positionNode = applyStandardDeformationWithLod(animatedBase);

        const sssStrength = float(CONFIG.luminousPlants?.subsurfaceStrength || 0.8);
        const musicColor = mix(baseColor, luminousPlantsNoteColorNode, LuminousPlantUniforms.intensity);
        mat.colorNode = applyBaseContactAO(
            musicColor,
            positionLocal.y,
            float(getBaseContactHeight('luminous_plant')),
        );

        const musicEnergy = LuminousPlantUniforms.intensity;
        const pulse = musicEnergy.mul(0.6).add(sin(localTime).mul(0.4));
        const activeGlow = float(0.7).add(pulse.mul(float(CONFIG.luminousPlants?.glowIntensity || 2.0)));
        const emissiveBase = musicColor.mul(activeGlow);

        const rimIntensity = float(1.0).add(LuminousPlantUniforms.intensity.mul(2.0));
        const rimLight = createJuicyRimLight(musicColor, rimIntensity, float(3.0), null);
        const glowPhaseOffset = positionLocal.x.add(positionLocal.z).mul(2.0);
        const idlePulse = sin(uTime.mul(float(CONFIG.glow.glowPulseFrequency)).add(glowPhaseOffset)).mul(float(CONFIG.glow.glowPulseAmplitude)).add(1.0).mul(float(0.5)).mul(LuminousPlantUniforms.intensity.mul(0.3).add(0.7));
        const targetGlowColor = color(CONFIG.glow.glowColorMap['luminous_plants'] || 0x66CCFF);
        const twilightGlowTint = targetGlowColor
            .mul(uTwilight)
            .mul(float(CONFIG.glow.glowIntensityMax))
            .mul(float(0.3).add(idlePulse));
        const circadianGlowMult = circadianNightGlowMult();

        let emissiveWithCircadian = emissiveBase.mul(circadianGlowMult).add(rimLight.mul(sssStrength)).add(twilightGlowTint);

        if (AWAKENED_ATTR_ENABLED) {
            const aAwakened = attribute('aAwakened', 'float');
            const aEmissiveScale = attribute('aEmissiveScale', 'float');
            const awakenedBoost = mix(
                float(1.0),
                float(1.0).add(float(CONFIG.glow.awakenedGlowMultiplier)),
                aAwakened
            );
            const persistentGlow = musicColor
                .mul(aAwakened)
                .mul(aEmissiveScale)
                .mul(float(CONFIG.glow.awakenedGlowMultiplier).mul(0.55));
            emissiveWithCircadian = emissiveWithCircadian.mul(awakenedBoost).add(persistentGlow);
        }

        // Winter nights glow brighter (CONFIG.season.luminousBoost).
        mat.emissiveNode = scaleEmissiveByLod(emissiveWithCircadian.mul(uSeasonLuminousBoost));

        const skyWaveTint = luminousUniforms.noteColor.mul(0.18);
        mat.emissiveNode = $sn(mat.emissiveNode).add(skyWaveTint);

        applyFoliageLodMaterialFade(mat);

        const mesh = new THREE.InstancedMesh(stemGeo, mat, maxInstances);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const phaseArray = new Float32Array(maxInstances);
        mesh.geometry.setAttribute('aPhaseOffset', this.registerAttribute(new THREE.InstancedBufferAttribute(phaseArray, 1)));

        if (AWAKENED_ATTR_ENABLED) {
            const awakenedArray = new Float32Array(maxInstances);
            const emissiveScaleArray = new Float32Array(maxInstances);
            mesh.geometry.setAttribute('aAwakened', this.registerAttribute(new THREE.InstancedBufferAttribute(awakenedArray, 1)));
            mesh.geometry.setAttribute('aEmissiveScale', this.registerAttribute(new THREE.InstancedBufferAttribute(emissiveScaleArray, 1)));
        }

        this.registerAttribute(initInstanceLodAttribute(mesh, maxInstances));

        mesh.userData.type = LUMINOUS_TYPE_ID;
        return mesh;
    }

    protected step(_ctx: FrameContext): void {}

    protected writeRecord(record: LuminousRecord, slot: number, array: Float32Array): void {
        array.set(record.matrix, slot * 16);
        record.group.userData.batchIndex = slot;
    }

    protected onSwap(from: number, to: number): void {
        if (AWAKENED_ATTR_ENABLED) {
            const persistentId = this.indexToPersistentId[from];
            this.indexToPersistentId[to] = persistentId;
            this.persistentIdToIndex.set(persistentId, to);
        }
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        return [this.mesh];
    }

    getKnownPersistentIds(): ReadonlySet<number> {
        return new Set(this.persistentIdToIndex.keys());
    }

    hasPersistentId(persistentId: number): boolean {
        return this.persistentIdToIndex.has(persistentId);
    }

    resolveInstancePersistentId(group: THREE.Group, instanceIndex: number): number {
        const ud = group.userData;
        if (typeof ud.persistentId === 'number') {
            return ud.persistentId >>> 0;
        }
        if (typeof ud.persistentId === 'string' && ud.persistentId.length > 0) {
            return persistentIdFromString(ud.persistentId);
        }
        group.getWorldPosition(_scratchPos);
        return computePersistentId(_scratchPos.x, _scratchPos.z, LUMINOUS_TYPE_ID);
    }

    register(group: THREE.Group): number {
        if (!this.mesh) {
            this.ensureMesh();
            this.registerLod();
            if (this.previousParent) {
                this.previousParent.add(this.mesh);
                this.previousParent = null;
            }
        }
        const existing = this.slotOfKey(group.uuid);
        if (existing !== undefined) return existing;
        if (this.count >= this.capacity) {
            if (this.dropped++ === 0) console.warn('[LuminousPlantBatcher] Max capacity reached');
            return -1;
        }

        const id = this.count;

        const slopeQ = group.userData.groundSlopeQuaternion as THREE.Quaternion | undefined;
        if (slopeQ) {
            _scratchOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchFinalQuaternion));
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
            if (group.parent) {
                group.matrixWorld.multiplyMatrices(group.parent.matrixWorld, group.matrixWorld);
            }
            group.quaternion.copy(_scratchOriginalQuaternion);
        } else {
            group.matrixWorld.compose(group.position, group.quaternion, group.scale);
            if (group.parent) {
                group.matrixWorld.multiplyMatrices(group.parent.matrixWorld, group.matrixWorld);
            }
        }
        const handle = this.addKeyed(group.uuid, {
            group,
            matrix: Float32Array.from(group.matrixWorld.elements),
        });
        if (handle === null) return -1;

        const phaseAttr = this.mesh.geometry.getAttribute('aPhaseOffset') as THREE.InstancedBufferAttribute;
        phaseAttr.setX(id, Math.random() * Math.PI * 2);
        (this.mesh.geometry.getAttribute('instanceLodFactor') as THREE.InstancedBufferAttribute).setX(id, 0);

        if (AWAKENED_ATTR_ENABLED) {
            const awakenedAttr = this.mesh.geometry.getAttribute('aAwakened') as THREE.InstancedBufferAttribute;
            const emissiveAttr = this.mesh.geometry.getAttribute('aEmissiveScale') as THREE.InstancedBufferAttribute;
            awakenedAttr.setX(id, 0);
            emissiveAttr.setX(id, 0);

            const persistentId = this.resolveInstancePersistentId(group, id);
            this.persistentIdToIndex.set(persistentId, id);
            this.indexToPersistentId[id] = persistentId;

            const _debugPersistentId = false;
            if (typeof import.meta !== 'undefined' && _debugPersistentId) {
                const again = this.resolveInstancePersistentId(group, id);
                if (again !== persistentId) {
                    console.error('[LuminousPlantBatcher] persistentId unstable for instance', id);
                }
            }
        }

        this.drainPendingBulk();
        this.flush();

        return id;
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!this.mesh) return;

        const indexToRemove = this.slotOfKey(logicObject.uuid);
        if (typeof indexToRemove !== 'number' || indexToRemove < 0 || indexToRemove >= this.count) return;

        const lastIndex = this.count - 1;
        const removedPersistentId = this.indexToPersistentId[indexToRemove];
        if (AWAKENED_ATTR_ENABLED && this.persistentIdToIndex.get(removedPersistentId) === indexToRemove) {
            this.persistentIdToIndex.delete(removedPersistentId);
        }
        this.removeKeyed(logicObject.uuid);
        logicObject.userData.batchIndex = undefined;
        this.indexToPersistentId[lastIndex] = 0;
        this.flush();
    }

    /** Apply awakened glow by stable persistentId */
    applyAwakenedState(persistentId: number, emissiveScale: number): void {
        if (!AWAKENED_ATTR_ENABLED) return;
        const index = this.persistentIdToIndex.get(persistentId);
        if (index === undefined) {
            this.pendingBulk.push({ persistentId, scale: emissiveScale });
            return;
        }
        this.writeAwakenedInstance(index, emissiveScale);
        this.scheduleFlush();
    }

    /** Bulk apply by persistentId — single GPU upload */
    applyAwakenedBulk(entries: Array<{ persistentId: number; scale: number }>): void {
        if (!AWAKENED_ATTR_ENABLED || entries.length === 0) return;

        for (const { persistentId, scale } of entries) {
            const index = this.persistentIdToIndex.get(persistentId);
            if (index === undefined) {
                this.pendingBulk.push({ persistentId, scale });
                continue;
            }
            this.writeAwakenedInstance(index, scale);
        }
        this.flushAwakenedUpload();
    }

    /** @deprecated Use applyAwakenedState */
    setAwakened(instanceIndex: number, emissiveScale: number): void {
        if (!AWAKENED_ATTR_ENABLED) return;
        this.writeAwakenedInstance(instanceIndex, emissiveScale);
        this.scheduleFlush();
    }

    /** @deprecated Use applyAwakenedBulk */
    bulkSetAwakened(entries: Array<{ index: number; scale: number }>): void {
        if (!AWAKENED_ATTR_ENABLED) return;
        for (const { index, scale } of entries) {
            this.writeAwakenedInstance(index, scale);
        }
        this.flushAwakenedUpload();
    }

    private writeAwakenedInstance(instanceIndex: number, emissiveScale: number): void {
        if (instanceIndex < 0 || instanceIndex >= this.count) return;
        const awakenedAttr = this.mesh.geometry.getAttribute('aAwakened') as THREE.InstancedBufferAttribute;
        const emissiveAttr = this.mesh.geometry.getAttribute('aEmissiveScale') as THREE.InstancedBufferAttribute;
        if (!awakenedAttr || !emissiveAttr) return;

        awakenedAttr.setX(instanceIndex, 1);
        emissiveAttr.setX(instanceIndex, emissiveScale);
        this.uploadMin = Math.min(this.uploadMin, instanceIndex);
        this.uploadMax = Math.max(this.uploadMax, instanceIndex);
    }

    private scheduleFlush(): void {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        requestAnimationFrame(() => {
            this.flushScheduled = false;
            this.flushAwakenedUpload();
        });
    }

    private flushAwakenedUpload(): void {
        if (!AWAKENED_ATTR_ENABLED || this.uploadMin > this.uploadMax) return;

        const awakenedAttr = this.mesh.geometry.getAttribute('aAwakened') as THREE.InstancedBufferAttribute;
        const emissiveAttr = this.mesh.geometry.getAttribute('aEmissiveScale') as THREE.InstancedBufferAttribute;
        if (!awakenedAttr || !emissiveAttr) return;

        // three r159+ replaced attr.updateRange with updateRanges; writing the
        // old field threw (it is undefined), so this upload never ran.
        const count = this.uploadMax - this.uploadMin + 1;
        addMergedRange(awakenedAttr, this.uploadMin, count);
        addMergedRange(emissiveAttr, this.uploadMin, count);
        awakenedAttr.needsUpdate = true;
        emissiveAttr.needsUpdate = true;

        this.uploadMin = Infinity;
        this.uploadMax = -1;
    }

    private drainPendingBulk(): void {
        if (!AWAKENED_ATTR_ENABLED || this.pendingBulk.length === 0) return;
        const remaining: Array<{ persistentId: number; scale: number }> = [];
        for (const entry of this.pendingBulk) {
            const index = this.persistentIdToIndex.get(entry.persistentId);
            if (index === undefined) {
                remaining.push(entry);
                continue;
            }
            this.writeAwakenedInstance(index, entry.scale);
        }
        this.pendingBulk = remaining;
        if (this.uploadMin <= this.uploadMax) {
            this.flushAwakenedUpload();
        }
    }

    dispose(): void {
        for (const record of this.records) if (record) record.group.userData.batchIndex = undefined;
        if (this.mesh) this.previousParent = this.mesh.parent;
        unregisterFoliageBatcherLod(this.lodTargetId);
        super.dispose();
        this.persistentIdToIndex.clear();
        this.indexToPersistentId.fill(0);
        this.pendingBulk = [];
        this.uploadMin = Infinity;
        this.uploadMax = -1;
        this.dropped = 0;
    }
}

export const luminousPlantBatcher = LuminousPlantBatcher.getInstance();
