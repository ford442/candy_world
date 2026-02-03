// src/foliage/flowers.ts

import * as THREE from 'three';
// @ts-ignore
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { 
    foliageMaterials, 
    registerReactiveMaterial, 
    attachReactivity, 
    pickAnimation, 
    createClayMaterial, 
    createStandardNodeMaterial,
    createTransparentNodeMaterial,
    sharedGeometries,
    calculateFlowerBloom,
    calculateWindSway,
    applyPlayerInteraction,
    uTime
} from './common.ts';
import { color as tslColor, mix, float, positionLocal, Node } from 'three/tsl';
import { uTwilight } from './sky.ts';
import { lanternBatcher } from './lantern-batcher.ts';
import { simpleFlowerBatcher } from './simple-flower-batcher.ts';

interface FlowerOptions {
    color?: number | string | THREE.Color | null;
    shape?: 'simple' | 'multi' | 'spiral' | 'layered' | 'sunflower';
}

// ⚡ OPTIMIZATION: Merged Geometry Flower (Single Draw Call per Flower)
export function createFlower(options: FlowerOptions = {}): THREE.Object3D {
    const { color = null, shape = 'simple' } = options;

    if (shape === 'simple') {
        // ⚡ OPTIMIZATION: Use Batcher for Simple Flowers
        const group = new THREE.Group();
        const stemHeight = 0.6 + Math.random() * 0.4;

        // Hit Volume
        // Approx cylinder for interaction
        const hitGeo = new THREE.CylinderGeometry(0.2, 0.2, stemHeight, 8);
        hitGeo.translate(0, stemHeight / 2, 0);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        group.add(hitMesh);

        group.userData.type = 'flower';
        group.userData.interactionText = "🌸 Flower";

        // Determine Color
        let batchColor = 0xFFFFFF;
        if (color) {
            batchColor = (typeof color === 'number') ? color : new THREE.Color(color).getHex();
        } else {
            // Pick random color from a palette (matches flowerPetal presets roughly)
            const palette = [0xFF69B4, 0xFFD700, 0xFFFFFF, 0x9933FF];
            batchColor = palette[Math.floor(Math.random() * palette.length)];
        }

        const hasBeam = Math.random() > 0.5;

        group.userData.onPlacement = () => {
             simpleFlowerBatcher.register(group, {
                 height: stemHeight,
                 color: batchColor,
                 hasBeam: hasBeam,
                 spawnTime: (uTime as any).value || 0
             });
             group.userData.onPlacement = null;
        };

        // Reactivity metadata
        group.userData.reactivityType = 'flora';
        group.userData.minLight = 0.2;
        group.userData.maxLight = 1.0;

        return group;
    }

    // Material -> Geometries Map for Merging
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

    // Helper: Add geometry part
    const addPart = (geo: THREE.BufferGeometry, mat: THREE.Material, matrix?: THREE.Matrix4) => {
        const clone = geo.clone();
        if (matrix) clone.applyMatrix4(matrix);

        if (!parts.has(mat)) {
            parts.set(mat, []);
        }
        parts.get(mat)!.push(clone);
    };

    // Helper: Create TSL-ready material
    // We need to ensure ALL parts of the flower move together (Wind + Player Push)
    // Petals also get Bloom. Center/Stamens get Bloom?
    // Original: `center` was child of `head`. `head` had `flower.userData.type === 'flower'`?
    // In `animation.ts`: `triggerBloom` scales `flower` (the whole group).
    // So Center and Stamens SHOULD Bloom too if we want to match `triggerBloom` logic (which scales root).
    // My TSL `calculateFlowerBloom` scales from 0.
    // If I apply it to `positionLocal`, it scales relative to the mesh origin (0,0,0).
    // But `center` is at (0, stemHeight, 0).
    // If I scale (0, stemHeight, 0) by 1.2, it moves UP to (0, 1.2*stemHeight, 0).
    // This effectively scales the "Stem Length" too?
    // Wait, `flowerStem` material uses `applyPlayerInteraction(positionLocal) + calculateWindSway`.
    // It does NOT use Bloom.
    // Bloom (in TSL) creates a "pulsing flower head".
    // If I apply Bloom to Center/Petals (which are at Y=H), they will move up/down.
    // This looks like the flower is growing/shrinking on the stem. That's cool.
    // So YES, apply Bloom -> Wind -> Player to ALL head parts.

    // TSL Chain Construction
    const posBloom = calculateFlowerBloom(positionLocal);
    const posWind = posBloom.add(calculateWindSway(posBloom));
    const posFinal = applyPlayerInteraction(posWind);

    // 1. Stem
    const stemHeight = 0.6 + Math.random() * 0.4;
    // @ts-ignore
    const stemMat = foliageMaterials.flowerStem as THREE.Material;
    // StemMat already has Wind+Player. It does NOT have Bloom.
    // That's correct. Stem shouldn't pulse size usually.

    const stemGeo = sharedGeometries.unitCylinder; // Will be cloned in addPart
    const stemMatrix = new THREE.Matrix4().makeScale(0.05, stemHeight, 0.05);
    addPart(stemGeo, stemMat, stemMatrix);

    // 2. Head Setup
    const headMatrix = new THREE.Matrix4().makeTranslation(0, stemHeight, 0);

    // 3. Center
    // @ts-ignore
    let centerMat = foliageMaterials.flowerCenter as THREE.Material;
    // We need to clone to add TSL
    centerMat = centerMat.clone();
    (centerMat as any).positionNode = posFinal;

    const centerMatrix = headMatrix.clone();
    centerMatrix.scale(new THREE.Vector3(0.1, 0.1, 0.1));
    addPart(sharedGeometries.unitSphere, centerMat, centerMatrix);

    // 4. Stamens
    const stamenCount = 3;
    const stamenMat = createClayMaterial(0xFFFF00, { deformationNode: posFinal });

    for (let i = 0; i < stamenCount; i++) {
        const m = headMatrix.clone();
        // Stamen transform relative to head
        // stamen.position.y = 0.075;
        // stamen.rotation.z/x...
        // We need to compose the matrix: Head * StamenLocal

        const stamenLocal = new THREE.Matrix4();
        stamenLocal.makeTranslation(0, 0.075, 0);

        const rot = new THREE.Matrix4();
        const rz = (Math.random() - 0.5) * 1.0;
        const rx = (Math.random() - 0.5) * 1.0;
        rot.makeRotationFromEuler(new THREE.Euler(rx, 0, rz));

        stamenLocal.multiply(rot); // Rotate then Translate? No, rotation is usually local.
        // Original: stamen.rotation set. stamen.position set.
        // Order: Scale, Rotate, Translate.
        // stamen.scale.set(0.01, 0.15, 0.01);

        const scale = new THREE.Matrix4().makeScale(0.01, 0.15, 0.01);

        // Final Local: Translate * Rotate * Scale
        // Actually Three.js order: T * R * S
        const local = new THREE.Matrix4().compose(
            new THREE.Vector3(0, 0.075, 0),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)),
            new THREE.Vector3(0.01, 0.15, 0.01)
        );

        const finalMat = headMatrix.clone().multiply(local);
        addPart(sharedGeometries.unitCylinder, stamenMat, finalMat);
    }

    // 5. Petals
    let petalMat: THREE.Material;
    if (color) {
        petalMat = createClayMaterial(color, { deformationNode: posFinal });
        registerReactiveMaterial(petalMat);
    } else {
        const petals = foliageMaterials.flowerPetal as THREE.Material[];
        const base = petals[Math.floor(Math.random() * petals.length)];
        // Clone and apply TSL
        petalMat = base.clone();
        (petalMat as any).positionNode = posFinal;
    }

    const addPetal = (geo: THREE.BufferGeometry, localMatrix: THREE.Matrix4, mat: THREE.Material) => {
        const final = headMatrix.clone().multiply(localMatrix);
        addPart(geo, mat, final);
    };

    if (shape === 'multi') {
        const petalCount = 8 + Math.floor(Math.random() * 4);
        const basePetalGeo = sharedGeometries.unitSphere; // We will scale in matrix

        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const m = new THREE.Matrix4();
            m.makeScale(0.12, 0.12, 0.12); // Pre-scale
            // Position: (Math.cos(angle) * 0.2, Math.sin(i * 0.5) * 0.1, Math.sin(angle) * 0.2)
            // But wait, Three.js matrix composition needs correct order.
            // S, R, T.
            const pos = new THREE.Vector3(
                Math.cos(angle) * 0.2,
                Math.sin(i * 0.5) * 0.1,
                Math.sin(angle) * 0.2
            );
            // We can just construct T * S
            const t = new THREE.Matrix4().setPosition(pos);
            const s = new THREE.Matrix4().makeScale(0.12, 0.12, 0.12);
            m.copy(t).multiply(s);

            addPetal(basePetalGeo, m, petalMat);
        }
    } else if (shape === 'spiral') {
        const petalCount = 10;
        const basePetalGeo = sharedGeometries.unitCone;

        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 4;
            const radius = 0.05 + (i / petalCount) * 0.15;

            // scale(0.1, 0.2, 0.1)
            // pos(...)
            // rot.z = angle

            const m = new THREE.Matrix4().compose(
                new THREE.Vector3(Math.cos(angle) * radius, (i / petalCount) * 0.1, Math.sin(angle) * radius),
                new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, angle)),
                new THREE.Vector3(0.1, 0.2, 0.1)
            );
            addPetal(basePetalGeo, m, petalMat);
        }
    } else if (shape === 'layered') {
        for (let layer = 0; layer < 2; layer++) {
            const petalCount = 5;
            let basePetalGeo = new THREE.IcosahedronGeometry(0.12, 0);
            basePetalGeo = mergeVertices(basePetalGeo); // Fix: Ensure indexed
            basePetalGeo.scale(1, 0.5, 1);

            // Layer Color logic
            let currentMat = petalMat;
            if (layer !== 0) {
                // Layer 1 gets new color
                const c = color ? (typeof color === 'number' ? color + 0x111111 : 0xFFD700) : 0xFFD700;
                currentMat = createClayMaterial(c, { deformationNode: posFinal });
                registerReactiveMaterial(currentMat);
            }

            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2 + (layer * Math.PI / petalCount);

                // pos: (cos * (0.15 + layer*0.05), layer*0.05, sin...)
                // rot.z = PI/4

                const r = 0.15 + layer * 0.05;
                const m = new THREE.Matrix4().compose(
                    new THREE.Vector3(Math.cos(angle) * r, layer * 0.05, Math.sin(angle) * r),
                    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 4)),
                    new THREE.Vector3(1, 1, 1) // Geometry already scaled
                );

                addPetal(basePetalGeo, m, currentMat);
            }
        }
    }
    // Sunflower falls through (no petals), matching original logic.

    // 6. Merge Everything
    const finalGeos: THREE.BufferGeometry[] = [];
    const finalMats: THREE.Material[] = [];

    parts.forEach((geos, mat) => {
        if (geos.length > 0) {
            const merged = mergeGeometries(geos, false);
            finalGeos.push(merged);
            finalMats.push(mat);
        }
    });

    const mergedGeometry = mergeGeometries(finalGeos, true);
    const mesh = new THREE.Mesh(mergedGeometry, finalMats);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Metadata
    mesh.userData.animationOffset = Math.random() * 10;
    mesh.userData.animationType = pickAnimation(['sway', 'wobble', 'accordion']);
    mesh.userData.type = 'flower';
    mesh.userData.isFlower = true;
    mesh.userData.radius = 0.3;

    // 🎨 Palette: Interaction Hint (Added to mesh.userData)
    mesh.userData.interactionText = "🌸 Flower";

    // Beam Logic (Child)
    if (Math.random() > 0.5) {
        // @ts-ignore
        const beam = new THREE.Mesh(sharedGeometries.unitCone, foliageMaterials.lightBeam.clone());
        beam.scale.set(0.1, 1.0, 0.1);
        beam.position.y = stemHeight;
        beam.userData.isBeam = true;
        mesh.add(beam);
    }

    if (shape === 'sunflower' || shape === 'multi') {
        return attachReactivity(mesh, { minLight: 0.6, maxLight: 1.0 });
    }

    return attachReactivity(mesh, { minLight: 0.2, maxLight: 1.0 });
}

