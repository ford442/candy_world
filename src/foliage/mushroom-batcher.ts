import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { instanceIndex, color, float, vec3, vec4, attribute, positionLocal,
    sin, cos, mix, smoothstep, uniform, If, time,
    varying, dot, normalize, normalLocal, step, Fn, positionWorld, normalWorld,
    max, pow, min, cameraPosition, uv, floor, instanceIndex, varyingProperty
} from 'three/tsl';

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, createRimLight, createJuicyRimLight, uPlayerPosition, colorFromNote,
    createSugarSparkle, applyPlayerInteraction, calculateWindSway, calculateWindSway
} from './index.ts';
import { uTwilight } from './sky.ts';
import { BiomeUniforms, uCircadianPhase } from '../systems/biome-uniforms.ts';
import { foliageGroup } from '../world/state.ts'; // Assuming state.ts exports foliageGroup
import { spawnImpact } from './impacts.ts';
import { uChromaticIntensity } from './chromatic.ts';
import { CONFIG } from '../core/config.ts';

const MAX_MUSHROOMS = 4000; // Reduced from 4000 for WebGPU uniform buffer limits

// Scratch variables to prevent GC
const _scratchMatrix = new THREE.Matrix4();
const _scratchMatrix2 = new THREE.Matrix4(); // ⚡ OPTIMIZATION: Additional scratch matrix
const _scratchPos = new THREE.Vector3();
const _scratchScale = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchColor = new THREE.Color();
// ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
const _scratchCapCenter = new THREE.Vector3();
const _scratchSpotScale = new THREE.Vector3();
const _scratchUp = new THREE.Vector3(0, 1, 0);
const _scratchEye = new THREE.Vector3();
const _scratchDummyObj = new THREE.Object3D();

export class MushroomBatcher {
    private static instance: MushroomBatcher;
    private initialized = false;
    private count = 0;

    // Mesh & Attributes
    public mesh: THREE.InstancedMesh | null = null;
    // OPTIMIZED: Packed into single vec4 to reduce vertex buffers from 11 to 8
    // instanceData: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
    // packedFlags encoding: noteIndex+1 + hasFace*20 + isGiant*40
    private instanceData: THREE.InstancedBufferAttribute | null = null;

    // Mapping: Note Index (0-11) -> Array of Instance Indices
    private noteToInstances: Map<number, number[]> = new Map();

    // Mapping: Logic ID -> Instance Index (for removal)
    private logicIdToInstance: Map<number, number> = new Map();
    // Mapping: Instance Index -> Logic ID
    private instanceToLogicId: number[] = [];

    private constructor() {}

    getRandomPosition(out: THREE.Vector3): boolean {
        if (!this.mesh || this.count === 0) return false;
        const idx = Math.floor(Math.random() * this.count);
        this.mesh.getMatrixAt(idx, _scratchMatrix);
        out.setFromMatrixPosition(_scratchMatrix);
        return true;
    }

    static getInstance(): MushroomBatcher {
        if (!MushroomBatcher.instance) {
            MushroomBatcher.instance = new MushroomBatcher();
        }
        return MushroomBatcher.instance;
    }

