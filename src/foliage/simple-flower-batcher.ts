import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PointsNodeMaterial } from 'three/webgpu';
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
    uAudioLow,
    uPlayerPosition
} from './common.ts';
import { attribute, color as tslColor, positionLocal, vec3, float, mx_noise_float, mix, sin, smoothstep, normalize, length, positionWorld } from 'three/tsl';
import { foliageGroup } from '../world/state.ts';

// Manually define instanceColor if not exported by three/tsl
const instanceColor = attribute('instanceColor', 'vec3');

const MAX_FLOWERS = 5000;
const GRAINS_PER_FLOWER = 5;
const MAX_POLLEN = MAX_FLOWERS * GRAINS_PER_FLOWER;

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

    // Pollen System
    pollenPoints: THREE.Points | null;
    pollenPositions: Float32Array | null;
    pollenOffsets: Float32Array | null;
    pollenColors: Float32Array | null;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.stemMesh = null;
        this.petalMesh = null;
        this.centerMesh = null;
        this.stamenMesh = null;
        this.beamMesh = null;
        this.pollenPoints = null;
        this.pollenPositions = null;
        this.pollenOffsets = null;
        this.pollenColors = null;
    }

    init() {
        if (this.initialized) return;

        // 1. Prepare Geometries

        // Stem: Unit Cylinder
        const stemGeo = sharedGeometries.unitCylinder;

        // Petals: Pre-merged 5-petal flower shape
        const petalGeos: THREE.BufferGeometry[] = [];
        let basePetalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        basePetalGeo = mergeVertices(basePetalGeo);
        basePetalGeo.scale(1, 0.5, 1);

        const petalCount = 5;
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const m = new THREE.Matrix4();
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
        const stamenBase = sharedGeometries.unitCylinder;
        const stamenCount = 3;
        for (let i = 0; i < stamenCount; i++) {
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
        const posBloom = calculateFlowerBloom(positionLocal);
        const posWind = posBloom.add(calculateWindSway(posBloom));
        const posFinal = applyPlayerInteraction(posWind);

        // PALETTE: Enhance Petal Material with "Juice"
        const petalMat = CandyPresets.Velvet(0xFFFFFF, {
            deformationNode: posFinal,
            audioReactStrength: 1.0 // Adds subtle vibration/pulse
        });

        petalMat.colorNode = instanceColor;
        petalMat.sheenColorNode = instanceColor;

        // 3. Add Juicy Rim Light (Neon Edge)
        const rim = createJuicyRimLight(instanceColor, float(1.0), float(3.0));

        // 4. Add Audio-Reactive Glitter
        const glitterNoise = mx_noise_float(positionLocal.mul(float(50.0)).add(uTime.mul(5.0)));
        const glitter = glitterNoise.mul(uAudioHigh).mul(0.5);

        // 5. Add Touch Glow (Player Interaction)
        // If player is close, emit Gold/White glow
        const distToPlayer = length(positionWorld.sub(uPlayerPosition));
        // Fix: smoothstep edges must be low -> high. Invert for distance falloff.
        const touchGlow = float(1.0).sub(smoothstep(0.0, 1.5, distToPlayer));
        const touchColor = vec3(1.0, 0.9, 0.5).mul(touchGlow).mul(2.0); // Gold boost

        // Combine Emissive: Base Emissive (if any) + Rim + Glitter + TouchGlow
        petalMat.emissiveNode = (petalMat.emissiveNode || tslColor(0x000000)).add(rim).add(glitter).add(touchColor);

        // Center: Velvet (Brown) + Chain
        const centerMat = (foliageMaterials as any).flowerCenter.clone();
        (centerMat as any).positionNode = posFinal;

        // Stamens: Clay (Yellow) + Chain
        const stamenMat = createClayMaterial(0xFFFF00, { deformationNode: posFinal });

        // Beam: Enhanced LightBeam
        const beamMat = (foliageMaterials as any).lightBeam.clone();
        beamMat.colorNode = mix(tslColor(0xFFFFFF), instanceColor, float(0.3));
        const bassPulse = float(0.8).add(uAudioLow);
        beamMat.opacityNode = beamMat.opacityNode.mul(bassPulse);

        // 3. Create InstancedMeshes

        this.stemMesh = this.createInstancedMesh(stemGeo, stemMat, MAX_FLOWERS, 'SimpleFlower_Stem');
        this.petalMesh = this.createInstancedMesh(mergedPetals, petalMat, MAX_FLOWERS, 'SimpleFlower_Petal');
        this.centerMesh = this.createInstancedMesh(centerGeo, centerMat, MAX_FLOWERS, 'SimpleFlower_Center');
        this.stamenMesh = this.createInstancedMesh(mergedStamens, stamenMat, MAX_FLOWERS, 'SimpleFlower_Stamen');
        this.beamMesh = this.createInstancedMesh(beamGeo, beamMat, MAX_FLOWERS, 'SimpleFlower_Beam');

        // Add to Scene
        foliageGroup.add(this.stemMesh);
        foliageGroup.add(this.petalMesh);
        foliageGroup.add(this.centerMesh);
        foliageGroup.add(this.stamenMesh);
        foliageGroup.add(this.beamMesh);

        // 4. Pollen System (Juice)
        this.initPollenSystem();

        this.initialized = true;
        console.log(`[SimpleFlowerBatcher] Initialized with capacity ${MAX_FLOWERS}`);
    }

    private initPollenSystem() {
        const pollenGeo = new THREE.BufferGeometry();
        this.pollenPositions = new Float32Array(MAX_POLLEN * 3);
        this.pollenOffsets = new Float32Array(MAX_POLLEN * 3);
        this.pollenColors = new Float32Array(MAX_POLLEN * 3);

        pollenGeo.setAttribute('position', new THREE.BufferAttribute(this.pollenPositions, 3));
        pollenGeo.setAttribute('offset', new THREE.BufferAttribute(this.pollenOffsets, 3));
        pollenGeo.setAttribute('color', new THREE.BufferAttribute(this.pollenColors, 3));

        const pollenMat = new PointsNodeMaterial({
            size: 0.1, // Base Size (overridden by sizeNode)
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        // TSL Logic for Pollen
        const aPos = attribute('position', 'vec3'); // World Pos of Flower Head
        const aOffset = attribute('offset', 'vec3'); // Random Local Offset
        const aColor = attribute('color', 'vec3');

        // Base Position: Flower Head + Local Offset
        const basePos = aPos.add(aOffset);

        // 1. Gentle Hover (Idle)
        const hover = vec3(
            sin(uTime.add(aOffset.x.mul(10.0))).mul(0.05),
            sin(uTime.mul(1.5).add(aOffset.y.mul(10.0))).mul(0.1), // Up/Down
            sin(uTime.add(aOffset.z.mul(10.0))).mul(0.05)
        );

        // 2. Wind Sway (Match Flowers)
        // We pass a proxy local position with Y=1.0 (approx flower height)
        // because calculateWindSway assumes input is local pos relative to pivot at Y=0
        const sway = calculateWindSway(vec3(0.0, 1.0, 0.0));

        // 3. Player Interaction (Wake Turbulence)
        const dist = length(basePos.sub(uPlayerPosition));
        // Fix: smoothstep edges must be low -> high. Invert for distance falloff.
        const push = float(1.0).sub(smoothstep(0.0, 2.5, dist)); // 0 to 1 when close

        // Expand outwards from Player
        const pushDir = normalize(basePos.sub(uPlayerPosition));
        // Turbulence: Swirl based on position + time
        const turb = vec3(
             sin(basePos.y.mul(10.0).add(uTime.mul(10.0))),
             sin(basePos.x.mul(10.0).add(uTime.mul(10.0))),
             sin(basePos.z.mul(10.0).add(uTime.mul(10.0)))
        ).mul(0.2);

        const expansion = pushDir.mul(push).mul(1.5).add(turb.mul(push));

        // Final Position
        pollenMat.positionNode = basePos.add(hover).add(sway).add(expansion);

        // Color: Brighten on interaction
        const brightColor = vec3(1.0, 1.0, 0.8); // White-Gold
        pollenMat.colorNode = mix(aColor, brightColor, push.mul(0.8));

        // Size: Pulse on Audio + Interaction
        const audioPulse = uAudioHigh.mul(0.1);
        const touchPulse = push.mul(0.15);
        pollenMat.sizeNode = float(0.05).add(audioPulse).add(touchPulse);

        // Opacity: Fade out if very far from player? Or always visible?
        // Let's keep them visible but subtle.
        // Fade out slightly when pushed to avoid hard edges?
        pollenMat.opacityNode = float(0.8);

        this.pollenPoints = new THREE.Points(pollenGeo, pollenMat);
        this.pollenPoints.frustumCulled = false; // Always update
        this.pollenPoints.name = 'SimpleFlower_Pollen';

        foliageGroup.add(this.pollenPoints);
    }

    private createInstancedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
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
            _scratchMat.makeScale(0.1, 1.0, 0.1);
            _scratchMat.premultiply(headWorld);
            this.beamMesh!.setMatrixAt(i, _scratchMat);
        } else {
            _scratchMat.makeScale(0, 0, 0);
            _scratchMat.premultiply(headWorld);
            this.beamMesh!.setMatrixAt(i, _scratchMat);
        }

        // --- POLLEN REGISTRATION ---
        if (this.pollenPositions && this.pollenOffsets && this.pollenColors) {
            // Extract World Position of Flower Head
            const headPos = new THREE.Vector3();
            headPos.setFromMatrixPosition(headWorld);

            // Add GRAINS_PER_FLOWER particles
            const startPollen = i * GRAINS_PER_FLOWER;
            for (let p = 0; p < GRAINS_PER_FLOWER; p++) {
                const idx = startPollen + p;

                // Position: Flower Head (Shared base)
                this.pollenPositions[idx * 3] = headPos.x;
                this.pollenPositions[idx * 3 + 1] = headPos.y;
                this.pollenPositions[idx * 3 + 2] = headPos.z;

                // Offset: Random in sphere R=0.25
                const r = 0.25 * Math.random();
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);

                this.pollenOffsets[idx * 3] = r * Math.sin(phi) * Math.cos(theta);
                this.pollenOffsets[idx * 3 + 1] = r * Math.cos(phi) + 0.1; // Slightly above center
                this.pollenOffsets[idx * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

                // Color: Match Flower
                this.pollenColors[idx * 3] = _scratchColor.r;
                this.pollenColors[idx * 3 + 1] = _scratchColor.g;
                this.pollenColors[idx * 3 + 2] = _scratchColor.b;
            }
        }

        this.count++;

        // Mark for update
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

        // Update Pollen
        if (this.pollenPoints) {
            this.pollenPoints.geometry.attributes.position.needsUpdate = true;
            this.pollenPoints.geometry.attributes.offset.needsUpdate = true;
            this.pollenPoints.geometry.attributes.color.needsUpdate = true;
            // Set draw range (count * grains) - wait, Points renders all vertices in buffer by default?
            // Yes, unless we set drawRange.
            this.pollenPoints.geometry.setDrawRange(0, this.count * GRAINS_PER_FLOWER);
        }
    }
}

export const simpleFlowerBatcher = new SimpleFlowerBatcher();
