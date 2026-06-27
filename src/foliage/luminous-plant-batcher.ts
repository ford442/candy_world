import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, sin, positionLocal, normalLocal, mix, attribute } from 'three/tsl';
import { uTime, createJuicyRimLight, createStandardNodeMaterial } from './material-core.ts';
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
const luminousUniforms = getBiomeUniforms(LUMINOUS_BIOME); // demonstrates the helper for a non-arpeggio biome
import { CONFIG } from '../core/config.ts';
import { uTwilight } from './sky.ts';

export class LuminousPlantBatcher {
    private static instance: LuminousPlantBatcher;

    public static getInstance(): LuminousPlantBatcher {
        if (!LuminousPlantBatcher.instance) {
            LuminousPlantBatcher.instance = new LuminousPlantBatcher(CONFIG.luminousPlants.density);
        }
        return LuminousPlantBatcher.instance;
    }
    public mesh: THREE.InstancedMesh;
    private maxInstances: number;
    private count: number = 0;

    constructor(maxInstances: number = 1200) {
        this.maxInstances = maxInstances;

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
        // Circadian pose: additive radial swell that opens plants by day, closes at night
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
        // Circadian night-glow: brighter at night (phase=0), dimmer by day (phase=1).
        // Multiplier lerps from nightGlowMultiplier → 1.0 as phase goes 0 → 1.
        const nightMult = float(CONFIG.circadian.nightGlowMultiplier);
        const circadianGlowMult = mix(nightMult, float(1.0), uCircadianPhase);
        mat.emissiveNode = scaleEmissiveByLod(
            emissiveBase.mul(circadianGlowMult).add(rimLight.mul(sssStrength)).add(twilightGlowTint)
        );

        // Music Impact: subtle direct contribution from the sky-wave-driven noteColor uniform.
        // When the Sky Wave (see music-reactivity.ts + sky_wave in music-bindings.json) fires,
        // the sky melody hue lerps into LuminousPlantUniforms.noteColor and now visibly tints
        // the luminous plants, creating the "color from the moon travels to the ground" effect.
        // Strength is intentionally low so it blends with the primary noteIndex-driven path.
        const skyWaveTint = luminousUniforms.noteColor.mul(0.18);
        mat.emissiveNode = (mat.emissiveNode as any).add(skyWaveTint);  // TSL chaining requires cast in current three version

        this.mesh = new THREE.InstancedMesh(stemGeo, mat, this.maxInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;

        const phaseArray = new Float32Array(maxInstances);
        this.mesh.geometry.setAttribute('aPhaseOffset', new THREE.InstancedBufferAttribute(phaseArray, 1));
        initInstanceLodAttribute(this.mesh, maxInstances);

        this.mesh.userData.type = 'luminous_plant';
        this.mesh.count = 0;

        registerFoliageBatcherLod({ id: 'luminous', getMeshes: () => [this.mesh] });
    }

    getLODMeshes(): THREE.InstancedMesh[] {
        return [this.mesh];
    }


    register(group: THREE.Group): number {
        if (this.count >= this.maxInstances) {
            console.warn('[LuminousPlantBatcher] Max capacity reached');
            return -1;
        }

        const id = this.count;

        // ⚡ OPTIMIZATION: Bypassed deep THREE.Object3D proxy traversals
        group.updateWorldMatrix(false, false);
        // ⚡ OPTIMIZATION: Bypassed THREE.Object3D proxy and setMatrixAt() overhead by writing directly to instanceMatrix.
        group.matrixWorld.toArray(this.mesh.instanceMatrix.array, id * 16);

        const phaseAttr = this.mesh.geometry.getAttribute('aPhaseOffset') as THREE.InstancedBufferAttribute;
        phaseAttr.setX(id, Math.random() * Math.PI * 2);

        this.count++;
        this.mesh.count = this.count;

        this.mesh.instanceMatrix.needsUpdate = true;
        phaseAttr.needsUpdate = true;

        return id;
    }

    dispose(): void {
        if (this.mesh) {
            if (this.mesh.geometry) {
                this.mesh.geometry.dispose();
                const phaseAttr = this.mesh.geometry.getAttribute('aPhaseOffset');
                if (phaseAttr && typeof (phaseAttr as any).dispose === 'function') {
                    try { (phaseAttr as any).dispose(); } catch(e) {}
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
                try { (this.mesh.instanceColor as any).dispose(); } catch (e) {}
            }
            if (this.mesh.instanceMatrix && typeof (this.mesh.instanceMatrix as any).dispose === 'function') {
                try { (this.mesh.instanceMatrix as any).dispose(); } catch (e) {}
            }
        }
    }
}

export const luminousPlantBatcher = new LuminousPlantBatcher(CONFIG.luminousPlants?.density || 150);
