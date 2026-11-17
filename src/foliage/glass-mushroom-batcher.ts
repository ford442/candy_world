// Glass Mycelium Mushroom Batcher — glossy candy-glass fungi with a bioluminescent
// vein network, fake SSS along the stem, circadian night-glow and bass-driven cap ripple.
//
// Companion biome to the Luminous Plants around Melody Lake: it deliberately reuses the
// `luminous_plants` music binding (LuminousPlantUniforms.intensity / noteColor) so the
// mycelium pulses on the same tracker channel without any new music-bindings wiring.
//
// One InstancedMesh, one glass material => a single draw call for the whole grove.

import * as THREE from 'three';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    color, float, vec3, attribute, positionLocal, normalLocal,
    sin, mix, smoothstep, normalWorld, positionWorld, cameraPosition, normalize, dot,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { CONFIG, getCIAdjustedCount } from '../core/config.ts';
import {
    LuminousPlantUniforms,
    luminousPlantsNoteColorNode,
    uCircadianPhase,
    uCircadianPoseOffset,
    circadianNightGlowMult,
} from '../systems/biome-uniforms.ts';
import { foliageGroup } from '../world/state.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import {
    CandyPresets,
    uTime,
    uAudioLow,
    createJuicyRimLight,
    applyStandardDeformation,
} from './material-core.ts';

/** Visual Impact: cyan candy-glass base tint (cool bioluminescent fungus). */
const GLASS_BASE_COLOR = 0x4DE2FF;
const MAX_GLASS_MUSHROOMS = getCIAdjustedCount(600, 0.1, 50);

// Baked proportions: wider cap, shorter stem (the brief's biomorphic silhouette).
const STEM_H = 0.7;
const CAP_Y = STEM_H * 0.92;

let _sharedGlassGeo: THREE.BufferGeometry | null = null;
const _scratchMatrix = new THREE.Matrix4();

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

    // 🎨 PALETTE: Circadian Pose offset logic. Modulate sway/ripple based on day/night phase.
    const circadianModulator = mix(float(0.5), float(1.0), uCircadianPhase);

    const ripple = rippleWave.mul(uAudioLow).mul(0.12).mul(capMask).mul(circadianModulator);
    const idleSway = sin(uTime.mul(1.1).add(aPhase)).mul(0.015).mul(capMask).mul(circadianModulator);

    // 🎨 PALETTE: Stem swell during the day based on uCircadianPoseOffset
    const stemMask = capMask.oneMinus();
    const heightFactor = positionLocal.y.div(STEM_H).clamp(0.0, 1.0);
    const circadianSwell = normalLocal.mul(uCircadianPoseOffset).mul(heightFactor).mul(stemMask);

    const localDeformation = normalLocal.mul(ripple.add(idleSway)).add(circadianSwell);
    const displaced = positionLocal.add(localDeformation);

    // 🎨 PALETTE: Glass mushrooms now respond to wind and player presence, matching the world's shared physical language.
    mat.positionNode = applyStandardDeformation(displaced);

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
    const circadianGlowMult = circadianNightGlowMult();

    const rim = createJuicyRimLight(musicColor, float(1.0).add(musicEnergy.mul(2.0)), float(3.0), null);

    mat.emissiveNode = musicColor
        .mul(veinGlow.add(innerGlow))
        .mul(circadianGlowMult)
        .add(rim.mul(0.5));

    registerReactiveMaterial(mat);
    return mat;
}

interface GlassRecord {
    /** Column-major instance matrix; updateObject() rewrites it. */
    matrix: Float32Array;
    phase: number;
}

/** Glass mushrooms (#2166: ported to InstancedBatcher). */
export class GlassMushroomBatcher extends InstancedBatcher<GlassRecord> {
    private static _instance: GlassMushroomBatcher | null = null;

    private aPhase!: THREE.InstancedBufferAttribute;

    static getInstance(): GlassMushroomBatcher {
        if (!GlassMushroomBatcher._instance) {
            GlassMushroomBatcher._instance = new GlassMushroomBatcher();
        }
        return GlassMushroomBatcher._instance;
    }

    constructor(maxInstances: number = MAX_GLASS_MUSHROOMS) {
        super('glass-mushroom', 'animate', maxInstances);
        this.rangedUploads = true;
        this.ensureMesh();
    }

    protected createMesh(capacity: number): THREE.InstancedMesh {
        const geo = getGlassMushroomGeometry();
        const mat = createGlassMushroomMaterial();

        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
        mesh.count = 0;
        mesh.userData.type = 'glass_mushroom';

        this.aPhase = this.registerAttribute(
            new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
        );
        mesh.geometry.setAttribute('aPhase', this.aPhase);

        if (foliageGroup) {
            foliageGroup.add(mesh);
        } else {
            console.warn('[GlassMushroomBatcher] foliageGroup not found, glass mushrooms may not be visible.');
        }
        return mesh;
    }

    protected writeRecord(r: GlassRecord, slot: number, array: Float32Array): void {
        array.set(r.matrix, slot * 16);
        this.aPhase.setX(slot, r.phase);
    }

    protected step(): void {
        // Static instances; the TSL graph animates them.
    }

    /** Register a placed glass-mushroom group; returns its current slot or -1 if full. */
    register(group: THREE.Object3D): number {
        _scratchMatrix.compose(group.position, group.quaternion, group.scale);
        const handle = this.addKeyed(group.id, {
            matrix: new Float32Array(_scratchMatrix.elements),
            phase: Math.random() * Math.PI * 2,
        });
        if (handle === null) {
            console.warn('[GlassMushroomBatcher] Max capacity reached');
            return -1;
        }
        this.flush();
        return this.slotOf(handle)!;
    }

    /**
     * Set a registered group's instance matrix. Use this rather than
     * updateInstance(): a slot index moves when another mushroom is removed.
     */
    updateObject(group: THREE.Object3D, matrix: THREE.Matrix4): void {
        const slot = this.slotOfKey(group.id);
        if (slot === undefined) return;
        this.setSlotMatrix(slot, matrix);
    }

    /** Update the instance in slot `index` (slots move on removal; prefer updateObject). */
    updateInstance(index: number, matrix: THREE.Matrix4): void {
        if (index < 0 || index >= this.count) return;
        this.setSlotMatrix(index, matrix);
    }

    private setSlotMatrix(slot: number, matrix: THREE.Matrix4): void {
        const r = this.recordAt(slot)!;
        r.matrix.set(matrix.elements);
        this.mesh!.instanceMatrix.array.set(r.matrix, slot * 16);
        this.markSlotDirty(slot);
        this.flush();
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!logicObject) return;
        if (this.removeKeyed(logicObject.id)) this.flush();
    }

    /** Live instance count — used by world-health / telemetry callers. */
    getCount(): number {
        return this.count;
    }

    dispose(): void {
        // super.dispose() frees the mesh's geometry, which is the shared one;
        // forget it so the next createMesh() builds a fresh one.
        super.dispose();
        _sharedGlassGeo = null;
        if (GlassMushroomBatcher._instance === this) GlassMushroomBatcher._instance = null;
    }
}

export const glassMushroomBatcher = GlassMushroomBatcher.getInstance();
