// src/foliage/flowers.ts

import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { 
    foliageMaterials, 
    registerReactiveMaterial, 
    attachReactivity, 
    pickAnimation, 
    createClayMaterial, 
    createStandardNodeMaterial,
    createTransparentNodeMaterial,
    createJuicyRimLight,
    sharedGeometries,
    calculateFlowerBloom,
    calculateWindSway,
    applyPlayerInteraction,
    getCachedProceduralMaterial,
    uTime,
    uAudioHigh,
    uAudioLow
} from './common.ts';
import { color as tslColor, mix, float, positionLocal, Node, uv, vec2, sub, mul, add, sin, length, atan, smoothstep, vec3 } from 'three/tsl';
import { uTwilight } from './sky.ts';
import { lanternBatcher } from './lantern-batcher.ts';
import { simpleFlowerBatcher } from './simple-flower-batcher.ts'; // Kept for legacy compatibility if any
import { glowingFlowerBatcher } from './glowing-flower-batcher.ts';
import { unlockSystem } from '../systems/unlocks.ts';
import { makeInteractiveCylinder } from '../utils/interaction-utils.ts';
import { treeBatcher } from './tree-batcher.ts';
import { flowerBatcher } from './flower-batcher.ts'; // ⚡ OPTIMIZATION: New Unified Batcher
import { spawnImpact } from './impacts.ts';
import { getCircleGeometry, getCylinderGeometry, getTorusGeometry, getSphereGeometry } from '../utils/geometry-dedup.ts';

interface FlowerOptions {
    color?: number | string | THREE.Color | null;
    shape?: 'simple' | 'multi' | 'spiral' | 'layered' | 'sunflower';
}

// ⚡ OPTIMIZATION: Refactored to use FlowerBatcher (Instanced Rendering)
export function createFlower(options: FlowerOptions = {}): THREE.Object3D {
    const { color = null, shape = 'simple' } = options;

    const group = new THREE.Group();
    group.userData.type = 'flower';
    group.userData.interactionText = "🌸 Flower";
    group.userData.isFlower = true; // Signal MusicReactivitySystem to skip CPU animation if handled by batcher
    group.userData.radius = 0.3;

    // ⚡ OPTIMIZATION: Add hitbox for interaction (Batcher handles visuals)
    makeInteractiveCylinder(group, 1.0, 0.3);

    // Metadata for batcher logic
    group.userData.animationType = pickAnimation(['sway', 'wobble', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;

    // Deferred Placement
    group.userData.onPlacement = () => {
         flowerBatcher.register(group, shape, options);
         group.userData.onPlacement = null;
    };

    // Attach Reactivity Metadata (for systems that query it, even if batcher handles visuals)
    // Note: Visual reactivity is baked into TSL shader in FlowerBatcher.
    // We attach this metadata so the object is tracked by MusicReactivitySystem for culling metrics and potential callbacks.
    const reactiveGroup = attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });

    if (shape === 'sunflower' || shape === 'multi') {
        reactiveGroup.userData.minLight = 0.6;
    }

    return reactiveGroup;
}

// ... Rest of the file unchanged ...
interface GlowingFlowerOptions {
    color?: number | string | THREE.Color;
    intensity?: number;
}

// ⚡ OPTIMIZATION: Instanced Glowing Flower (Batched)
export function createGlowingFlower(options: GlowingFlowerOptions = {}): THREE.Group {
    const { color = 0xFFD700 } = options;
    const group = new THREE.Group();

    // 1. Create Proxy Logic Object
    // ⚡ OPTIMIZATION: Use analytic raycast instead of Mesh/Material
    // Cover 0 to 1.2m height, 0.2m radius
    makeInteractiveCylinder(group, 1.2, 0.2);

    // Metadata
    group.userData.type = 'flower';
    group.userData.isFlower = true; // Signals MusicReactivitySystem to skip CPU updates
    group.userData.radius = 0.3;
    group.userData.interactionText = "✨ Glow Flower";

    // Deferred Registration to Batcher
    group.userData.onPlacement = () => {
        glowingFlowerBatcher.register(group, options);
        group.userData.onPlacement = null;
    };

    // Reactivity Metadata for WeatherSystem/Others
    // We manually set userData props that attachReactivity would set
    group.userData.reactivityType = 'flora';
    group.userData.minLight = 0.0;
    group.userData.maxLight = 0.4; // Night only logic (handled by TSL)

    return group;
}

