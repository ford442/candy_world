import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
    foliageMaterials,
    sharedGeometries,
    CandyPresets,
    createClayMaterial,
    calculateFlowerBloom,
    calculateWindSway,
    applyPlayerInteraction,
    createJuicyRimLight,
    uTime,
    uAudioHigh,
    uAudioLow
} from './common.ts';
import { attribute, color as tslColor, positionLocal, vec3, float, mx_noise_float, mix } from 'three/tsl';
import { foliageGroup } from '../world/state.ts';

// Manually define instanceColor if not exported by three/tsl
const instanceColor = attribute('instanceColor', 'vec3');

const MAX_FLOWERS = 5000;
const _scratchMat = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();

export class SimpleFlowerBatcher {
    initialized: boolean;
    count: number;

    // Meshes
    stemMesh: THREE.InstancedMesh | null;
    petalMesh: THREE.InstancedMesh | null;
    centerMesh: THREE.InstancedMesh | null;
    stamenMesh: THREE.InstancedMesh | null;
    beamMesh: THREE.InstancedMesh | null;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.stemMesh = null;
        this.petalMesh = null;
        this.centerMesh = null;
        this.stamenMesh = null;
        this.beamMesh = null;
    }

    init() {
        if (this.initialized) return;

        // 1. Prepare Geometries

        // Stem: Unit Cylinder
        const stemGeo = sharedGeometries.unitCylinder;

        // Petals: Pre-merged 5-petal flower shape
        // We assume a standard "Simple" flower has 5 petals
        const petalGeos: THREE.BufferGeometry[] = [];
        let basePetalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        // Ensure indexed
        basePetalGeo = mergeVertices(basePetalGeo);
        basePetalGeo.scale(1, 0.5, 1);

        const petalCount = 5;
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const m = new THREE.Matrix4();
            // Position/Rotation logic from createFlower
            m.makeRotationZ(Math.PI / 4);
            m.setPosition(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);

            const clone = basePetalGeo.clone();
            clone.applyMatrix4(m);
            petalGeos.push(clone);
        }
        const mergedPetals = mergeGeometries(petalGeos);

        // Center: Unit Sphere
        const centerGeo = sharedGeometries.unitSphere;

        // Stamens: 3 Cylinders
        const stamenGeos: THREE.BufferGeometry[] = [];
        const stamenBase = sharedGeometries.unitCylinder; // Already translated 0..1y
        const stamenCount = 3;
        for (let i = 0; i < stamenCount; i++) {
            // Logic from createFlower
            const rz = (Math.random() - 0.5) * 1.0;
            const rx = (Math.random() - 0.5) * 1.0; // Randomize slightly per batcher init?
            // Ideally we want uniformity for batching, but a little static variation is fine.
            // Using fixed variation for the prototype geometry.
            const fixedRz = (i - 1) * 0.3;
            const fixedRx = 0;

            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(0, 0.075, 0),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(fixedRx, 0, fixedRz)),
                new THREE.Vector3(0.01, 0.15, 0.01)
            );
            const clone = stamenBase.clone();
            clone.applyMatrix4(m);
            stamenGeos.push(clone);
        }
        const mergedStamens = mergeGeometries(stamenGeos);

        // Beam: Cone
        const beamGeo = sharedGeometries.unitCone;

        // 2. Prepare Materials

        // Stem: Reuse existing logic (Wind + Player Push)
        const stemMat = (foliageMaterials as any).flowerStem.clone();

        // Petal: Velvet with Instance Color + Bloom + Wind + Push
        // We need to apply the full deformation chain: Bloom -> Wind -> Push
        // Note: Bloom should apply to Head (Petals, Center, Stamens).
        // Wind/Push applies to everything.
        // TSL Chain:
        const posBloom = calculateFlowerBloom(positionLocal);
        const posWind = posBloom.add(calculateWindSway(posBloom));
        const posFinal = applyPlayerInteraction(posWind);

        // PALETTE: Enhance Petal Material with "Juice"
        // 1. Use Velvet preset as base
        const petalMat = CandyPresets.Velvet(0xFFFFFF, {
            deformationNode: posFinal,
            audioReactStrength: 1.0 // Adds subtle vibration/pulse
        });

        // 2. Override Color with Instance Color
        // This ensures the setColorAt logic actually affects the material visual
        petalMat.colorNode = instanceColor;
        petalMat.sheenColorNode = instanceColor;

        // 3. Add Juicy Rim Light (Neon Edge)
        // Mix instance color with magic cyan for the rim
        const rim = createJuicyRimLight(instanceColor, float(1.0), float(3.0));

        // 4. Add Audio-Reactive Glitter
        // High frequency noise that sparkles on audio high notes
        const glitterNoise = mx_noise_float(positionLocal.mul(float(50.0)).add(uTime.mul(5.0)));
        const glitter = glitterNoise.mul(uAudioHigh).mul(0.5);

        // Combine Emissive: Base Emissive (if any) + Rim + Glitter
        petalMat.emissiveNode = (petalMat.emissiveNode || tslColor(0x000000)).add(rim).add(glitter);

        // Center: Velvet (Brown) + Chain
        const centerMat = (foliageMaterials as any).flowerCenter.clone();
        (centerMat as any).positionNode = posFinal;

        // Stamens: Clay (Yellow) + Chain
        const stamenMat = createClayMaterial(0xFFFF00, { deformationNode: posFinal });

        // Beam: Enhanced LightBeam
        const beamMat = (foliageMaterials as any).lightBeam.clone();

        // PALETTE: Tint Beam with Instance Color (Subtle)
        // Mix white (0xFFFFFF) with instance color (30% strength)
        beamMat.colorNode = mix(tslColor(0xFFFFFF), instanceColor, float(0.3));

        // PALETTE: Pulse Opacity with Bass (Kick)
        // Multiply existing opacity by a pulse factor
        // Base 1.0 + Audio Low * 0.5 -> 1.0 to 1.5 multiplier?
        // Or modulation: 0.5 + AudioLow -> Pulse from dim to bright
        // Let's multiply: opacity * (0.8 + uAudioLow * 1.0)
        const bassPulse = float(0.8).add(uAudioLow);
        beamMat.opacityNode = beamMat.opacityNode.mul(bassPulse);

        // 3. Create InstancedMeshes

        this.stemMesh = this.createInstancedMesh(stemGeo, stemMat, MAX_FLOWERS, 'SimpleFlower_Stem');
        this.petalMesh = this.createInstancedMesh(mergedPetals, petalMat, MAX_FLOWERS, 'SimpleFlower_Petal');
        this.centerMesh = this.createInstancedMesh(centerGeo, centerMat, MAX_FLOWERS, 'SimpleFlower_Center');
        this.stamenMesh = this.createInstancedMesh(mergedStamens, stamenMat, MAX_FLOWERS, 'SimpleFlower_Stamen');

        // Beam is optional, maybe capacity MAX_FLOWERS but we only show for some?
        // Or just create it and scale 0 for those without beam.
        this.beamMesh = this.createInstancedMesh(beamGeo, beamMat, MAX_FLOWERS, 'SimpleFlower_Beam');

        // Add to Scene
        foliageGroup.add(this.stemMesh);
        foliageGroup.add(this.petalMesh);
        foliageGroup.add(this.centerMesh);
        foliageGroup.add(this.stamenMesh);
        foliageGroup.add(this.beamMesh);

        this.initialized = true;
        console.log(`[SimpleFlowerBatcher] Initialized with capacity ${MAX_FLOWERS}`);
    }

    private createInstancedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // Or Static? We define once.
        // Actually, flowers are static after placement usually. Static is better for perf.
        // But we register them sequentially.
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.name = name;
        return mesh;
    }

    register(logicObject: THREE.Object3D, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_FLOWERS) {
            console.warn('[SimpleFlowerBatcher] Capacity full');
            return;
        }

        const i = this.count;
        const { color = 0xFFFFFF } = options;

        // 1. Calculate Transforms
        // The logicObject has the World Position/Rotation/Scale (set by generation.ts or spawner)
        // Wait, logicObject is usually added to foliageGroup.
        // So its matrix is relative to foliageGroup (scene root usually).
        // We need to bake the logicObject's transform into the instanceMatrix.

        logicObject.updateMatrix();
        const baseMatrix = logicObject.matrix;

        // Stem: Scale (0.05, height, 0.05). Height is random.
        const stemHeight = 0.6 + Math.random() * 0.4;
        _scratchScale.set(0.05, stemHeight, 0.05);
        _scratchMat.makeScale(_scratchScale.x, _scratchScale.y, _scratchScale.z);
        _scratchMat.premultiply(baseMatrix); // Apply World Transform
        this.stemMesh!.setMatrixAt(i, _scratchMat);

        // Head Transform (At top of stem)
        // Translation(0, stemHeight, 0) relative to Base.
        const headLocal = new THREE.Matrix4().makeTranslation(0, stemHeight, 0);
        const headWorld = headLocal.clone().premultiply(baseMatrix);

        // Petals
        this.petalMesh!.setMatrixAt(i, headWorld);

        // Color
        if (typeof color === 'number') _scratchColor.setHex(color);
        else if (color instanceof THREE.Color) _scratchColor.copy(color);
        else _scratchColor.set(color as string);
        this.petalMesh!.setColorAt(i, _scratchColor);

        // Center: Scale(0.1)
        _scratchMat.makeScale(0.1, 0.1, 0.1);
        _scratchMat.premultiply(headWorld);
        this.centerMesh!.setMatrixAt(i, _scratchMat);

        // Stamens: No extra scale needed (baked in geometry), just head transform
        this.stamenMesh!.setMatrixAt(i, headWorld);

        // Beam: Random chance
        if (Math.random() > 0.5) {
            // Beam Scale(0.1, 1.0, 0.1)
            // Positioned at stemHeight (headWorld origin)
            _scratchMat.makeScale(0.1, 1.0, 0.1);
            _scratchMat.premultiply(headWorld);
            this.beamMesh!.setMatrixAt(i, _scratchMat);
        } else {
            // Hide beam (scale 0)
            _scratchMat.makeScale(0, 0, 0);
            _scratchMat.premultiply(headWorld);
            this.beamMesh!.setMatrixAt(i, _scratchMat);
        }

        this.count++;

        // Mark for update
        // In a real batcher we might optimize this to update ranges, but for setup phase it's fine.
        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.stemMesh!.count = this.count;

        this.petalMesh!.instanceMatrix.needsUpdate = true;
        if (this.petalMesh!.instanceColor) this.petalMesh!.instanceColor.needsUpdate = true;
        this.petalMesh!.count = this.count;

        this.centerMesh!.instanceMatrix.needsUpdate = true;
        this.centerMesh!.count = this.count;

        this.stamenMesh!.instanceMatrix.needsUpdate = true;
        this.stamenMesh!.count = this.count;

        this.beamMesh!.instanceMatrix.needsUpdate = true;
        this.beamMesh!.count = this.count;

        // Logic Object Cleanup
        // The logic object is still in the scene graph (added by generation.ts).
        // It has no meshes. It serves as an anchor for Interactions.
        // We assume interaction system uses logicObject.position (which is correct).
    }
}

export const simpleFlowerBatcher = new SimpleFlowerBatcher();
