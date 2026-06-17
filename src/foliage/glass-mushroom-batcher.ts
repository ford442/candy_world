// Glass Mycelium Mushroom Batcher — glossy candy-glass fungi with a bioluminescent
// vein network, fake SSS along the stem, circadian night-glow and bass-driven cap ripple.
//
// Companion biome to the Luminous Plants around Melody Lake: it deliberately reuses the
// `luminous_plants` music binding (LuminousPlantUniforms.intensity / noteColor) so the
// mycelium pulses on the same tracker channel without any new music-bindings wiring.
//
// One InstancedMesh, one glass material => a single draw call for the whole grove.

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    color, float, vec3, attribute, positionLocal, normalLocal,
    sin, mix, smoothstep, normalWorld, positionWorld, cameraPosition, normalize, dot,
} from 'three/tsl';
import {
    CandyPresets,
    uTime,
    uAudioLow,
    calculateWindSway,
    createJuicyRimLight,
    applyPlayerInteraction,
} from './material-core.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { foliageGroup } from '../world/state.ts';
import {
    LuminousPlantUniforms,
    luminousPlantsNoteColorNode,
    uCircadianPhase,
} from '../systems/biome-uniforms.ts';
import { CONFIG } from '../core/config.ts';

/** Visual Impact: cyan candy-glass base tint (cool bioluminescent fungus). */
const GLASS_BASE_COLOR = 0x4DE2FF;
const MAX_GLASS_MUSHROOMS = 600;

// Baked proportions: wider cap, shorter stem (the brief's biomorphic silhouette).
const STEM_H = 0.7;
const CAP_Y = STEM_H * 0.92;

let _sharedGlassGeo: THREE.BufferGeometry | null = null;

function getGlassMushroomGeometry(): THREE.BufferGeometry {
    if (!_sharedGlassGeo) {
        // Short, slightly-bulbous stem anchored at the ground (y = 0).
        const stem = new THREE.CylinderGeometry(0.16, 0.28, STEM_H, 14, 1);
        stem.translate(0, STEM_H * 0.5, 0);

        // Wide, flattened dome cap — only the upper hemisphere, squashed on Y.
        const cap = new THREE.SphereGeometry(0.62, 26, 14, 0, Math.PI * 2, 0, Math.PI * 0.6);
        cap.scale(1.0, 0.5, 1.0);
        cap.translate(0, CAP_Y, 0);

        const merged = mergeGeometries([stem, cap], false);
        merged.computeVertexNormals();
        _sharedGlassGeo = merged;
    }
    return _sharedGlassGeo;
}

function createGlassMushroomMaterial(): MeshStandardNodeMaterial {
    // Visual Impact: glass body — high transmission + low roughness read as candy-glass.
    //   transmission 0.85  → strong see-through refraction (lower for milkier glass)
    //   roughness    0.06  → tight specular highlights (raise for frosted look)
    //   ior          1.4   → gentle refraction (raise toward 2.0 for diamond sparkle)
    //   iridescence  0.0   → emissive is fully owned below; keep preset iridescence off
    const mat = CandyPresets.Crystal(GLASS_BASE_COLOR, {
        transmission: 0.85,
        thickness: 1.2,
        roughness: 0.06,
        ior: 1.4,
        iridescenceStrength: 0.0,
        side: THREE.DoubleSide,
    }) as MeshStandardNodeMaterial;

    const aPhase = attribute('aPhase', 'float');

    // --- Region masks (cap vs. stem) from baked local height ---
    const capMask = smoothstep(STEM_H * 0.72, STEM_H * 0.95, positionLocal.y);
    const radial = positionLocal.xz.length();

    // --- Music + circadian energy ---
    const musicEnergy = LuminousPlantUniforms.intensity;            // 0–1, beat-driven
    const musicColor = mix(color(GLASS_BASE_COLOR), luminousPlantsNoteColorNode, musicEnergy.mul(0.8));
    mat.colorNode = musicColor;

    // --- Phase B reactivity: bass cap ripple ---------------------------------
    // Visual Impact: concentric ripple travels across the cap dome on bass hits.
    //   amplitude 0.12 → raise for splashier jiggle, lower for subtle shimmer.
    const rippleWave = sin(radial.mul(9.0).sub(uTime.mul(4.0)).add(aPhase));
    const ripple = rippleWave.mul(uAudioLow).mul(0.12).mul(capMask);
    const idleSway = sin(uTime.mul(1.1).add(aPhase)).mul(0.015).mul(capMask);
    const displaced = positionLocal.add(normalLocal.mul(ripple.add(idleSway)));
    mat.positionNode = applyPlayerInteraction(displaced.add(calculateWindSway(displaced)));

    // --- Emissive vein network (fake SSS along the stem) ---------------------
    // Glowing filaments climb the body; brighter/denser on the stem than the cap.
    const veinCoord = positionLocal.y.mul(8.0).add(radial.mul(14.0)).add(aPhase);
    const veins = smoothstep(0.68, 1.0, sin(veinCoord).abs());
    const stemBias = capMask.oneMinus().mul(0.6).add(0.4); // veins stronger down the stem

    // Fresnel core glow — the "internal light" of fake subsurface scattering.
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = dot(normalWorld, viewDir).abs();
    const innerGlow = NdotV.pow(1.5).mul(0.28);

    // Visual Impact: emissive intensity tunables.
    //   baseGlow 0.35      → resting self-illumination
    //   musicPulse 0.8     → how hard the tracker channel drives the glow
    //   beatBurst 0.6      → extra cap/vein flash on bass for visible bloom response
    const baseGlow = float(0.35);
    const musicPulse = musicEnergy.mul(0.8);
    const beatBurst = smoothstep(0.3, 1.0, uAudioLow).mul(0.6);
    const veinGlow = veins.mul(stemBias).mul(baseGlow.add(musicPulse).add(beatBurst));

    // Circadian night-glow: brighter at night (phase=0), dimmer by day (phase=1).
    const nightMult = float(CONFIG.circadian.nightGlowMultiplier);
    const circadianGlowMult = mix(nightMult, float(1.0), uCircadianPhase);

    const rim = createJuicyRimLight(musicColor, float(1.0).add(musicEnergy.mul(2.0)), float(3.0), null);

    mat.emissiveNode = musicColor
        .mul(veinGlow.add(innerGlow))
        .mul(circadianGlowMult)
        .add(rim.mul(0.5));

    registerReactiveMaterial(mat);
    return mat;
}

