import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    color, float, vec3, positionLocal, normalLocal,
    mix, sin, abs, smoothstep,
    mx_noise_float, uv, length, atan, max
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { InstancedBatcher } from '../core/batcher/instanced-batcher.ts';
import { CONFIG, getCIAdjustedCount } from '../core/config.ts';
import { BiomeUniforms, uCircadianPoseOffset, circadianDayGlowMult, circadianNightGlowMult } from '../systems/biome-uniforms.ts';
import { discoverySystem } from '../systems/discovery/discovery-optimized.ts';
import { safeRemoveAndDispose } from "../utils/dispose-utils.ts";
import { makeInteractive } from '../utils/interaction-utils.ts';
import { showToast } from '../utils/toast.ts';
import { foliageGroup } from '../world/state.ts';
import { spawnImpact } from './impacts.ts';
import {
    createClayMaterial,
    sharedGeometries,
    uAudioLow,
    uGlitchIntensity,
    uTime,
    getCachedProceduralMaterial,
    createJuicyRimLight,
    applyStandardDeformation,
} from './material-core.ts';
import { registerReactiveMaterial } from './foliage-reactivity.ts';
import { uTwilight } from './sky.ts';

const MAX_LOTUS = getCIAdjustedCount(100, 0.2, 20);

interface LotusRecord {
    proxy: THREE.Object3D;
    scale: number;
    /** The interactive stand-in the player gazes at / communes with. */
    group: THREE.Group | null;
}

const _padScale = new THREE.Vector3();
const _ringScale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

/**
 * Subwoofer lotuses: pad (primary), rings and portal (linked, same slots)
 * (#2166: ported to InstancedBatcher). `proxy.userData.batchIndex` is still
 * the slot, kept current through onSwap.
 */
export class SubwooferLotusBatcher extends InstancedBatcher<LotusRecord> {
    padMesh!: THREE.InstancedMesh;
    ringsMesh!: THREE.InstancedMesh;
    centerMesh!: THREE.InstancedMesh;

    constructor() {
        super('subwoofer-lotus', 'animate', MAX_LOTUS);
        this.rangedUploads = true;
        this.ensureMesh();
    }

