import * as THREE from 'three';
import { 
    foliageMaterials, 
    registerReactiveMaterial, 
    attachReactivity, 
    pickAnimation, 
    createClayMaterial, 
    createStandardNodeMaterial, // New helper
    createTransparentNodeMaterial // New helper
} from './common.js';

export function createFlower(options = {}) {
    const { color = null, shape = 'simple' } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, foliageMaterials.flowerStem);
    stem.scale.set(0.05, stemHeight, 0.05);
    stem.position.y = stemHeight / 2;
    stem.castShadow = true;
    group.add(stem);

    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    // Shared geometry: Sphere
    const center = new THREE.Mesh(sharedGeometries.sphere, foliageMaterials.flowerCenter);
    center.scale.setScalar(0.1);
    center.name = 'flowerCenter';
    head.add(center);

    const stamenCount = 3;
    const stamenMat = createClayMaterial(0xFFFF00);
    for (let i = 0; i < stamenCount; i++) {
        // Shared geometry: Cylinder
        const stamen = new THREE.Mesh(sharedGeometries.cylinderLow, stamenMat);
        stamen.scale.set(0.01, 0.15, 0.01);
        stamen.position.y = 0.075; // Adjust position since scaling is centered
        stamen.rotation.z = (Math.random() - 0.5) * 1.0;
        stamen.rotation.x = (Math.random() - 0.5) * 1.0;
        head.add(stamen);
    }

    let petalMat;
    if (color) {
        petalMat = createClayMaterial(color);
        // Ensure manual petal materials are also double-sided if needed, though createClayMaterial defaults to front
        // If we want DoubleSide for custom colors, we should set it:
        // petalMat.side = THREE.DoubleSide; // Optional: keeping simple for now
        registerReactiveMaterial(petalMat);
    } else {
        petalMat = foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];
    }

    if (shape === 'simple') {
        const petalCount = 5 + Math.floor(Math.random() * 2);
        // Icosahedron is specific enough to keep unique for now unless we add it to shared
        const petalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        petalGeo.scale(1, 0.5, 1);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
            petal.rotation.z = Math.PI / 4;
            head.add(petal);
        }
    } else if (shape === 'multi') {
        const petalCount = 8 + Math.floor(Math.random() * 4);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            // Shared geometry: SphereLow (petals are small, low poly is fine)
            const petal = new THREE.Mesh(sharedGeometries.sphereLow, petalMat);
            petal.scale.setScalar(0.12);
            petal.position.set(Math.cos(angle) * 0.2, Math.sin(i * 0.5) * 0.1, Math.sin(angle) * 0.2);
            head.add(petal);
        }
    } else if (shape === 'spiral') {
        const petalCount = 10;
        const petalGeo = new THREE.ConeGeometry(0.1, 0.2, 6);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 4;
            const radius = 0.05 + (i / petalCount) * 0.15;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(angle) * radius, (i / petalCount) * 0.1, Math.sin(angle) * radius);
            petal.rotation.z = angle;
            head.add(petal);
        }
    } else if (shape === 'layered') {
        for (let layer = 0; layer < 2; layer++) {
            const petalCount = 5;
            const petalGeo = new THREE.IcosahedronGeometry(0.12, 0);
            petalGeo.scale(1, 0.5, 1);
            const layerColor = layer === 0 ? petalMat : createClayMaterial(color ? color + 0x111111 : 0xFFD700);
            if (layer !== 0) registerReactiveMaterial(layerColor);

            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2 + (layer * Math.PI / petalCount);
                const petal = new THREE.Mesh(petalGeo, layerColor);
                petal.position.set(
                    Math.cos(angle) * (0.15 + layer * 0.05),
                    layer * 0.05,
                    Math.sin(angle) * (0.15 + layer * 0.05)
                );
                petal.rotation.z = Math.PI / 4;
                head.add(petal);
            }
        }
    }

    if (Math.random() > 0.5) {
        const beamGeo = new THREE.ConeGeometry(0.1, 1, 8, 1, true);
        beamGeo.translate(0, 0.5, 0);
        const beamMat = foliageMaterials.lightBeam.clone();
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = stemHeight;
        beam.userData.isBeam = true;
        group.add(beam);
    }

    group.userData.animationOffset = Math.random() * 10;
    group.userData.animationType = pickAnimation(['sway', 'wobble', 'accordion']);
    group.userData.type = 'flower';
    group.userData.isFlower = true;

    // Sun Flower logic (Reacts when bright)
    if (shape === 'sunflower' || shape === 'multi') {
        return attachReactivity(group, { minLight: 0.6, maxLight: 1.0 });
    }

    // Standard Flower logic (Daytime/Dusk)
    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createGlowingFlower(options = {}) {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, foliageMaterials.flowerStem);
    stem.scale.set(0.05, stemHeight, 0.05);
    stem.position.y = stemHeight / 2;
    stem.castShadow = true;
    group.add(stem);

    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    // Use Helper
    const headMat = createStandardNodeMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.8
    });
    registerReactiveMaterial(headMat);

    // Shared geometry: Sphere (Low poly sufficient for glowing blob)
    const head = new THREE.Mesh(sharedGeometries.sphereLow, headMat);
    head.scale.setScalar(0.2);
    head.position.y = stemHeight;
    group.add(head);

    // Shared geometry: Sphere (for wash)
    const wash = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.lightBeam);
    wash.scale.setScalar(1.5);
    wash.position.y = stemHeight;
    wash.userData.isWash = true;
    group.add(wash);

    const light = new THREE.PointLight(color, 0.5, 3.0);
    light.position.y = stemHeight;
    group.add(light);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    // Glowing flowers are often Night Dancers
    return attachReactivity(group, { minLight: 0.0, maxLight: 0.4 });
}

