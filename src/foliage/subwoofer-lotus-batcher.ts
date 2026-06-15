import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, positionLocal, normalLocal,
    mix, sin, abs, smoothstep,
    mx_noise_float, uv, length, atan2, max
} from 'three/tsl';
import {
    createClayMaterial,
    sharedGeometries,
    registerReactiveMaterial,
    uAudioLow,
    uGlitchIntensity,
    uTime,
    getCachedProceduralMaterial,
    createJuicyRimLight,
    calculateWindSway,
      applyPlayerInteraction

} from './index.ts';
import { BiomeUniforms } from '../systems/biome-uniforms.ts';
import { makeInteractive } from '../utils/interaction-utils.ts';
import { CONFIG } from '../core/config.ts';
import { uTwilight } from './sky.ts';
import { discoverySystem } from '../systems/discovery.ts';
import { showToast } from '../utils/toast.ts';
import { spawnImpact } from './impacts.ts';
import { foliageGroup } from '../world/state.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const MAX_LOTUS = 100;

export class SubwooferLotusBatcher {
    padMesh!: THREE.InstancedMesh;
    ringsMesh!: THREE.InstancedMesh;
    centerMesh!: THREE.InstancedMesh;

    private _count = 0;
    private _scratchMatrix = new THREE.Matrix4();
    private _color = new THREE.Color();
    private logicObjects: THREE.Object3D[] = [];

    constructor() {
        this.init();
    }

    private init() {
        const hexColor = 0x2E8B57;

        // 1. Base Pad
        const padMat = createClayMaterial(hexColor);
        padMat.positionNode = applyPlayerInteraction(positionLocal.add(calculateWindSway(positionLocal)));
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
    mat.emissiveNode = emission.add(twilightGlowTint).add(rimLight);

    // 🎨 PALETTE: Correct Wind Sway + Player Interaction composition
    const newPos = positionLocal.add(vec3(0.0, displacement, 0.0));
    mat.positionNode = applyPlayerInteraction(newPos.add(calculateWindSway(newPos)));

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
        const angle = float(atan2(vUv.y, vUv.x)).add(spinSpeed.mul(float(1.0).sub(len)));
        const spiral = sin(angle.mul(5.0).sub(len.mul(10.0)));
        const active = max(smoothstep(0.1, 0.5, uGlitchIntensity), smoothstep(0.7, 1.0, uAudioLow));

        const portalColor = vec3(0.0, 0.0, 0.0);
        const swirlColor = vec3(0.5, 0.0, 1.0);
        const hotColor = vec3(1.0, 0.0, 0.5);

        const finalPortal = mix(portalColor, swirlColor, spiral.mul(active));
        const hotCenter = smoothstep(0.2, 0.0, len).mul(hotColor).mul(active);

        centerMat.colorNode = vec3(0.0);
        centerMat.emissiveNode = finalPortal.add(hotCenter);
        centerMat.positionNode = applyPlayerInteraction(positionLocal.add(calculateWindSway(positionLocal)));

        this.centerMesh = new THREE.InstancedMesh(centerGeo, centerMat, MAX_LOTUS);
        this.centerMesh.count = 0;
        this.centerMesh.frustumCulled = false;
        foliageGroup.add(this.centerMesh);
    }