    init() {
        if (this.initialized) return;

        // 1. Create Merged Geometry
        const geometry = this.createMergedGeometry();

        // 2. Attributes - SINGLE packed attribute to stay within WebGPU 8 buffer limit
        this.instanceData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_MUSHROOMS * 4), 4);
        geometry.setAttribute('instanceData', this.instanceData);

        // 3. Materials with TSL
        const materials = this.createMaterials();

        // 4. InstancedMesh
        this.mesh = new THREE.InstancedMesh(geometry, materials, MAX_MUSHROOMS);

        // PALETTE: Initialize instanceColor manually since we use TSL
        const colors = new Float32Array(MAX_MUSHROOMS * 3);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
        this.mesh.geometry.setAttribute('instanceColor', this.mesh.instanceColor);

        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = true;

        // Add to Scene (assuming foliageGroup exists and is in scene)
        if (foliageGroup) {
            foliageGroup.add(this.mesh);
        } else {
            console.warn('[MushroomBatcher] foliageGroup not found, mushrooms might not be visible.');
        }

        this.initialized = true;
        console.log('[MushroomBatcher] Initialized with capacity ' + MAX_MUSHROOMS);
    }

    private createMergedGeometry(): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];

        let vertexOffset = 0;
        const addPart = (geo: THREE.BufferGeometry, matIndex: number, transform?: THREE.Matrix4) => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;

            // ⚡ OPTIMIZATION: Scratch vector defined at module level instead of recreating in loop closure
            for (let i = 0; i < posAttr.count; i++) {
                _scratchPos.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                if (transform) _scratchPos.applyMatrix4(transform);
                positions.push(_scratchPos.x, _scratchPos.y, _scratchPos.z);

                // Normals (assuming simple transform without non-uniform scale)
                _scratchPos.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                if (transform) _scratchPos.transformDirection(transform);
                normals.push(_scratchPos.x, _scratchPos.y, _scratchPos.z);

                if (uvAttr) {
                    uvs.push(uvAttr.getX(i), uvAttr.getY(i));
                } else {
                    uvs.push(0, 0);
                }
            }

            if (indexAttr) {
                for (let i = 0; i < indexAttr.count; i++) {
                    indices.push(indexAttr.getX(i) + vertexOffset);
                }
            } else {
                // Non-indexed geometry fallback
                for (let i = 0; i < posAttr.count; i++) {
                    indices.push(i + vertexOffset);
                }
            }

            // Add Group
            // We push a new group for every part. InstancedMesh handles multiple groups fine.
            const count = indexAttr ? indexAttr.count : posAttr.count;
            // We defer group creation to the end, but we need to track ranges.
            // Actually, BufferGeometry groups are cumulative.

            // To simplify, we will create ONE group per material index.
            // This requires sorting or just being careful.
            // Since we add parts in order of material index, we can just track start/end.
        };

        const groups: { start: number, count: number, materialIndex: number }[] = [];
        const matIndices = [0, 1, 2, 3, 4, 5, 6, 7];
        // 0: Stem, 1: Cap, 2: Gills, 3: Spots, 4: Eye, 5: Pupil, 6: Mouth, 7: Cheek

        // Transform helpers
        // ⚡ OPTIMIZATION: Reuse scratch matrices to avoid GC spikes on every generation call
        const m = _scratchMatrix.identity();
        const q = _scratchQuat.identity(); // ⚡ OPTIMIZATION: Avoid unused allocation
        // s was unused
        const p = _scratchScale; // Use the other unused scratch vector for 'p' (position scratch)

        // 1. Stem (Material 0)
        // Unit Cylinder is centered at 0, 0.5, 0.
        let startIndex = indices.length;
        addPart(sharedGeometries.unitCylinder, 0);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

        // 2. Cap (Material 1)
        // Cap sits at y=1.0 (top of stem). Radius approx 1.0.
        // Cap geometry is sphere 1.0. Center at 0,0,0.
        // We translate it up.
        startIndex = indices.length;
        m.makeTranslation(0, 0.8, 0); // Cap center slightly below top
        addPart(sharedGeometries.mushroomCap, 1, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

        // 3. Gills (Material 2)
        startIndex = indices.length;
        // Gill is cone.
        m.makeTranslation(0, 0.8, 0);
        // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
        _scratchMatrix2.makeRotationX(Math.PI); // Flip upside down
        m.multiply(_scratchMatrix2);
        // Scale gills slightly smaller than cap
        _scratchScale.set(0.9, 0.4, 0.9);
        m.scale(_scratchScale);
        addPart(sharedGeometries.mushroomGillCenter, 2, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 2 });

        // 4. Spots (Material 3)
        // We add a few fixed spots.
        startIndex = indices.length;
        const spotGeo = sharedGeometries.unitSphere;
        const spots = [
            { u: 0.1, v: 0.2 }, { u: 0.4, v: 0.3 }, { u: 0.7, v: 0.25 },
            { u: 0.2, v: 0.6 }, { u: 0.8, v: 0.5 }
        ];

        for (const spot of spots) {
            const theta = 2 * Math.PI * spot.u;
            const phi = Math.acos(1 - spot.v); // Upper hemisphere
            const r = 1.0; // Cap radius
            const x = Math.sin(phi) * Math.cos(theta) * r;
            const y = Math.cos(phi) * r + 0.8; // + offset
            const z = Math.sin(phi) * Math.sin(theta) * r;

            p.set(x, y, z);
            _scratchCapCenter.set(0, 0.8, 0);
            _scratchSpotScale.set(0.15, 0.05, 0.15);
            m.lookAt(p, _scratchCapCenter, _scratchUp);
            m.setPosition(p);
            m.scale(_scratchSpotScale); // Flattened on surface
            addPart(spotGeo, 3, m);
        }
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 3 });

        // 5. Face (Material 4, 5, 6, 7)
        // Face Group Position relative to Stem: (0, 0.6, 0.85) (scaled stem)
        // Here we assume unit scale. Stem H=1, R=1?
        // Wait, Stem R is usually 0.15. Cap R is 0.4.
        // We are building a "Unit Mushroom" here.
        // Stem R=0.15, H=1.0. Cap R=0.4.
        // We should bake these relative scales into the merged geometry?
        // YES. Otherwise non-uniform scaling of the instance will distort the face spheres into ellipsoids.

        // Let's reset and build a "Proportional Unit Mushroom".
        // Reference: stemR ~ 0.15, stemH ~ 1.0, capR ~ 0.4.
        // We will scale the parts here.

        // RESET ARRAYS
        positions.length = 0; normals.length = 0; uvs.length = 0; indices.length = 0; groups.length = 0; vertexOffset = 0;

        const STEM_R = 0.15;
        const STEM_H = 1.0;
        const CAP_R = 0.4;
        const CAP_Y = STEM_H - (CAP_R * 0.2);

        // 1. Stem
        startIndex = indices.length;
        m.makeScale(STEM_R, STEM_H, STEM_R);
        // unitCylinder is already translated to 0.5y. So scale works.
        addPart(sharedGeometries.unitCylinder, 0, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 0 });

        // 2. Cap
        startIndex = indices.length;
        m.makeTranslation(0, CAP_Y, 0);
        _scratchScale.set(CAP_R, CAP_R, CAP_R);
        m.scale(_scratchScale);
        addPart(sharedGeometries.mushroomCap, 1, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 1 });

        // 3. Gills
        startIndex = indices.length;
        m.makeTranslation(0, CAP_Y, 0);
        // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
        _scratchMatrix2.makeRotationX(Math.PI);
        m.multiply(_scratchMatrix2);
        _scratchScale.set(CAP_R * 0.9, CAP_R * 0.4, CAP_R * 0.9);
        m.scale(_scratchScale);
        addPart(sharedGeometries.mushroomGillCenter, 2, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 2 });

        // 4. Spots
        startIndex = indices.length;
        for (const spot of spots) {
            const theta = 2 * Math.PI * spot.u;
            const phi = Math.acos(1 - spot.v);
            const x = Math.sin(phi) * Math.cos(theta) * CAP_R;
            const y = Math.cos(phi) * CAP_R + CAP_Y;
            const z = Math.sin(phi) * Math.sin(theta) * CAP_R;

            p.set(x, y, z);
            m.identity();
            _scratchEye.set(0, CAP_Y, 0);
            // lookAt expects eye, target, up
            // We want the spot (at p) to face OUT from center.
            // Actually simple translation + rotation is easier.

            const spotScale = CAP_R * 0.15;
            m.makeTranslation(x, y, z);
            // Rotate to align with normal? sphere is uniform, just scale Y
            // But we need it flush.
            // Complex. Let's just place spheres.
            _scratchScale.set(spotScale, spotScale * 0.2, spotScale);
            m.scale(_scratchScale);
            // Rotate to match surface normal approx?
            // A simple lookAt from center to P gives the rotation.
            // Object local Y is up. We want Y to point along normal.
            _scratchDummyObj.position.copy(p);
            _scratchDummyObj.lookAt(_scratchEye); // Z points to eye. Y is Up.
            // We want Y to point AWAY from eye.
            // If we lookAt(eye), Z is (eye - p).
            // We want Y aligned with (p - eye).

            _scratchPos.copy(p).sub(_scratchEye);
            _scratchPos.add(p);
            _scratchDummyObj.lookAt(_scratchPos); // Look away
            _scratchDummyObj.scale.set(spotScale, spotScale, spotScale * 0.2); // Flatten Z
            _scratchMatrix.compose(_scratchDummyObj.position, _scratchDummyObj.quaternion, _scratchDummyObj.scale);
            addPart(sharedGeometries.unitSphere, 3, _scratchMatrix);
        }
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 3 });

        // Face Logic
        const FACE_Y = STEM_H * 0.6;
        const FACE_Z = STEM_R * 0.85; // Slightly protruding from stem
        const FACE_SCALE = 0.8; // Relative to stem

        // 5. Eyes (Material 4)
        startIndex = indices.length;
        const eyeOffset = 0.15 * FACE_SCALE;
        const eyeY = 0.1 * FACE_SCALE + FACE_Y;
        const eyeZ = 0.1 * FACE_SCALE + FACE_Z;
        const eyeScale = 0.12 * FACE_SCALE; // eyeGeo radius

        m.makeTranslation(-eyeOffset, eyeY, eyeZ);
        _scratchScale.set(1, 1, 1); // unitSphere is R=1. eyeGeo is R=0.12.
        m.scale(_scratchScale);
        // Wait, sharedGeometries.eye is R=0.12.
        // Let's use unitSphere for everything to be safe on transforms.
        _scratchScale.set(eyeScale, eyeScale, eyeScale);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 4, m); // Left Eye

        m.makeTranslation(eyeOffset, eyeY, eyeZ);
        _scratchScale.set(eyeScale, eyeScale, eyeScale);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 4, m); // Right Eye
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 4 });

        // 6. Pupils (Material 5)
        startIndex = indices.length;
        const pupilScale = 0.05 * FACE_SCALE;
        const pupilZ = eyeZ + (eyeScale * 0.8); // Protrude
        m.makeTranslation(-eyeOffset, eyeY, pupilZ);
        _scratchScale.set(pupilScale, pupilScale, pupilScale);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 5, m);

        m.makeTranslation(eyeOffset, eyeY, pupilZ);
        _scratchScale.set(pupilScale, pupilScale, pupilScale);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 5, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 5 });

        // 7. Mouth (Material 6)
        startIndex = indices.length;
        m.makeTranslation(0, FACE_Y - 0.05 * FACE_SCALE, FACE_Z + 0.1 * FACE_SCALE);
        // ⚡ OPTIMIZATION: Re-use scratch variable to avoid GC spikes
        _scratchMatrix2.makeRotationZ(Math.PI);
        m.multiply(_scratchMatrix2); // Smile
        _scratchScale.set(FACE_SCALE, FACE_SCALE, FACE_SCALE);
        m.scale(_scratchScale);
        addPart(sharedGeometries.mushroomSmile, 6, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 6 });

        // 8. Cheeks (Material 7)
        startIndex = indices.length;
        const cheekX = 0.25 * FACE_SCALE;
        const cheekScaleX = 0.08 * FACE_SCALE;
        const cheekScaleY = 0.048 * FACE_SCALE;
        const cheekZ = FACE_Z + 0.05 * FACE_SCALE;

        m.makeTranslation(-cheekX, FACE_Y, cheekZ);
        _scratchScale.set(cheekScaleX, cheekScaleY, cheekScaleX);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 7, m);

        m.makeTranslation(cheekX, FACE_Y, cheekZ);
        _scratchScale.set(cheekScaleX, cheekScaleY, cheekScaleX);
        m.scale(_scratchScale);
        addPart(sharedGeometries.unitSphere, 7, m);
        groups.push({ start: startIndex, count: indices.length - startIndex, materialIndex: 7 });

        // Final Geometry
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setIndex(indices);

        for (let i = 0; i < groups.length; i++) { geo.addGroup(groups[i].start, groups[i].count, groups[i].materialIndex); }

        return geo;
    }

    private createMaterials(): MeshStandardNodeMaterial[] {
        // --- Shared Logic ---
        
        // Unpack properties from instanceData (vec4)
        const instanceData = attribute('aInstanceData', 'vec4');
        const packedFlags = instanceData.x;
        const spawnTime = instanceData.y;
        const triggerTime = instanceData.z;
        const velocity = instanceData.w;

        // Decode Flags
        const hasFace = modFloat(floor(packedFlags.div(20.0)), 2.0);
        const isGiant = floor(packedFlags.div(40.0));

        // Time calculations
        const now = uTime;
        const age = max(float(0.0), now.sub(spawnTime));
        const timeSinceTrigger = max(float(0.0), now.sub(triggerTime));

        // --- Animations ---

        // 1. Spawning Animation (Pop-in scale)
        const tSpawn = smoothstep(0.0, 0.6, age);
        const spawnScale = float(1.0).sub(pow(float(1.0).sub(tSpawn), 3.0));

        // 2. Idle Breathing (Continuous subtle scale variation)
        const breathPhase = age.mul(2.0).add(float(instanceIndex).mul(0.1));
        const breathAmpY = sin(breathPhase).mul(0.02).add(1.0); // 2% stretch
        const breathAmpXZ = cos(breathPhase).mul(0.015).add(1.0);

        // Calculate Scale Multipliers
        const totalScaleY = spawnScale.mul(breathAmpY);
        const totalScaleXZ = spawnScale.mul(breathAmpXZ);

        // Audio reactivity helpers
        const flashIntensity = smoothstep(0.5, 0.0, timeSinceTrigger).mul(velocity);

        const calculateJellyWobble = (pos: any) => {
            const isBouncing = step(timeSinceTrigger, float(0.5));
            const rippleSpeed = float(20.0);
            const rippleFreq = float(5.0);
            const phase = pos.y.mul(rippleFreq).sub(timeSinceTrigger.mul(rippleSpeed));
            return isBouncing.mul(sin(phase)).mul(velocity).mul(0.08); // 8% wobble max
        };

        const deform = (pos: any) => {
            const wobble = calculateJellyWobble(pos);
            const finalScaleY = totalScaleY;
            const finalScaleXZ = totalScaleXZ.add(wobble);

            return vec3(
                pos.x.mul(finalScaleXZ),
                pos.y.mul(finalScaleY),
                pos.z.mul(finalScaleXZ)
            );
        };

        const deformedPos = deform(positionLocal);

        // 🎨 PALETTE: Add wind sway to stem and cap, but not face/gills to save shader compilation complexity
        const finalPosWithWind = applyPlayerInteraction(deformedPos).add(calculateWindSway(deformedPos));
        const finalPosNoWind = applyPlayerInteraction(deformedPos);

        const faceScale = step(0.5, hasFace);
        const faceDeform = (pos: any) => {
            const d = deform(pos).mul(faceScale);
            return applyPlayerInteraction(d);
        };
        const finalFacePos = faceDeform(positionLocal);

        // --- Material Definitions ---

        // 0. Stem
        const stemMat = (foliageMaterials.mushroomStem as MeshStandardNodeMaterial).clone();
        stemMat.positionNode = finalPosWithWind;

        // 1. Cap
        const capList = foliageMaterials.mushroomCap as MeshStandardNodeMaterial[];
        const capMat = capList[0].clone();
        capMat.positionNode = finalPosWithWind;

        // Base color from instance (set via register/setColorAt)
        const baseColor = varyingProperty('vec3', 'vInstanceColor');

        // Add Juicy Rim Light! (Pop against background)
        const audioRimThickness = float(3.0).add(uAudioLow.mul(2.0));
        const audioRimIntensity = float(1.5).add(uAudioLow.mul(1.0));
        const rimLight = createJuicyRimLight(baseColor, audioRimIntensity, audioRimThickness, null);

        // Add Sugar Sparkle! (Palette Polish)
        const sugarSparkle = createSugarSparkle(normalLocal, float(15.0), float(0.3), float(2.0)).mul(uAudioHigh.add(0.5));

        // Inner Glow (Fake SSS)
        const viewDirLocal = normalize(cameraPosition.sub(positionWorld));
        const NdotV = max(dot(normalWorld, viewDirLocal), 0.0);
        const fresnel = pow(float(1.0).sub(NdotV), 3.0);
        const innerGlowFactor = fresnel.mul(float(0.2).add(uAudioLow.mul(0.5)));

        // Replace color Node with dynamic one + Rim + Inner Glow
        capMat.colorNode = baseColor.add(rimLight).add(sugarSparkle).add(innerGlowFactor);

        // --- Glowing Behavior ---

        const glowPhaseOffset = positionWorld.x.add(positionWorld.z).mul(0.5);
        const glowPulseFreq = float(CONFIG.glow.glowPulseFrequency);
        const glowPulseAmp = float(CONFIG.glow.glowPulseAmplitude);

        const idlePulse = sin(uTime.mul(glowPulseFreq).add(glowPhaseOffset)).mul(glowPulseAmp).add(1.0).mul(float(0.5)).mul(uAudioLow.mul(0.5));

        const targetGlowColor = color(CONFIG.glow.glowColorMap['mushroom']);
        const twilightGlowTint = targetGlowColor.mul(uTwilight).mul(float(CONFIG.glow.glowIntensityMax));
        const baseGlow = uTwilight.mul(float(0.5).add(idlePulse));

        const totalGlow = baseGlow.add(flashIntensity).add(sugarSparkle).add(innerGlowFactor.mul(0.3));

        const circadianGlowMult = mix(float(CONFIG.circadian.nightGlowMultiplier), float(1.0), uCircadianPhase);
        capMat.emissiveNode = twilightGlowTint.mul(BiomeUniforms.crystallineNebula.noteColor).mul(totalGlow).mul(circadianGlowMult);
        capMat.emissiveIntensityNode = float(1.0); // Resetting multiplier since we multiply inside node

        // 2. Gills
        const gillMat = (foliageMaterials.mushroomGills as MeshStandardNodeMaterial).clone();
        gillMat.positionNode = finalPosNoWind;
        gillMat.emissiveIntensityNode = totalGlow.mul(0.3);

        // 3. Spots
        const spotMat = (foliageMaterials.mushroomSpots as MeshStandardNodeMaterial).clone();
        spotMat.positionNode = finalPosNoWind;
        const spotPulse = sin(uTime.mul(3.0)).mul(0.1).add(0.3);
        const spotAudio = uAudioHigh.mul(0.8); // 🎨 PALETTE: Make spots pop more on highs
        spotMat.emissiveIntensityNode = flashIntensity.add(spotPulse).add(spotAudio);

        // 4. Eye
        const eyeMat = (foliageMaterials.eye as MeshStandardNodeMaterial).clone();
        eyeMat.positionNode = finalFacePos;

        // 5. Pupil
        const pupilMat = (foliageMaterials.pupil as MeshStandardNodeMaterial).clone();
        pupilMat.positionNode = finalFacePos;

        // 6. Mouth
        const mouthMat = (foliageMaterials.clayMouth as MeshStandardNodeMaterial).clone();
        mouthMat.positionNode = finalFacePos;

        // 7. Cheek
        const cheekMat = (foliageMaterials.mushroomCheek as MeshStandardNodeMaterial).clone();
        cheekMat.positionNode = finalFacePos;

        return [stemMat, capMat, gillMat, spotMat, eyeMat, pupilMat, mouthMat, cheekMat];
    }
    register(dummy: THREE.Object3D, options: any) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_MUSHROOMS) return;

        const i = this.count;
        this.count++;

        // ⚡ OPTIMIZATION: Mark as batched
        dummy.userData.isBatched = true;

        // Track ID for removal
        this.logicIdToInstance.set(dummy.id, i);
        this.instanceToLogicId[i] = dummy.id;

        // 1. Set Matrix
        _scratchMatrix.compose(dummy.position, dummy.quaternion, dummy.scale);
        // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        _scratchMatrix.toArray(this.mesh!.instanceMatrix.array, (i) * 16);

        // PALETTE: Set Color
        // Default to Red (0xFF6B6B) if no note color provided
        const colorHex = options.noteColor !== undefined ? options.noteColor : 0xFF6B6B;
        _scratchColor.setHex(colorHex);
        // ⚡ OPTIMIZATION: Write directly to instanceColor array to bypass .setColorAt overhead.
        if (this.mesh!.instanceColor) {
            const colorArray = this.mesh!.instanceColor.array as Float32Array;
            const colorOffset = i * 3;
            colorArray[colorOffset] = _scratchColor.r;
            colorArray[colorOffset + 1] = _scratchColor.g;
            colorArray[colorOffset + 2] = _scratchColor.b;
        }

        // 2. Set Attributes - Packed into single vec4
        // packedFlags: noteIndex+1 + hasFace*20 + isGiant*40
        const hasFace = options.hasFace ? 1.0 : 0.0;
        const noteIndex = options.noteIndex !== undefined ? options.noteIndex : -1;
        const isGiant = options.size === 'giant' ? 1.0 : 0.0;
        const spawnTime = options.spawnTime || -100.0;
        const packedFlags = (noteIndex + 1) + hasFace * 20 + isGiant * 40;
        
        // instanceData: x=packedFlags, y=spawnTime, z=triggerTime, w=velocity
        this.instanceData!.setXYZW(i, packedFlags, spawnTime, -100.0, 0);

        // 3. Update Mapping
        if (noteIndex >= 0) {
            if (!this.noteToInstances.has(noteIndex)) {
                this.noteToInstances.set(noteIndex, []);
            }
            this.noteToInstances.get(noteIndex)!.push(i);
        }

        this.mesh!.instanceMatrix.needsUpdate = true;
        if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
        this.instanceData!.needsUpdate = true;
    }

    removeInstance(logicObject: THREE.Object3D) {
        if (!this.initialized || !logicObject) return;

        const id = logicObject.id;
        if (!this.logicIdToInstance.has(id)) return;

        const indexToRemove = this.logicIdToInstance.get(id)!;
        const lastIndex = this.count - 1;

        // 1. Remove from Note Mapping
        // Decode noteIndex from packedFlags: noteIndex = (packed % 20) - 1
        const removedPackedFlags = this.instanceData!.getX(indexToRemove);
        const removedNoteIndex = (removedPackedFlags % 20) - 1;
        if (removedNoteIndex >= 0) {
            const list = this.noteToInstances.get(removedNoteIndex);
            if (list) {
                const idx = list.indexOf(indexToRemove);
                if (idx > -1) list.splice(idx, 1);
            }
        }

        // 2. Perform Swap (if not last)
        if (indexToRemove !== lastIndex) {
            const lastId = this.instanceToLogicId[lastIndex];
            // Decode noteIndex from packedFlags
            const lastPackedFlags = this.instanceData!.getX(lastIndex);
            const movedNoteIndex = (lastPackedFlags % 20) - 1;

            // A. Copy Attributes from Last to Removed
            // Matrix
            this.mesh!.getMatrixAt(lastIndex, _scratchMatrix);
            // ⚡ OPTIMIZATION: Write directly to instanceMatrix array instead of updateMatrix + setMatrixAt
        _scratchMatrix.toArray(this.mesh!.instanceMatrix.array, (indexToRemove) * 16);

            // Color
            this.mesh!.getColorAt(lastIndex, _scratchColor);
            // ⚡ OPTIMIZATION: Write directly to instanceColor array to bypass .setColorAt overhead.
            if (this.mesh!.instanceColor) {
                const colorArray = this.mesh!.instanceColor.array as Float32Array;
                const colorOffset = indexToRemove * 3;
                colorArray[colorOffset] = _scratchColor.r;
                colorArray[colorOffset + 1] = _scratchColor.g;
                colorArray[colorOffset + 2] = _scratchColor.b;
            }

            // Single packed attribute
            this.instanceData!.setXYZW(
                indexToRemove,
                this.instanceData!.getX(lastIndex),
                this.instanceData!.getY(lastIndex),
                this.instanceData!.getZ(lastIndex),
                this.instanceData!.getW(lastIndex)
            );

            // B. Update Note Mapping for the MOVED instance
            if (movedNoteIndex >= 0) {
                const list = this.noteToInstances.get(movedNoteIndex);
                if (list) {
                    const idx = list.indexOf(lastIndex);
                    if (idx > -1) list[idx] = indexToRemove;
                }
            }

            // C. Update ID Maps
            this.logicIdToInstance.set(lastId, indexToRemove);
            this.instanceToLogicId[indexToRemove] = lastId;
        }

        // 3. Cleanup
        this.logicIdToInstance.delete(id);
        this.instanceToLogicId[lastIndex] = -1;
        this.count--;

        // 4. Mark Updates
        this.mesh!.count = this.count;
        this.mesh!.instanceMatrix.needsUpdate = true;
        if (this.mesh!.instanceColor) this.mesh!.instanceColor.needsUpdate = true;
        this.instanceData!.needsUpdate = true;
    }

    handleNote(noteIndex: number, velocity: number) {
        if (!this.initialized) return;

        const indices = this.noteToInstances.get(noteIndex);
        if (indices) {
            // PALETTE FIX: Use uTime.value for sync with TSL shader
            // Cast to any to access .value on UniformNode
            const now = ((uTime as any).value !== undefined) ? (uTime as any).value : performance.now() / 1000.0;
            const normalizedVelocity = velocity / 127.0;

            for (const i of indices) {
                // Update triggerTime (z) and velocity (w) in packed attribute
                this.instanceData!.setZ(i, now);
                this.instanceData!.setW(i, normalizedVelocity); // Normalize velocity

                // PALETTE: Spawn Spores!
                if (this.mesh) {
                    this.mesh.getMatrixAt(i, _scratchMatrix);
                    _scratchMatrix.decompose(_scratchPos, _scratchQuat, _scratchScale);
                    this.mesh.getColorAt(i, _scratchColor);

                    // Offset slightly up (cap height approx 1.0 * scale.y)
                    _scratchPos.y += 0.8 * _scratchScale.y;

                    // Spawn impact
                    spawnImpact(_scratchPos, 'spore', _scratchColor);
                }
            }
            this.instanceData!.needsUpdate = true;
            // Optim: Use addUpdateRange if indices are contiguous?
            // Likely not contiguous. Partial update might be slower than full upload if fragmented.
            // Just flag needsUpdate.

            // 🎨 Palette: "Juice" Factor - Add screen bump on high velocity
            if (typeof uChromaticIntensity !== 'undefined' && normalizedVelocity > 0.5) {
                uChromaticIntensity.value = Math.max(uChromaticIntensity.value, normalizedVelocity * 0.3);
            }
        }
    }
}

export const mushroomBatcher = MushroomBatcher.getInstance();