export function createStarflower(options: { color?: number | string | THREE.Color } = {}): THREE.Group {
    const { color: hexColor = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    const stemH = 0.7 + Math.random() * 0.4;
    // ⚡ OPTIMIZATION: Cache Stem
    const stemMat = getCachedProceduralMaterial('starflower_stem', 0x228B22, () => createClayMaterial(0x228B22));
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, stemMat);
    stem.scale.set(0.04, stemH, 0.04);
    stem.castShadow = true;
    group.add(stem);

    // @ts-ignore
    const center = new THREE.Mesh(sharedGeometries.unitSphere, foliageMaterials.flowerCenter);
    center.scale.setScalar(0.09);
    center.position.y = stemH;
    group.add(center);

    // ⚡ OPTIMIZATION: Cache Petals
    const petalMat = getCachedProceduralMaterial('starflower_petal', hexColor, () => {
        const mat = createClayMaterial(hexColor);
        registerReactiveMaterial(mat);
        return mat;
    });

    const petalCount = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(sharedGeometries.unitCone, petalMat);
        petal.scale.set(0.09, 0.2, 0.09);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.16, stemH, Math.sin(angle) * 0.16);
        petal.rotation.x = Math.PI * 0.5;
        petal.rotation.z = angle;
        group.add(petal);
    }

    // ⚡ OPTIMIZATION: Cache Beam
    const beamMat = getCachedProceduralMaterial('starflower_beam', hexColor, () => {
        // @ts-ignore
        const mat = foliageMaterials.lightBeam.clone();
        mat.colorNode = tslColor(hexColor);
        return mat;
    });

    const beam = new THREE.Mesh(sharedGeometries.unitCone, beamMat);
    beam.position.y = stemH;
    beam.scale.set(0.02, 4.0, 0.02);
    beam.userData.isBeam = true;
    group.add(beam);

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'starflower';
    return attachReactivity(group, { minLight: 0.0, maxLight: 0.4 });
}