    protected createMesh(): THREE.InstancedMesh {
        const hexColor = 0x2E8B57;

        // 1. Base Pad
        const padMat = createClayMaterial(hexColor);
        const circadianDroopPad = vec3(0, float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        padMat.positionNode = applyStandardDeformation(positionLocal.add(circadianDroopPad));
        this.padMesh = new THREE.InstancedMesh(sharedGeometries.unitCylinder, padMat, MAX_LOTUS);
        this.padMesh.count = 0;
        this.padMesh.castShadow = true;
        this.padMesh.receiveShadow = true;
        this.padMesh.frustumCulled = false;
        foliageGroup.add(this.padMesh);

        // 2. Rings
const ringMat = getCachedProceduralMaterial('subwoofer_lotus_ring', 0xFFFFFF, () => {
    const mat = new MeshStandardNodeMaterial();
    mat.colorNode = color(0xFFFFFF);
    mat.roughnessNode = float(0.2);
    mat.metalnessNode = float(0.5);

    // Audio + glitch driven displacement (keep this)
    const bassPulse = uAudioLow.mul(0.8).mul(BiomeUniforms.crystallineNebula.amplitudeScale);
    const glitchShake = mx_noise_float(vec3(uTime.mul(20.0), float(0.0), float(0.0)))
        .mul(uGlitchIntensity).mul(0.5);
    const displacement = bassPulse.add(glitchShake);

    // Color + emission logic (keep this)
    const normalColor = vec3(1.0, 1.0, 1.0);
    const glitchColor = vec3(0.8, 0.0, 1.0);
    const finalColor = mix(normalColor, glitchColor, uGlitchIntensity);
    const shimmerTint = vec3(0.4, 0.0, 1.0);
    const shimmerGlow = BiomeUniforms.crystallineNebula.shimmer.mul(shimmerTint).mul(2.5);
    const emission = finalColor.mul(bassPulse.add(0.2)).add(shimmerGlow);

    mat.colorNode = finalColor;

    // Glow / twilight logic (keep this)
    const glowPhaseOffset = positionLocal.x.add(positionLocal.z).mul(2.0);
    const idlePulse = sin(uTime.mul(float(CONFIG.glow.glowPulseFrequency)).add(glowPhaseOffset))
        .mul(float(CONFIG.glow.glowPulseAmplitude)).add(1.0).mul(float(0.5))
        .mul(uAudioLow.mul(0.3).add(0.7));
    const targetGlowColor = color(CONFIG.glow.glowColorMap['lotus']);
    const twilightGlowTint = targetGlowColor
        .mul(uTwilight)
        .mul(float(CONFIG.glow.glowIntensityMax))
        .mul(float(0.3).add(idlePulse));

    // 🎨 PALETTE: Juicy Rim Light (good)
    const rimLight = createJuicyRimLight(finalColor, float(2.0), float(3.0), normalLocal);
    // Circadian: lotus rests by day-floor at night; twilight tint still brightens after dusk.
    mat.emissiveNode = emission.mul(circadianDayGlowMult(0.35))
        .add(twilightGlowTint.mul(circadianNightGlowMult()))
        .add(rimLight);

    // 🎨 PALETTE: Correct Wind Sway + Player Interaction composition
    const circadianDroopRing = vec3(0, float(-0.8).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
    const newPos = positionLocal.add(vec3(0.0, displacement, 0.0)).add(circadianDroopRing);
    mat.positionNode = applyStandardDeformation(newPos);

    return mat;
});

        registerReactiveMaterial(ringMat);

        const ringGeos: THREE.BufferGeometry[] = [];
        for (let i = 1; i <= 3; i++) {
            const radius = i * 0.35;
            const ringGeo = new THREE.TorusGeometry(radius, 0.06, 8, 32);
            ringGeo.rotateX(-Math.PI / 2);
            ringGeo.translate(0, 0.3 + (3 - i) * 0.1, 0);
            ringGeos.push(ringGeo);
        }
        const mergedRingsGeo = mergeGeometries(ringGeos);
        for (const g of ringGeos) g.dispose();

        this.ringsMesh = new THREE.InstancedMesh(mergedRingsGeo, ringMat, MAX_LOTUS);
        this.ringsMesh.count = 0;
        this.ringsMesh.frustumCulled = false;
        foliageGroup.add(this.ringsMesh);

        // 3. Center Portal
        const centerGeo = new THREE.CircleGeometry(0.25, 32);
        centerGeo.rotateX(-Math.PI / 2);
        centerGeo.translate(0, 0.6, 0);
        const centerMat = new MeshStandardNodeMaterial();
        centerMat.roughnessNode = float(0.0);

        const vUv = uv().sub(0.5).mul(2.0);
        const len = length(vUv);
        const spinSpeed = uTime.mul(5.0).add(uGlitchIntensity.mul(20.0));
        const angle = float(atan(vUv.y, vUv.x)).add(spinSpeed.mul(float(1.0).sub(len)));
        const spiral = sin(angle.mul(5.0).sub(len.mul(10.0)));
        const active = max(smoothstep(0.1, 0.5, uGlitchIntensity), smoothstep(0.7, 1.0, uAudioLow));

        const portalColor = vec3(0.0, 0.0, 0.0);
        const swirlColor = vec3(0.5, 0.0, 1.0);
        const hotColor = vec3(1.0, 0.0, 0.5);

        const finalPortal = mix(portalColor, swirlColor, spiral.mul(active));
        const hotCenter = smoothstep(0.2, 0.0, len).mul(hotColor).mul(active);

        centerMat.colorNode = vec3(0.0);
        centerMat.emissiveNode = finalPortal.add(hotCenter);
        const circadianDroopCenter = vec3(0, float(-0.5).mul(uCircadianPoseOffset).mul(positionLocal.y), 0);
        centerMat.positionNode = applyStandardDeformation(positionLocal.add(circadianDroopCenter));

        this.centerMesh = new THREE.InstancedMesh(centerGeo, centerMat, MAX_LOTUS);
        this.centerMesh.count = 0;
        this.centerMesh.frustumCulled = false;
        foliageGroup.add(this.centerMesh);

        this.linkMesh(this.ringsMesh);
        this.linkMesh(this.centerMesh);
        return this.padMesh;
    }

    /** Pad is a flattened disc; rings and portal keep the proxy's scale. */
    private writeMatrices(proxy: THREE.Object3D, scale: number, slot: number): void {
        _padScale.set(1.5 * scale, 0.2 * scale, 1.5 * scale);
        _matrix.compose(proxy.position, proxy.quaternion, _padScale);
        _matrix.toArray(this.padMesh.instanceMatrix.array, slot * 16);

        _ringScale.set(scale, scale, scale);
        _matrix.compose(proxy.position, proxy.quaternion, _ringScale);
        _matrix.toArray(this.ringsMesh.instanceMatrix.array, slot * 16);
        _matrix.toArray(this.centerMesh.instanceMatrix.array, slot * 16);
    }

    protected writeRecord(rec: LotusRecord, slot: number): void {
        this.writeMatrices(rec.proxy, rec.scale, slot);
        rec.proxy.userData.batchIndex = slot;
    }

    protected onSwap(_from: number, to: number): void {
        const moved = this.recordAt(to);
        if (moved) moved.proxy.userData.batchIndex = to;
    }

    protected step(): void {}

    register(proxy: THREE.Object3D, options: { scale?: number, color?: number } = {}) {
        const scale = options.scale ?? 1.0;
        const rec: LotusRecord = { proxy, scale, group: null };
        if (this.addKeyed(proxy.uuid, rec) === null) return;

        proxy.userData.lotusScale = scale;

        // Interactive Object
        const interactiveGroup = new THREE.Group();
        interactiveGroup.position.copy(proxy.position);
        interactiveGroup.scale.setScalar(scale);
        interactiveGroup.userData.type = 'subwoofer_lotus';
        proxy.userData.type = 'subwoofer_lotus';
        interactiveGroup.userData.interactionText = "Commune";

        makeInteractive(interactiveGroup);
        interactiveGroup.userData.onInteract = () => {
            if (uGlitchIntensity.value > 0.5) {
                const newlyDiscovered = discoverySystem.discover('bass_portal', 'Bass Portal', '🌀');
                if (newlyDiscovered) {
                    showToast("Hidden Bass Portal Revealed!", "🌀");
                } else {
                    showToast("The Bass Portal is unstable...", "🌀");
                }
                spawnImpact(interactiveGroup.position, 'dash');
            } else {
                showToast("The Lotus hums with latent energy...", "🔊");
            }
        };

        // Add invisible hit volume for interaction
        const hitGeo = new THREE.CylinderGeometry(1.5, 1.5, 2);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.position.y = 1.0;
        interactiveGroup.add(hitMesh);
        foliageGroup.add(interactiveGroup);

        interactiveGroup.userData.proxy = proxy;
        proxy.userData.interactiveGroup = interactiveGroup;
        rec.group = interactiveGroup;
    }

    removeInstance(logicObject: THREE.Object3D) {
        const slot = this.slotOfKey(logicObject.uuid);
        if (slot === undefined) return;
        const group = this.recordAt(slot)?.group;
        this.removeKeyed(logicObject.uuid);
        if (group) safeRemoveAndDispose(group.parent as THREE.Scene, group);
    }

    // World generation registers first, then positions the proxy and calls
    // updateInstance(index, proxy), or the matrices are read at register time.
    updateInstance(index: number, proxy: THREE.Object3D) {
        const rec = this.recordAt(index);
        if (!rec) return;
        const scale = proxy.userData.lotusScale ?? 1.0;
        rec.scale = scale;
        this.writeMatrices(proxy, scale, index);
        this.markSlotDirty(index);

        if (rec.group) {
            rec.group.position.copy(proxy.position);
            rec.group.scale.setScalar(scale);
        }
    }

    dispose() {
        for (const rec of this.records) {
            if (rec?.group) safeRemoveAndDispose(rec.group.parent as THREE.Scene, rec.group);
        }
        super.dispose();
    }

    flushRegistrations(): void {
        this.flush();
    }
}

export const subwooferLotusBatcher = new SubwooferLotusBatcher();
