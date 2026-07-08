import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, sin, positionLocal, normalLocal, mix, attribute } from 'three/tsl';
import { uTime, createJuicyRimLight } from './material-core.ts';
import {
    applyPlayerInteractionWithLod,
    calculateWindSwayWithLod,
    scaleEmissiveByLod,
    applyStandardDeformationWithLod
} from './lod-nodes.ts';
import { initInstanceLodAttribute } from './batcher-lod-utils.ts';
import { registerFoliageBatcherLod } from '../systems/batcher-lod.ts';
import { LuminousPlantUniforms, luminousPlantsNoteColorNode, getBiomeUniforms, uCircadianPhase, uCircadianPoseOffset, type BiomeId } from '../systems/biome-uniforms.ts';

const LUMINOUS_BIOME: BiomeId = 'luminous_plants';
const luminousUniforms = getBiomeUniforms(LUMINOUS_BIOME);
import { CONFIG, FEATURE_FLAGS } from '../core/config.ts';
import { uTwilight } from './sky.ts';
import {
    computePersistentId,
    persistentIdFromString,
    LUMINOUS_PLANT_TYPE_ID,
} from '../systems/awakened-persistent-id.ts';
import { getGroundAlignedQuaternion } from '../world/placement-utils.ts';

const AWAKENED_ATTR_ENABLED = FEATURE_FLAGS.awakenedPersistence;
const LUMINOUS_TYPE_ID = LUMINOUS_PLANT_TYPE_ID;

const _scratchPos = new THREE.Vector3();
const _scratchOriginalQuaternion = new THREE.Quaternion();
const _scratchFinalQuaternion = new THREE.Quaternion();

export class LuminousPlantBatcher {
    private static instance: LuminousPlantBatcher;

    public static getInstance(): LuminousPlantBatcher {
        if (!LuminousPlantBatcher.instance) {
            LuminousPlantBatcher.instance = new LuminousPlantBatcher(CONFIG.luminousPlants.density);
        }
        return LuminousPlantBatcher.instance;
    }

    public mesh: THREE.InstancedMesh;
    public readonly isReady = true;
    private maxInstances: number;
    private count: number = 0;

    private readonly persistentIdToIndex = new Map<number, number>();
    private readonly indexToPersistentId = new Uint32Array(0);

    private pendingBulk: Array<{ persistentId: number; scale: number }> = [];
    private uploadMin = Infinity;
    private uploadMax = -1;
    private flushScheduled = false;

    constructor(maxInstances: number = 1200) {
        this.maxInstances = maxInstances;
        this.indexToPersistentId = new Uint32Array(maxInstances);

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
        mat.colorNode = musicColor;

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
        const nightMult = float(CONFIG.circadian.nightGlowMultiplier);
        const circadianGlowMult = mix(nightMult, float(1.0), uCircadianPhase);

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

        mat.emissiveNode = scaleEmissiveByLod(emissiveWithCircadian);

        const skyWaveTint = luminousUniforms.noteColor.mul(0.18);
        mat.emissiveNode = (mat.emissiveNode as any).add(skyWaveTint);

        this.mesh = new THREE.InstancedMesh(stemGeo, mat, this.maxInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        const phaseArray = new Float32Array(maxInstances);
        this.mesh.geometry.setAttribute('aPhaseOffset', new THREE.InstancedBufferAttribute(phaseArray, 1));

        if (AWAKENED_ATTR_ENABLED) {
            const awakenedArray = new Float32Array(maxInstances);
            const emissiveScaleArray = new Float32Array(maxInstances);
            this.mesh.geometry.setAttribute('aAwakened', new THREE.InstancedBufferAttribute(awakenedArray, 1));
            this.mesh.geometry.setAttribute('aEmissiveScale', new THREE.InstancedBufferAttribute(emissiveScaleArray, 1));
        }

        initInstanceLodAttribute(this.mesh, maxInstances);

        this.mesh.userData.type = LUMINOUS_TYPE_ID;
        this.mesh.count = 0;

        registerFoliageBatcherLod({ id: 'luminous', getMeshes: () => [this.mesh] });
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        return [this.mesh];
    }

    getKnownPersistentIds(): ReadonlySet<number> {
        return this.persistentIdToIndex;
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
        if (this.count >= this.maxInstances) {
            console.warn('[LuminousPlantBatcher] Max capacity reached');
            return -1;
        }

        const id = this.count;

        const slopeQ = group.userData.groundSlopeQuaternion as THREE.Quaternion | undefined;
        if (slopeQ) {
            _scratchOriginalQuaternion.copy(group.quaternion);
            group.quaternion.copy(getGroundAlignedQuaternion(group, _scratchFinalQuaternion));
            group.updateWorldMatrix(false, false);
            group.quaternion.copy(_scratchOriginalQuaternion);
        } else {
            group.updateWorldMatrix(false, false);
        }
        group.matrixWorld.toArray(this.mesh.instanceMatrix.array, id * 16);

        const phaseAttr = this.mesh.geometry.getAttribute('aPhaseOffset') as THREE.InstancedBufferAttribute;
        phaseAttr.setX(id, Math.random() * Math.PI * 2);

        if (AWAKENED_ATTR_ENABLED) {
            const awakenedAttr = this.mesh.geometry.getAttribute('aAwakened') as THREE.InstancedBufferAttribute;
            const emissiveAttr = this.mesh.geometry.getAttribute('aEmissiveScale') as THREE.InstancedBufferAttribute;
            awakenedAttr.setX(id, 0);
            emissiveAttr.setX(id, 0);

            const persistentId = this.resolveInstancePersistentId(group, id);
            this.persistentIdToIndex.set(persistentId, id);
            this.indexToPersistentId[id] = persistentId;

            if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
                const again = this.resolveInstancePersistentId(group, id);
                if (again !== persistentId) {
                    console.error('[LuminousPlantBatcher] persistentId unstable for instance', id);
                }
            }
        }

        this.count++;
        this.mesh.count = this.count;

        this.mesh.instanceMatrix.needsUpdate = true;
        phaseAttr.needsUpdate = true;

        this.drainPendingBulk();

        return id;
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

        const count = this.uploadMax - this.uploadMin + 1;
        awakenedAttr.updateRange.offset = this.uploadMin;
        awakenedAttr.updateRange.count = count;
        emissiveAttr.updateRange.offset = this.uploadMin;
        emissiveAttr.updateRange.count = count;
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
        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
                const phaseAttr = this.mesh.geometry.getAttribute('aPhaseOffset');
                if (phaseAttr && typeof (phaseAttr as any).dispose === 'function') {
                    try { (phaseAttr as any).dispose(); } catch (e) { /* ignore */ }
                }
            }
            if (this.mesh.material) {
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach(m => m.dispose());
                } else {
                    (this.mesh.material as any).dispose();
                }
            }
            if (this.mesh.instanceColor && typeof (this.mesh.instanceColor as any).dispose === 'function') {
                try { (this.mesh.instanceColor as any).dispose(); } catch (e) { /* ignore */ }
            }
            if (this.mesh.instanceMatrix && typeof (this.mesh.instanceMatrix as any).dispose === 'function') {
                try { (this.mesh.instanceMatrix as any).dispose(); } catch (e) { /* ignore */ }
            }
        }
    }
}

export const luminousPlantBatcher = new LuminousPlantBatcher(CONFIG.luminousPlants?.density || 150);