export function createBellBloom(options: { color?: number | string | THREE.Color } = {}): THREE.Group {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    const stemH = 0.4 + Math.random() * 0.2;
    // ⚡ OPTIMIZATION: Cache Stem
    const stemMat = getCachedProceduralMaterial('bellbloom_stem', 0x2E8B57, () => createClayMaterial(0x2E8B57));
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, stemMat);
    stem.scale.set(0.03, stemH, 0.03);
    stem.castShadow = true;
    stem.position.y = 0;
    group.add(stem);

    // ⚡ OPTIMIZATION: Cache Petals
    const petalMat = getCachedProceduralMaterial('bellbloom_petal', color, () => {
        const mat = createClayMaterial(color);
        registerReactiveMaterial(mat);
        return mat;
    });

    const petals = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petals; i++) {
        const p = new THREE.Mesh(sharedGeometries.unitCone, petalMat);
        p.scale.set(0.12, 0.28, 0.12);
        const angle = (i / petals) * Math.PI * 2;
        p.position.set(Math.cos(angle) * 0.08, -0.08, Math.sin(angle) * 0.08);
        p.rotation.x = Math.PI;
        p.castShadow = true;
        group.add(p);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    group.userData.radius = 0.3;
    
    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPuffballFlower(options: { color?: number } = {}): THREE.Group {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const stemH = 1.0 + Math.random() * 0.5;
    // ⚡ OPTIMIZATION: Cache Stem
    const stemMat = getCachedProceduralMaterial('puffball_stem', 0x6B8E23, () => createClayMaterial(0x6B8E23));
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, stemMat);
    stem.scale.set(0.1, stemH, 0.1);
    stem.position.y = 0;
    stem.castShadow = true;
    group.add(stem);

    const headR = 0.4 + Math.random() * 0.2;
    // ⚡ OPTIMIZATION: Cache Head
    const headMat = getCachedProceduralMaterial('puffball_head', color, () => {
        const mat = createClayMaterial(color);
        registerReactiveMaterial(mat);
        return mat;
    });

    const head = new THREE.Mesh(sharedGeometries.unitSphere, headMat);
    head.scale.setScalar(headR);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    const sporeCount = 4 + Math.floor(Math.random() * 4);
    // ⚡ OPTIMIZATION: Cache Spores
    const sporeMat = getCachedProceduralMaterial('puffball_spore', color + 0x111111, () => {
        const mat = createClayMaterial(color + 0x111111);
        registerReactiveMaterial(mat);
        return mat;
    });

    for (let i = 0; i < sporeCount; i++) {
        const spore = new THREE.Mesh(sharedGeometries.unitSphere, sporeMat);
        spore.scale.setScalar(headR * 0.3);
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.sin(phi) * Math.sin(theta);
        const z = Math.cos(phi);

        spore.position.set(x * headR, stemH + y * headR, z * headR);
        group.add(spore);
    }

    group.userData.animationType = pickAnimation(['sway', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    group.userData.radius = headR * 1.5;
    group.userData.isTrampoline = true;
    group.userData.bounceHeight = stemH;
    group.userData.bounceRadius = headR + 0.3;
    group.userData.bounceForce = 12 + Math.random() * 5;
    group.userData.interactionText = "🚀 Bounce";

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPrismRoseBush(options = {}): THREE.Group {
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Cache Stem
    const stemsMat = getCachedProceduralMaterial('prism_stem', 0x5D4037, () => createClayMaterial(0x5D4037));
    const baseHeight = 1.0 + Math.random() * 0.5;

    const trunk = new THREE.Mesh(sharedGeometries.unitCylinder, stemsMat);
    trunk.scale.set(0.15, baseHeight, 0.15);
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 3 + Math.floor(Math.random() * 3);
    const roseColors = [0xFF0055, 0xFFAA00, 0x00CCFF, 0xFF00FF, 0x00FF88];

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = baseHeight * 0.8;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;
        branchGroup.rotation.z = Math.PI / 4;

        const branchLen = 0.8 + Math.random() * 0.5;
        const branch = new THREE.Mesh(sharedGeometries.unitCylinder, stemsMat);
        branch.scale.set(0.08, branchLen, 0.08);
        branchGroup.add(branch);

        const roseGroup = new THREE.Group();
        roseGroup.position.y = branchLen;

        const hexColor = roseColors[Math.floor(Math.random() * roseColors.length)];
        
        // --- PALETTE: Juicy TSL for Prism Rose Bush ---
        // ⚡ OPTIMIZATION: Cache Petals with Juicy TSL logic preserved
        const petalMat = getCachedProceduralMaterial('prism_petal', hexColor, () => {
            const mat = createStandardNodeMaterial({
                color: hexColor,
                roughness: 0.4, // Shinier to look like hard candy
                emissive: hexColor,
                emissiveIntensity: 0.0 // Managed by TSL below
            });

            // Apply deformation
            const breathScale = float(1.0).add(sin(uTime.mul(2.0)).mul(0.05)).add(uAudioLow.mul(0.2));
            const animatedPos = positionLocal.mul(breathScale);
            mat.positionNode = animatedPos;

            // 3. Audio-reactive Emissive Pulse
            const audioGlow = uAudioHigh.mul(1.5).add(uAudioLow.mul(0.5));
            const colorUniform = tslColor(hexColor);
            const totalEmissive = colorUniform.mul(audioGlow).mul(float(1.0).add(uTwilight));
            mat.emissiveNode = totalEmissive;

            registerReactiveMaterial(mat);
            return mat;
        });

        const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        const outer = new THREE.Mesh(outerGeo, petalMat);
        outer.scale.set(1, 0.6, 1);
        roseGroup.add(outer);

        const innerGeo = sharedGeometries.unitSphere.clone();
        const inner = new THREE.Mesh(innerGeo, petalMat);
        inner.scale.setScalar(0.15);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        // Ensure no hidden material errors related to standard materials mixed with instances
        const washMat = (foliageMaterials as any).lightBeam.clone();
        washMat.colorNode = tslColor(hexColor);
        const wash = new THREE.Mesh(sharedGeometries.unitSphere, washMat);
        wash.scale.setScalar(1.2);
        wash.userData.isWash = true;
        roseGroup.add(wash);

        branchGroup.add(roseGroup);
        group.add(branchGroup);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    
    // ⚡ PERFORMANCE: Set accurate bounding radius for frustum culling
    group.userData.radius = 1.5; // Prism rose bush is larger

    // ⚡ OPTIMIZATION: Register to Batcher
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'prismRoseBush');
        group.userData.onPlacement = null;
    };

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createVibratoViolet(options: { color?: number, intensity?: number } = {}): THREE.Group {
    const { color = 0x8A2BE2, intensity = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = 0.5 + Math.random() * 0.3;
    // ⚡ OPTIMIZATION: Cache Stem
    const stemMat = getCachedProceduralMaterial('violet_stem', 0x228B22, () => createClayMaterial(0x228B22));
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, stemMat);
    stem.scale.set(0.03, stemH, 0.03);
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    // ⚡ OPTIMIZATION: Cache Center
    const centerMat = getCachedProceduralMaterial('violet_center', color, () => {
        const mat = createStandardNodeMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.8 * intensity,
            roughness: 0.3
        });
        registerReactiveMaterial(mat);
        return mat;
    });

    const center = new THREE.Mesh(sharedGeometries.unitSphere, centerMat);
    center.scale.setScalar(0.08);
    headGroup.add(center);

    const petalCount = 5;
    // ⚡ OPTIMIZATION: Use shared geometry via registry (deduplicated)
    const petalGeo = getCircleGeometry(0.15, 8);

    // ⚡ OPTIMIZATION: Cache Petals
    const petalMat = getCachedProceduralMaterial('violet_petal', color, () => {
        const mat = createTransparentNodeMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.4 * intensity,
            roughness: 0.4,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        registerReactiveMaterial(mat);
        return mat;
    });

    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.12, 0, Math.sin(angle) * 0.12);
        petal.rotation.x = -Math.PI / 2 + Math.random() * 0.3;
        petal.rotation.z = angle;
        petal.userData.vibratoPhase = Math.random() * Math.PI * 2;
        headGroup.add(petal);
    }

    const light = new THREE.PointLight(color, 0.3 * intensity, 2.0);
    light.position.y = 0;
    headGroup.add(light);

    group.userData.animationType = 'vibratoShake';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vibratoViolet';
    group.userData.headGroup = headGroup;
    group.userData.interactionText = "Harvest Nectar";

    // Interaction Logic for Harvesting
    group.userData.onInteract = () => {
        if (!group.userData.harvested) {
             unlockSystem.harvest('vibrato_nectar', 1, 'Vibrato Nectar');
             group.userData.harvested = true;

             // Visual feedback
             if (group.userData.headGroup) {
                 // Trigger TSL/render-loop scale animation for juice on the main group
                 group.userData.scaleAnimStart = Date.now();
                 group.userData.scaleAnimTime = 0.15; // 150ms bounce
                 group.userData.scaleTarget = 0.8; // Final shrunken size

                 // Instantaneous squash before the lerp takes over
                 group.scale.set(1.4, 0.4, 1.4);

                 // Dim light
                 const light = group.userData.headGroup.children.find((c:any) => c.isPointLight);
                 if (light) light.intensity *= 0.2;
             }

             // --- PALETTE: Spore burst on harvest ---
             spawnImpact(group.position, 'spore', color);

             group.userData.interactionText = "Harvested";

             // Play sound if available via audioSystem
             if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('pickup', { position: group.position, pitch: 1.5 });
             }
        }
    };

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createTremoloTulip(options: { color?: number, size?: number } = {}): THREE.Group {
    const { color = 0xFF6347, size = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = (0.8 + Math.random() * 0.4) * size;
    // ⚡ OPTIMIZATION: Cache Stem
    const stemMat = getCachedProceduralMaterial('tulip_stem', 0x228B22, () => createClayMaterial(0x228B22));
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, stemMat);
    stem.scale.set(0.04 * size, stemH, 0.04 * size);
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    const bellGeo = getCylinderGeometry(0.2 * size, 0.05 * size, 0.25 * size, 12, 1, true);
    bellGeo.translate(0, -0.125 * size, 0);
    
    // ⚡ OPTIMIZATION: Cache Bell
    const bellMat = getCachedProceduralMaterial('tulip_bell', color, () => {
        const mat = createTransparentNodeMaterial({
            color: color,
            roughness: 0.5,
            opacity: 0.9,
            side: THREE.DoubleSide
        });

        // --- PALETTE: Juicy Rim Light for Tremolo Tulip ---
        // By passing a standard tslColor instead of an instance attribute,
        // we can safely use the juicy rim light on this non-instanced mesh!
        const baseColorNode = tslColor(color);
        const rimLight = createJuicyRimLight(baseColorNode, float(1.5), float(3.0), null);

        // Combine base emissive (0.3 intensity) with the audio-reactive rim light
        mat.emissiveNode = baseColorNode.mul(0.3).add(rimLight);

        registerReactiveMaterial(mat);
        return mat;
    });

    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.rotation.x = Math.PI;
    headGroup.add(bell);

    // --- PALETTE: Juicy TSL Vortex ---
    // ⚡ OPTIMIZATION: Cache Vortex (Color is static white for the base calculation)
    const vortexMat = getCachedProceduralMaterial('tulip_vortex', 0xFFFFFF, () => {
        const mat = new MeshStandardNodeMaterial({
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            side: THREE.DoubleSide
        });

        // Vortex Shader Logic
        const uvCentered = uv().sub(vec2(0.5));
        const dist = length(uvCentered);
        const angle = atan(uvCentered.y, uvCentered.x);

        // Swirling motion: Rotates faster in center and with audio
        const spinSpeed = uTime.mul(2.0).add(uAudioHigh.mul(10.0));
        const twist = dist.mul(20.0);
        const spiral = sin(angle.mul(5.0).sub(spinSpeed).add(twist));

        // Soft circle mask
        const spiralMask = smoothstep(0.4, 0.6, spiral);
        const edgeFade = float(1.0).sub(smoothstep(0.3, 0.5, dist));

        // Audio Reactive Color (Cyan <-> Magenta)
        const baseColor = mix(tslColor(0x00FFFF), tslColor(0xFF00FF), dist.mul(2.0));
        const pulseIntensity = float(1.0).add(uAudioHigh.mul(3.0));

        mat.colorNode = baseColor;
        mat.opacityNode = spiralMask.mul(edgeFade).mul(0.6);
        mat.emissiveNode = baseColor.mul(pulseIntensity).mul(2.0);

        return mat;
    });

    // Use a quad for the portal effect instead of a sphere
    const vortex = new THREE.Mesh(sharedGeometries.quad, vortexMat);
    vortex.scale.setScalar(0.25 * size); // Slightly larger than the sphere was
    vortex.rotation.x = -Math.PI / 2;
    vortex.position.y = -0.1 * size;
    headGroup.add(vortex);
    group.userData.vortex = vortex;

    const rimGeo = getTorusGeometry(0.2 * size, 0.02, 8, 16);
    // ⚡ OPTIMIZATION: Cache Rim
    const rimMat = getCachedProceduralMaterial('tulip_rim', color, () => {
        return createTransparentNodeMaterial({
            color: color,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
    });

    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02 * size;
    headGroup.add(rim);

    group.userData.animationType = 'tremeloPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tremoloTulip';
    group.userData.headGroup = headGroup;
    group.userData.bellMaterial = bellMat;
    group.userData.interactionText = "Harvest Tremolo Bulb";

    // Interaction Logic for Harvesting
    group.userData.onInteract = () => {
        if (!group.userData.harvested) {
             unlockSystem.harvest('tremolo_bulb', 1, 'Tremolo Bulb');
             group.userData.harvested = true;

             // Visual feedback
             if (group.userData.headGroup) {
                 // Trigger TSL/render-loop scale animation for juice on the main group
                 group.userData.scaleAnimStart = Date.now();
                 group.userData.scaleAnimTime = 0.15; // 150ms bounce
                 group.userData.scaleTarget = 0.5; // Final shrunken size

                 // Instantaneous squash before the lerp takes over
                 group.scale.set(1.4, 0.4, 1.4);

                 // Dim material
                 if (group.userData.bellMaterial) {
                     group.userData.bellMaterial.emissiveIntensity = 0.1;
                 }
             }

             // --- PALETTE: Spore burst on harvest ---
             spawnImpact(group.position, 'spore', color);

             group.userData.interactionText = "Harvested";

             // Play sound if available via audioSystem
             if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                 (window as any).AudioSystem.playSound('pickup', { position: group.position, pitch: 1.2 });
             }
        }
    };

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createLanternFlower(options: { color?: number, height?: number } = {}): THREE.Group {
    const { color = 0xFFA500, height = 2.5 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Use Batcher for Lanterns
    // 1. Create a lightweight proxy object for logic/physics
    // ⚡ OPTIMIZATION: Use analytic raycast (0 to height)
    makeInteractiveCylinder(group, height, 0.5);

    // Metadata
    group.userData.type = 'lanternFlower';
    group.userData.interactionText = "🏮 Lantern";
    group.userData.height = height;
    group.userData.color = color;

    // Deferred Registration to Batcher
    group.userData.onPlacement = () => {
        lanternBatcher.register(group, { height, color, spawnTime: (uTime as any).value || 0 });
        group.userData.onPlacement = null;
    };

    // Reactivity Metadata for WeatherSystem
    // We manually set userData props that attachReactivity would set, but skip the material array logic
    group.userData.reactivityType = 'flora';
    group.userData.minLight = 0.0;
    group.userData.maxLight = 1.0;

    // We don't need reactToNote callback because TSL handles the flicker.

    return group;
}

export function createGlowingFlowerPatch(x: number, z: number): THREE.Group {
    const patch = new THREE.Group();
    patch.position.set(x, 0, z);
    for (let i = 0; i < 5; i++) {
        const gf = createGlowingFlower();
        gf.position.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        patch.add(gf);
    }
    return patch;
}
