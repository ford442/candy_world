
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, vec3, attribute, positionLocal, positionWorld,
    sin, smoothstep, uniform, mix,
    Node
} from 'three/tsl';
import {
    sharedGeometries, foliageMaterials, uTime,
    uAudioLow, uAudioHigh, uWindSpeed, uWindDirection,
    createJuicyRimLight, calculateWindSway, applyPlayerInteraction,
    createStandardNodeMaterial
} from './common.ts';
import { uTwilight } from './sky.ts';
import { foliageGroup } from '../world/state.ts';

// Manually define instanceColor if not exported by three/tsl
const instanceColor = attribute('instanceColor', 'vec3');

const MAX_FLOWERS = 5000;
const _scratchMat = new THREE.Matrix4();
const _scratchScale = new THREE.Vector3();
const _scratchColor = new THREE.Color();

export class GlowingFlowerBatcher {
    initialized: boolean;
    count: number;

    // Meshes
    stemMesh: THREE.InstancedMesh | null;
    headMesh: THREE.InstancedMesh | null;
    washMesh: THREE.InstancedMesh | null;

    constructor() {
        this.initialized = false;
        this.count = 0;
        this.stemMesh = null;
        this.headMesh = null;
        this.washMesh = null;
    }

    init() {
        if (this.initialized) return;

        // 1. Prepare Geometries

        // Stem: Unit Cylinder (0.05, height, 0.05) scaled via matrix
        const stemGeo = sharedGeometries.unitCylinder;

        // Head: Unit Sphere (0.2 scale)
        const headGeo = sharedGeometries.unitSphere;

        // Wash: Unit Sphere (1.5 scale)
        const washGeo = sharedGeometries.unitSphere;

        // 2. Prepare Materials

        // --- Day/Night Visibility Logic ---
        // Flowers appear when it gets dark.
        // uTwilight: 0.0 (Day) -> 1.0 (Night/Bioluminescence)
        // We want them to grow/appear as uTwilight goes from 0.4 to 0.8
        const visibilityScale = smoothstep(0.4, 0.8, uTwilight);

        // --- STEM MATERIAL ---
        // Uses standard foliage stem logic + Visibility Scaling
        const stemMat = (foliageMaterials as any).flowerStem.clone();

        // Apply Visibility Scale to Position (scales around pivot at bottom)
        // stemMat.positionNode is already set to (Push + Wind).
        // We need to multiply the final position by visibilityScale?
        // No, positionNode defines the vertex position.
        // If we multiply the WHOLE position by 0, it collapses to (0,0,0).
        // Since pivot is at bottom (0,0,0), this works perfectly for "growing from ground".

        // However, stemMat.positionNode in common.ts is:
        // mat.positionNode = withPush.add(calculateWindSway(positionLocal));
        // We need to wrap this.
        const baseStemPos = stemMat.positionNode;
        stemMat.positionNode = baseStemPos.mul(visibilityScale);


        // --- HEAD MATERIAL ---
        // Emissive Sphere + Pulse + Rim Light
        const headMat = createStandardNodeMaterial({
            color: 0xFFFFFF, // Overridden by instanceColor
            roughness: 0.8
        });

        // 1. Color from Instance
        headMat.colorNode = instanceColor;

        // 2. Emissive Logic
        // Base Emissive = Instance Color
        // Pulse = Audio High (Melody)
        const pulse = uAudioHigh.mul(1.5).add(0.5); // 0.5 to 2.0
        const baseEmissive = instanceColor.mul(pulse);

        // Juicy Rim Light (Cyan/White edge)
        const rim = createJuicyRimLight(instanceColor, float(2.0), float(3.0));

        // Combine
        headMat.emissiveNode = baseEmissive.add(rim);

        // 3. Position Logic (Wind + Push + Visibility)
        // Head is at top of stem. In local space of InstancedMesh (which has matrix applied).
        // The matrix handles the "Place at stem top" (Translate Y).
        // But wait, the Stem scales Y based on random height.
        // The Head matrix also translates Y based on random height.
        // So we just need local deformation (Wind/Push) relative to the Head's position.
        // However, `calculateWindSway` assumes height factor based on Y.
        // Since Head is at top, Y is small (relative to Head center).
        // But in World Space, it works.
        // `calculateWindSway` uses `positionLocal.y` for bending factor.
        // If Head is a separate mesh at (0,H,0), its `positionLocal.y` is roughly 0 (center of sphere).
        // So `calculateWindSway` will return 0 bend!
        // We need to fake the height for bending.
        // The head is effectively at "Height" (from matrix).
        // We can use a fixed height factor for bending since it's always at the top.
        // Or we can assume the head moves with the stem tip.
        // Stem tip movement = calculateWindSway(vec3(0, 1, 0)) [since stem is unit cylinder, top is 1]

        const windSway = calculateWindSway(vec3(0, 1, 0)); // Sway amount at top of unit
        const playerPush = applyPlayerInteraction(vec3(0, 1, 0)); // Push amount at top

        // Apply to Head
        const headPos = positionLocal.mul(visibilityScale).add(windSway).add(playerPush);
        headMat.positionNode = headPos;


        // --- WASH MATERIAL (Volumetric Glow) ---
        // Additive blending, soft edges
        const washMat = (foliageMaterials as any).lightBeam.clone();

        // 1. Color from Instance
        washMat.colorNode = instanceColor;

        // 2. Opacity / Intensity
        // Fade out at edges (Sphere UVs or Normal?)
        // lightBeam material already handles some of this, but it's designed for Cones/Beams.
        // Let's customize for Sphere.
        // Simple fresnel-like falloff: center opaque, edge transparent?
        // Actually for a "Glow" sphere, we want center soft, edge soft.
        // A simple radial gradient in view space?
        // Or just use the sphere geometry and fresnel.
        // lightBeam uses UVs. Sphere UVs are different.
        // Let's just use a simple Fresnel fade.
        // dot(N, V). High at center, low at edge.
        // We want soft glow.

        const washPulse = uAudioLow.mul(0.5).add(0.5); // Bass pulse
        const washOpacity = float(0.3).mul(washPulse).mul(visibilityScale); // Fade with twilight too

        washMat.opacityNode = washOpacity;
        washMat.emissiveNode = instanceColor.mul(washOpacity); // Additive glow

        // 3. Position Logic (Same as Head)
        const washPos = positionLocal.mul(visibilityScale).add(windSway).add(playerPush);
        washMat.positionNode = washPos;


        // 3. Create InstancedMeshes

        this.stemMesh = this.createInstancedMesh(stemGeo, stemMat, MAX_FLOWERS, 'GlowingFlower_Stem');
        this.headMesh = this.createInstancedMesh(headGeo, headMat, MAX_FLOWERS, 'GlowingFlower_Head');
        this.washMesh = this.createInstancedMesh(washGeo, washMat, MAX_FLOWERS, 'GlowingFlower_Wash');

        // TSL Safety: Initialize instanceColor manually to prevent runtime errors with TSL attributes
        this.stemMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 3), 3);
        this.headMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 3), 3);
        this.washMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FLOWERS * 3), 3);

        // Add to Scene
        foliageGroup.add(this.stemMesh);
        foliageGroup.add(this.headMesh);
        foliageGroup.add(this.washMesh);

        this.initialized = true;
        console.log(`[GlowingFlowerBatcher] Initialized with capacity ${MAX_FLOWERS}`);
    }

    private createInstancedMesh(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(geo, mat, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false; // Emissive usually doesn't cast shadow? Stem should.
        if (name.includes('Stem')) mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.name = name;
        return mesh;
    }

    register(logicObject: THREE.Object3D, options: any = {}) {
        if (!this.initialized) this.init();
        if (this.count >= MAX_FLOWERS) {
            console.warn('[GlowingFlowerBatcher] Capacity full');
            return;
        }

        const i = this.count;
        const { color = 0xFFD700 } = options; // Default Gold

        // 1. Calculate Transforms
        logicObject.updateMatrix();
        const baseMatrix = logicObject.matrix;

        // Stem: Scale (0.05, height, 0.05). Height is random.
        const stemHeight = 0.6 + Math.random() * 0.4;
        _scratchScale.set(0.05, stemHeight, 0.05);
        _scratchMat.makeScale(_scratchScale.x, _scratchScale.y, _scratchScale.z);
        _scratchMat.premultiply(baseMatrix);
        this.stemMesh!.setMatrixAt(i, _scratchMat);

        // Head Transform (At top of stem)
        const headLocal = new THREE.Matrix4().makeTranslation(0, stemHeight, 0);
        // Head Scale: 0.2 (from original code)
        headLocal.scale(new THREE.Vector3(0.2, 0.2, 0.2));
        const headWorld = headLocal.clone().premultiply(baseMatrix);
        this.headMesh!.setMatrixAt(i, headWorld);

        // Wash Transform (At top of stem)
        const washLocal = new THREE.Matrix4().makeTranslation(0, stemHeight, 0);
        // Wash Scale: 1.5 (from original code)
        washLocal.scale(new THREE.Vector3(1.5, 1.5, 1.5));
        const washWorld = washLocal.clone().premultiply(baseMatrix);
        this.washMesh!.setMatrixAt(i, washWorld);

        // Color
        if (typeof color === 'number') _scratchColor.setHex(color);
        else if (color instanceof THREE.Color) _scratchColor.copy(color);
        else _scratchColor.set(color as string);

        // Set Colors
        // Stem doesn't use instance color (uses standard stem green), but we can set it if we want custom stem colors.
        // Original code used `foliageMaterials.flowerStem` which is green.
        // But head and wash need the color.
        this.headMesh!.setColorAt(i, _scratchColor);
        this.washMesh!.setColorAt(i, _scratchColor);
        // We set stem color just to be safe, though material might ignore it if not configured to use instanceColor
        this.stemMesh!.setColorAt(i, _scratchColor);

        this.count++;

        // Mark for update
        this.stemMesh!.instanceMatrix.needsUpdate = true;
        this.stemMesh!.count = this.count;

        this.headMesh!.instanceMatrix.needsUpdate = true;
        if (this.headMesh!.instanceColor) this.headMesh!.instanceColor.needsUpdate = true;
        this.headMesh!.count = this.count;

        this.washMesh!.instanceMatrix.needsUpdate = true;
        if (this.washMesh!.instanceColor) this.washMesh!.instanceColor.needsUpdate = true;
        this.washMesh!.count = this.count;
    }
}

export const glowingFlowerBatcher = new GlowingFlowerBatcher();