export class GlassMushroomBatcher {
    private static _instance: GlassMushroomBatcher | null = null;

    public mesh: THREE.InstancedMesh;
    private maxInstances: number;
    private count = 0;

    static getInstance(): GlassMushroomBatcher {
        if (!GlassMushroomBatcher._instance) {
            GlassMushroomBatcher._instance = new GlassMushroomBatcher();
        }
        return GlassMushroomBatcher._instance;
    }

    constructor(maxInstances: number = MAX_GLASS_MUSHROOMS) {
        this.maxInstances = maxInstances;

        const geo = getGlassMushroomGeometry();
        const mat = createGlassMushroomMaterial();

        this.mesh = new THREE.InstancedMesh(geo, mat, maxInstances);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = false;
        this.mesh.frustumCulled = true;
        this.mesh.count = 0;
        this.mesh.userData.type = 'glass_mushroom';

        const phaseArray = new Float32Array(maxInstances);
        this.mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArray, 1));

        if (foliageGroup) {
            foliageGroup.add(this.mesh);
        } else {
            console.warn('[GlassMushroomBatcher] foliageGroup not found, glass mushrooms may not be visible.');
        }
    }

    /** Register a placed glass-mushroom group; returns its instance index or -1 if full. */
    register(group: THREE.Object3D): number {
        if (this.count >= this.maxInstances) {
            console.warn('[GlassMushroomBatcher] Max capacity reached');
            return -1;
        }
        const id = this.count;

        group.updateWorldMatrix(true, false);
        group.matrixWorld.toArray(this.mesh.instanceMatrix.array, id * 16);

        const phaseAttr = this.mesh.geometry.getAttribute('aPhase') as THREE.InstancedBufferAttribute;
        phaseAttr.setX(id, Math.random() * Math.PI * 2);

        this.count++;
        this.mesh.count = this.count;
        this.mesh.instanceMatrix.needsUpdate = true;
        phaseAttr.needsUpdate = true;
        return id;
    }

    /** Live instance count — used by world-health / telemetry callers. */
    getCount(): number {
        return this.count;
    }

    dispose(): void {
        if (this.mesh) {
            const phaseAttr = this.mesh.geometry?.getAttribute('aPhase');
            if (phaseAttr && typeof (phaseAttr as any).dispose === 'function') {
                try { (phaseAttr as any).dispose(); } catch { /* noop */ }
            }
            if (this.mesh.geometry && this.mesh.geometry !== _sharedGlassGeo) {
                this.mesh.geometry.dispose();
            }
            if (this.mesh.material) {
                if (Array.isArray(this.mesh.material)) {
                    this.mesh.material.forEach((m) => m.dispose());
                } else {
                    (this.mesh.material as THREE.Material).dispose();
                }
            }
            if (this.mesh.instanceMatrix && typeof (this.mesh.instanceMatrix as any).dispose === 'function') {
                try { (this.mesh.instanceMatrix as any).dispose(); } catch { /* noop */ }
            }
            foliageGroup?.remove(this.mesh);
        }
        if (_sharedGlassGeo) {
            _sharedGlassGeo.dispose();
            _sharedGlassGeo = null;
        }
        this.count = 0;
        GlassMushroomBatcher._instance = null;
    }
}

export const glassMushroomBatcher = GlassMushroomBatcher.getInstance();