    register(proxy: THREE.Object3D, options: { scale?: number, color?: number } = {}) {
        if (this._count >= MAX_LOTUS) return;

        const scale = options.scale ?? 1.0;
        const i = this._count;
        this._count++;

        proxy.userData.batchIndex = i;
        proxy.userData.lotusScale = scale;

        this.padMesh.count = this._count;
        this.ringsMesh.count = this._count;
        this.centerMesh.count = this._count;

        // Apply Transform initially to prevent frame 1 blip at origin
        // ⚡ OPTIMIZATION: Bypassed THREE.Object3D proxy and setMatrixAt() overhead by writing directly to instanceMatrix.
        this._scratchMatrix.compose(proxy.position, proxy.quaternion, proxy.scale);

        const padScale = new THREE.Vector3(1.5 * scale, 0.2 * scale, 1.5 * scale);
        const padMatrix = new THREE.Matrix4().compose(proxy.position, proxy.quaternion, padScale);
        padMatrix.toArray(this.padMesh.instanceMatrix.array, i * 16);

        const nonPadScale = new THREE.Vector3(scale, scale, scale);
        const nonPadMatrix = new THREE.Matrix4().compose(proxy.position, proxy.quaternion, nonPadScale);
        nonPadMatrix.toArray(this.ringsMesh.instanceMatrix.array, i * 16);
        nonPadMatrix.toArray(this.centerMesh.instanceMatrix.array, i * 16);

        this.padMesh.instanceMatrix.needsUpdate = true;
        this.ringsMesh.instanceMatrix.needsUpdate = true;
        this.centerMesh.instanceMatrix.needsUpdate = true;

        // Interactive Object
        const interactiveGroup = new THREE.Group();
        interactiveGroup.position.copy(proxy.position);
        interactiveGroup.scale.setScalar(scale);
        interactiveGroup.userData.type = 'subwoofer_lotus';
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

        this.logicObjects.push(interactiveGroup);
    }

    // Since we need caller to actually place the proxy first, we provide an updateInstance
    // This allows world generation to register first, then set position, then call updateInstance if needed.
    // Or we can just read the proxy position directly here.
    updateInstance(index: number, proxy: THREE.Object3D) {
         if (index >= this._count) return;
         const scale = proxy.userData.lotusScale ?? 1.0;

         const padScale = new THREE.Vector3(1.5 * scale, 0.2 * scale, 1.5 * scale);
         const padMatrix = new THREE.Matrix4().compose(proxy.position, proxy.quaternion, padScale);
         padMatrix.toArray(this.padMesh.instanceMatrix.array, index * 16);

         const nonPadScale = new THREE.Vector3(scale, scale, scale);
         const nonPadMatrix = new THREE.Matrix4().compose(proxy.position, proxy.quaternion, nonPadScale);
         nonPadMatrix.toArray(this.ringsMesh.instanceMatrix.array, index * 16);
         nonPadMatrix.toArray(this.centerMesh.instanceMatrix.array, index * 16);

         this.padMesh.instanceMatrix.needsUpdate = true;
         this.ringsMesh.instanceMatrix.needsUpdate = true;
         this.centerMesh.instanceMatrix.needsUpdate = true;

         if (this.logicObjects[index]) {
             this.logicObjects[index].position.copy(proxy.position);
             this.logicObjects[index].scale.setScalar(scale);
         }
    }

    dispose() {
        if (this.padMesh) {
            this.padMesh.geometry.dispose();
            if (Array.isArray(this.padMesh.material)) {
                this.padMesh.material.forEach(m => m.dispose());
            } else {
                this.padMesh.material.dispose();
            }
            foliageGroup.remove(this.padMesh);
        }
        if (this.ringsMesh) {
            this.ringsMesh.geometry.dispose();
            if (Array.isArray(this.ringsMesh.material)) {
                this.ringsMesh.material.forEach(m => m.dispose());
            } else {
                this.ringsMesh.material.dispose();
            }
            foliageGroup.remove(this.ringsMesh);
        }
        if (this.centerMesh) {
            this.centerMesh.geometry.dispose();
            if (Array.isArray(this.centerMesh.material)) {
                this.centerMesh.material.forEach(m => m.dispose());
            } else {
                this.centerMesh.material.dispose();
            }
            foliageGroup.remove(this.centerMesh);
        }
        for (const obj of this.logicObjects) {
            if(obj.parent) obj.parent.remove(obj);
        }
        this.logicObjects = [];
        this._count = 0;
    }
}

export const subwooferLotusBatcher = new SubwooferLotusBatcher();