// ... Rest of the file unchanged ...
interface GlowingFlowerOptions {
    color?: number | string | THREE.Color;
    intensity?: number;
}

export function createGlowingFlower(options: GlowingFlowerOptions = {}): THREE.Group {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    // @ts-ignore
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, foliageMaterials.flowerStem);
    stem.scale.set(0.05, stemHeight, 0.05);
    stem.castShadow = true;
    group.add(stem);

    // Use Safe Material Helper
    const headMat = createStandardNodeMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.8
    });

    // Twilight Boost: Increase emission during twilight/night
    // Base intensity (intensity) + Twilight Boost (intensity * 1.5 * uTwilight)
    const baseEmissive = tslColor(color).mul(float(intensity));
    const twilightBoost = baseEmissive.mul(uTwilight).mul(1.5);
    headMat.emissiveNode = baseEmissive.add(twilightBoost);

    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(sharedGeometries.unitSphere, headMat);
    head.scale.setScalar(0.2);
    head.position.y = stemHeight;
    group.add(head);

    // @ts-ignore
    const wash = new THREE.Mesh(sharedGeometries.unitSphere, foliageMaterials.lightBeam);
    wash.scale.setScalar(1.5);
    wash.position.y = stemHeight;
    wash.userData.isWash = true;
    group.add(wash);

    const light = new THREE.PointLight(color as THREE.ColorRepresentation, 0.5, 3.0);
    light.position.y = stemHeight;
    group.add(light);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    
    // ⚡ PERFORMANCE: Set accurate bounding radius for frustum culling
    group.userData.radius = 0.3; // Similar size to regular flowers
    
    // Glowing flowers are often Night Dancers
    return attachReactivity(group, { minLight: 0.0, maxLight: 0.4 });
}