export function createStarflower(options = {}) {
    const { color = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    const stemH = 0.7 + Math.random() * 0.4;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(0x228B22));
    stem.scale.set(0.04, stemH, 0.04);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Shared geometry: Sphere
    const center = new THREE.Mesh(sharedGeometries.sphereLow, foliageMaterials.flowerCenter);
    center.scale.setScalar(0.09);
    center.position.y = stemH;
    group.add(center);

    const petalGeo = new THREE.ConeGeometry(0.09, 0.2, 6);
    const petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);

    const petalCount = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.16, stemH, Math.sin(angle) * 0.16);
        petal.rotation.x = Math.PI * 0.5;
        petal.rotation.z = angle;
        group.add(petal);
    }

    const beamGeo = new THREE.ConeGeometry(0.02, 8, 8, 1, true);
    beamGeo.translate(0, 4, 0);
    const beamMat = foliageMaterials.lightBeam.clone();
    beamMat.colorNode = color(color); // Update color node for clone
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = stemH;
    beam.userData.isBeam = true;
    group.add(beam);

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'starflower';
    // Moon Flower logic (Night only)
    return attachReactivity(group, { minLight: 0.0, maxLight: 0.4 });
}

export function createBellBloom(options = {}) {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    const stemH = 0.4 + Math.random() * 0.2;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(0x2E8B57));
    stem.scale.set(0.03, stemH, 0.03);
    stem.position.y = stemH / 2; // Fixed position since shared cylinder is centered
    stem.castShadow = true;
    group.add(stem);

    const petalGeo = new THREE.ConeGeometry(0.12, 0.28, 10);
    const petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);

    const petals = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petals; i++) {
        const p = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petals) * Math.PI * 2;
        p.position.set(Math.cos(angle) * 0.08, -0.08, Math.sin(angle) * 0.08);
        p.rotation.x = Math.PI;
        p.castShadow = true;
        group.add(p);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPuffballFlower(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const stemH = 1.0 + Math.random() * 0.5;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinder, createClayMaterial(0x6B8E23));
    stem.scale.set(0.1, stemH, 0.1);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const headR = 0.4 + Math.random() * 0.2;
    // Shared geometry: Sphere
    const head = new THREE.Mesh(sharedGeometries.sphere, createClayMaterial(color));
    registerReactiveMaterial(head.material);
    head.scale.setScalar(headR);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    const sporeCount = 4 + Math.floor(Math.random() * 4);
    // Shared geometry: SphereLow
    const sporeMat = createClayMaterial(color + 0x111111);
    registerReactiveMaterial(sporeMat);

    for (let i = 0; i < sporeCount; i++) {
        const spore = new THREE.Mesh(sharedGeometries.sphereLow, sporeMat);
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.sin(phi) * Math.sin(theta);
        const z = Math.cos(phi);

        spore.scale.setScalar(headR * 0.3);
        spore.position.set(x * headR, stemH + y * headR, z * headR);
        group.add(spore);
    }

    group.userData.animationType = pickAnimation(['sway', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    group.userData.isTrampoline = true;
    group.userData.bounceHeight = stemH;
    group.userData.bounceRadius = headR + 0.3;
    group.userData.bounceForce = 12 + Math.random() * 5;

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createPrismRoseBush(options = {}) {
    const group = new THREE.Group();

    const stemsMat = createClayMaterial(0x5D4037);
    const baseHeight = 1.0 + Math.random() * 0.5;

    // Shared geometry: Cylinder
    const trunk = new THREE.Mesh(sharedGeometries.cylinder, stemsMat);
    trunk.scale.set(0.15, baseHeight, 0.15);
    trunk.position.y = baseHeight / 2;
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
        // Shared geometry: CylinderLow
        const branch = new THREE.Mesh(sharedGeometries.cylinderLow, stemsMat);
        branch.scale.set(0.08, branchLen, 0.08);
        branch.position.y = branchLen / 2;
        branchGroup.add(branch);

        const roseGroup = new THREE.Group();
        roseGroup.position.y = branchLen;

        const color = roseColors[Math.floor(Math.random() * roseColors.length)];
        
        // Use Helper
        const petalMat = createStandardNodeMaterial({
            color: color,
            roughness: 0.7,
            emissive: 0x000000,
            emissiveIntensity: 0.0
        });
        registerReactiveMaterial(petalMat);

        const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        const outer = new THREE.Mesh(outerGeo, petalMat);
        outer.scale.set(1, 0.6, 1);
        roseGroup.add(outer);

        // Shared geometry: SphereLow
        const inner = new THREE.Mesh(sharedGeometries.sphereLow, petalMat);
        inner.scale.setScalar(0.15);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        // Shared geometry: Sphere (for wash)
        const washMat = foliageMaterials.lightBeam.clone();
        washMat.color.setHex(color);
        const wash = new THREE.Mesh(sharedGeometries.sphere, washMat);
        wash.scale.setScalar(1.2);
        wash.userData.isWash = true;
        roseGroup.add(wash);

        branchGroup.add(roseGroup);
        group.add(branchGroup);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    return attachReactivity(group, { minLight: 0.2, maxLight: 1.0 });
}

export function createSubwooferLotus(options = {}) {
    const { color = 0x2E8B57 } = options;
    const group = new THREE.Group();

    const padGeo = new THREE.CylinderGeometry(1.5, 0.2, 0.5, 16);
    padGeo.translate(0, 0.25, 0);
    const padMat = createClayMaterial(color);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.castShadow = true;
    pad.receiveShadow = true;

    const ringMat = foliageMaterials.lotusRing.clone();
    ringMat.emissiveNode = color(0x000000); // Reset emissive for safety
    pad.userData.ringMaterial = ringMat;
    registerReactiveMaterial(ringMat);

    for (let i = 1; i <= 3; i++) {
        const ringGeo = new THREE.TorusGeometry(i * 0.3, 0.05, 8, 24);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.51;
        pad.add(ring);
    }

    group.add(pad);

    group.userData.animationType = 'speakerPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'lotus';

    return attachReactivity(group, { minLight: 0.0, maxLight: 1.0 }); // Lotus might be always active
}

export function createVibratoViolet(options = {}) {
    const { color = 0x8A2BE2, intensity = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = 0.5 + Math.random() * 0.3;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(0x228B22));
    stem.scale.set(0.03, stemH, 0.03);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    const centerGeo = new THREE.SphereGeometry(0.08, 12, 12);
    // Use Helper
    const centerMat = createStandardNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8 * intensity,
        roughness: 0.3
    });
    registerReactiveMaterial(centerMat);
    // Shared geometry: SphereLow
    const center = new THREE.Mesh(sharedGeometries.sphereLow, centerMat);
    center.scale.setScalar(0.08);
    headGroup.add(center);

    const petalCount = 5;
    const petalGeo = new THREE.CircleGeometry(0.15, 8);
    // Use Helper for Transparent Material
    const petalMat = createTransparentNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.4 * intensity,
        roughness: 0.4,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false // Explicitly disable depth write for transparency
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

export function createTremoloTulip(options = {}) {
    const { color = 0xFF6347, size = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = (0.8 + Math.random() * 0.4) * size;
    // Shared geometry: Cylinder
    const stem = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(0x228B22));
    stem.scale.set(0.04 * size, stemH, 0.04 * size);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    const bellGeo = new THREE.CylinderGeometry(0.2 * size, 0.05 * size, 0.25 * size, 12, 1, true);
    bellGeo.translate(0, -0.125 * size, 0);
    
    // Use Helper for Transparent Material
    const bellMat = createTransparentNodeMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.5,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false // Fix depth stencil warning
    });
    registerReactiveMaterial(bellMat);
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.rotation.x = Math.PI;
    headGroup.add(bell);

    const vortexGeo = new THREE.SphereGeometry(0.08 * size, 8, 8);
    // Note: BasicMaterial is okay, but let's use NodeMaterial for consistency if possible, 
    // or keep MeshBasicMaterial as it doesn't have complex pipeline issues usually. 
    // Converting to NodeMaterial to be safe:
    const vortexMat = createTransparentNodeMaterial({
        color: 0xFFFFFF,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const vortex = new THREE.Mesh(sharedGeometries.sphereLow, vortexMat);
    vortex.scale.setScalar(0.08 * size);
    vortex.position.y = -0.1 * size;
    headGroup.add(vortex);
    group.userData.vortex = vortex;

    const rimGeo = new THREE.TorusGeometry(0.2 * size, 0.02, 8, 16);
    const rimMat = createTransparentNodeMaterial({
        color: color,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false
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

export function createGlowingFlowerPatch(x, z) {
    const patch = new THREE.Group();
    patch.position.set(x, 0, z);
    for (let i = 0; i < 5; i++) {
        const gf = createGlowingFlower();
        gf.position.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        patch.add(gf);
    }
    return patch;
}