export function createStarflower(options: { color?: number | string | THREE.Color } = {}): THREE.Group {
    const { color: hexColor = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    const stemH = 0.7 + Math.random() * 0.4;
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, createClayMaterial(0x228B22));
    stem.scale.set(0.04, stemH, 0.04);
    stem.castShadow = true;
    group.add(stem);

    // @ts-ignore
    const center = new THREE.Mesh(sharedGeometries.unitSphere, foliageMaterials.flowerCenter);
    center.scale.setScalar(0.09);
    center.position.y = stemH;
    group.add(center);

    const petalMat = createClayMaterial(hexColor);
    registerReactiveMaterial(petalMat);

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

    // @ts-ignore
    const beamMat = foliageMaterials.lightBeam.clone();
    beamMat.colorNode = tslColor(hexColor);
    const beam = new THREE.Mesh(sharedGeometries.unitCone, beamMat);
    beam.position.y = stemH;
    beam.scale.set(0.02, 4.0, 0.02); // Tall thin beam
    beam.userData.isBeam = true;
    group.add(beam);

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'starflower';
    // Moon Flower logic (Night only)
    return attachReactivity(group, { minLight: 0.0, maxLight: 0.4 });
}

export function createBellBloom(options: { color?: number | string | THREE.Color } = {}): THREE.Group {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    const stemH = 0.4 + Math.random() * 0.2;
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, createClayMaterial(0x2E8B57));
    stem.scale.set(0.03, stemH, 0.03);
    stem.castShadow = true;
    stem.position.y = 0;
    group.add(stem);

    const petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);

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
    
    // ⚡ PERFORMANCE: Set accurate bounding radius for frustum culling
    group.userData.radius = 0.3;
    
    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPuffballFlower(options: { color?: number } = {}): THREE.Group {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const stemH = 1.0 + Math.random() * 0.5;
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, createClayMaterial(0x6B8E23));
    stem.scale.set(0.1, stemH, 0.1);
    stem.position.y = 0; // Pivot is bottom
    stem.castShadow = true;
    group.add(stem);

    const headR = 0.4 + Math.random() * 0.2;
    const headMat = createClayMaterial(color);
    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(sharedGeometries.unitSphere, headMat);
    head.scale.setScalar(headR);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    const sporeCount = 4 + Math.floor(Math.random() * 4);
    const sporeMat = createClayMaterial(color + 0x111111);
    registerReactiveMaterial(sporeMat);

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
    
    // ⚡ PERFORMANCE: Set accurate bounding radius for frustum culling
    group.userData.radius = headR * 1.5; // Spore ball radius

    group.userData.isTrampoline = true;
    group.userData.bounceHeight = stemH;
    group.userData.bounceRadius = headR + 0.3;
    group.userData.bounceForce = 12 + Math.random() * 5;

    // 🎨 Palette: Interaction Hint
    group.userData.interactionText = "🚀 Bounce";

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPrismRoseBush(options = {}): THREE.Group {
    const group = new THREE.Group();

    const stemsMat = createClayMaterial(0x5D4037);
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
        
        // Use safe helper
        const petalMat = createStandardNodeMaterial({
            color: hexColor,
            roughness: 0.7,
            emissive: 0x000000,
            emissiveIntensity: 0.0
        });
        registerReactiveMaterial(petalMat);

        const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        const outer = new THREE.Mesh(outerGeo, petalMat);
        outer.scale.set(1, 0.6, 1);
        roseGroup.add(outer);

        const inner = new THREE.Mesh(sharedGeometries.unitSphere, petalMat);
        inner.scale.setScalar(0.15);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        // @ts-ignore
        const washMat = foliageMaterials.lightBeam.clone();
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

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createVibratoViolet(options: { color?: number, intensity?: number } = {}): THREE.Group {
    const { color = 0x8A2BE2, intensity = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = 0.5 + Math.random() * 0.3;
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, createClayMaterial(0x228B22));
    stem.scale.set(0.03, stemH, 0.03);
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    // Use Safe Material Helper
    const centerMat = createStandardNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8 * intensity,
        roughness: 0.3
    });
    registerReactiveMaterial(centerMat);
    const center = new THREE.Mesh(sharedGeometries.unitSphere, centerMat);
    center.scale.setScalar(0.08);
    headGroup.add(center);

    const petalCount = 5;
    const petalGeo = new THREE.CircleGeometry(0.15, 8);
    // Use TransparentNodeMaterial Helper
    const petalMat = createTransparentNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.4 * intensity,
        roughness: 0.4,
        opacity: 0.7,
        side: THREE.DoubleSide
    });
    registerReactiveMaterial(petalMat);

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

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createTremoloTulip(options: { color?: number, size?: number } = {}): THREE.Group {
    const { color = 0xFF6347, size = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = (0.8 + Math.random() * 0.4) * size;
    const stem = new THREE.Mesh(sharedGeometries.unitCylinder, createClayMaterial(0x228B22));
    stem.scale.set(0.04 * size, stemH, 0.04 * size);
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    // Legacy geometry kept for complex shapes
    const bellGeo = new THREE.CylinderGeometry(0.2 * size, 0.05 * size, 0.25 * size, 12, 1, true);
    bellGeo.translate(0, -0.125 * size, 0);
    
    // Use TransparentNodeMaterial Helper
    const bellMat = createTransparentNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.5,
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    registerReactiveMaterial(bellMat);
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.rotation.x = Math.PI;
    headGroup.add(bell);

    // Use TransparentNodeMaterial Helper for vortex
    const vortexMat = createTransparentNodeMaterial({
        color: 0xFFFFFF,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const vortex = new THREE.Mesh(sharedGeometries.unitSphere, vortexMat);
    vortex.scale.setScalar(0.08 * size);
    vortex.position.y = -0.1 * size;
    headGroup.add(vortex);
    group.userData.vortex = vortex;

    const rimGeo = new THREE.TorusGeometry(0.2 * size, 0.02, 8, 16);
    // Use TransparentNodeMaterial Helper for rim
    const rimMat = createTransparentNodeMaterial({
        color: color,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
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

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createLanternFlower(options: { color?: number, height?: number } = {}): THREE.Group {
    const { color = 0xFFA500, height = 2.5 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Use Batcher for Lanterns
    // 1. Create a lightweight proxy object for logic/physics
    // HitBox for interactions (invisible)
    const hitBox = new THREE.Mesh(sharedGeometries.unitCylinder, new THREE.MeshBasicMaterial({ visible: false }));
    hitBox.scale.set(0.5, height, 0.5);
    hitBox.position.y = height * 0.5;
    group.add(hitBox);

    // Metadata
    group.userData.type = 'lanternFlower';
    group.userData.interactionText = "🏮 Lantern";
    group.userData.height = height;
    group.userData.color = color;

    // Deferred Registration to Batcher
    group.userData.onPlacement = () => {
        // @ts-ignore: Accessing .value on UniformNode if possible, or relying on it being treated as number in some contexts.
        // If uTime is a UniformNode, .value property access depends on implementation.
        // Assuming typical usage pattern or casting.
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
