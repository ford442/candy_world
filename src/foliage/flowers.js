import * as THREE from 'three';
import { foliageMaterials, registerReactiveMaterial, attachReactivity, pickAnimation, createClayMaterial } from './common.js';

export function createFlower(options = {}) {
    const { color = null, shape = 'simple' } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 12);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    const centerGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
    center.name = 'flowerCenter';
    head.add(center);

    const stamenCount = 3;
    const stamenGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3);
    stamenGeo.translate(0, 0.075, 0);
    const stamenMat = createClayMaterial(0xFFFF00);
    for (let i = 0; i < stamenCount; i++) {
        const stamen = new THREE.Mesh(stamenGeo, stamenMat);
        stamen.rotation.z = (Math.random() - 0.5) * 1.0;
        stamen.rotation.x = (Math.random() - 0.5) * 1.0;
        head.add(stamen);
    }

    let petalMat;
    if (color) {
        petalMat = createClayMaterial(color);
        registerReactiveMaterial(petalMat);
    } else {
        petalMat = foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];
    }

    if (shape === 'simple') {
        const petalCount = 5 + Math.floor(Math.random() * 2);
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
        const petalGeo = new THREE.SphereGeometry(0.12, 12, 12);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
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
    return attachReactivity(group);
}

export function createGlowingFlower(options = {}) {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const headGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const headMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.8
    });
    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemHeight;
    group.add(head);

    const washGeo = new THREE.SphereGeometry(1.5, 8, 8);
    const wash = new THREE.Mesh(washGeo, foliageMaterials.lightBeam);
    wash.position.y = stemHeight;
    wash.userData.isWash = true;
    group.add(wash);

    const light = new THREE.PointLight(color, 0.5, 3.0);
    light.position.y = stemHeight;
    group.add(light);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createStarflower(options = {}) {
    const { color = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    const stemH = 0.7 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, stemH, 6);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), foliageMaterials.flowerCenter);
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
    beamMat.color.setHex(color);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = stemH;
    beam.userData.isBeam = true;
    group.add(beam);

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'starflower';
    return group;
}

export function createBellBloom(options = {}) {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    const stemH = 0.4 + Math.random() * 0.2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stemH, 6), createClayMaterial(0x2E8B57));
    stem.castShadow = true;
    stem.position.y = 0;
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
    return group;
}

export function createPuffballFlower(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const stemH = 1.0 + Math.random() * 0.5;
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.12, stemH, 8);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x6B8E23));
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const headR = 0.4 + Math.random() * 0.2;
    const headGeo = new THREE.SphereGeometry(headR, 8, 8);
    const headMat = createClayMaterial(color);
    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    const sporeCount = 4 + Math.floor(Math.random() * 4);
    const sporeGeo = new THREE.SphereGeometry(headR * 0.3, 8, 8);
    const sporeMat = createClayMaterial(color + 0x111111);
    registerReactiveMaterial(sporeMat);

    for (let i = 0; i < sporeCount; i++) {
        const spore = new THREE.Mesh(sporeGeo, sporeMat);
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

    group.userData.isTrampoline = true;
    group.userData.bounceHeight = stemH;
    group.userData.bounceRadius = headR + 0.3;
    group.userData.bounceForce = 12 + Math.random() * 5;

    return group;
}

export function createPrismRoseBush(options = {}) {
    const group = new THREE.Group();

    const stemsMat = createClayMaterial(0x5D4037);
    const baseHeight = 1.0 + Math.random() * 0.5;

    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, baseHeight, 8);
    trunkGeo.translate(0, baseHeight / 2, 0);
    const trunk = new THREE.Mesh(trunkGeo, stemsMat);
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
        const branchGeo = new THREE.CylinderGeometry(0.08, 0.1, branchLen, 6);
        branchGeo.translate(0, branchLen / 2, 0);
        const branch = new THREE.Mesh(branchGeo, stemsMat);
        branchGroup.add(branch);

        const roseGroup = new THREE.Group();
        roseGroup.position.y = branchLen;

        const color = roseColors[Math.floor(Math.random() * roseColors.length)];
        const petalMat = new THREE.MeshStandardMaterial({
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

        const innerGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const inner = new THREE.Mesh(innerGeo, petalMat);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        const washGeo = new THREE.SphereGeometry(1.2, 8, 8);
        const washMat = foliageMaterials.lightBeam.clone();
        washMat.color.setHex(color);
        const wash = new THREE.Mesh(washGeo, washMat);
        wash.userData.isWash = true;
        roseGroup.add(wash);

        branchGroup.add(roseGroup);
        group.add(branchGroup);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    return group;
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
    ringMat.emissive.setHex(0x000000);
    pad.userData.ringMaterial = ringMat;

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

    return group;
}

export function createVibratoViolet(options = {}) {
    const { color = 0x8A2BE2, intensity = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = 0.5 + Math.random() * 0.3;
    const stemGeo = new THREE.CylinderGeometry(0.03, 0.04, stemH, 8);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    const centerGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const centerMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8 * intensity,
        roughness: 0.3
    });
    registerReactiveMaterial(centerMat);
    const center = new THREE.Mesh(centerGeo, centerMat);
    headGroup.add(center);

    const petalCount = 5;
    const petalGeo = new THREE.CircleGeometry(0.15, 8);
    const petalMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.4 * intensity,
        roughness: 0.4,
        transparent: true,
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

    return group;
}

export function createTremoloTulip(options = {}) {
    const { color = 0xFF6347, size = 1.0 } = options;
    const group = new THREE.Group();

    const stemH = (0.8 + Math.random() * 0.4) * size;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.06, stemH, 8);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    const bellGeo = new THREE.CylinderGeometry(0.2 * size, 0.05 * size, 0.25 * size, 12, 1, true);
    bellGeo.translate(0, -0.125 * size, 0);
    const bellMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.5,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    registerReactiveMaterial(bellMat);
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.rotation.x = Math.PI;
    headGroup.add(bell);

    const vortexGeo = new THREE.SphereGeometry(0.08 * size, 8, 8);
    const vortexMat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });
    const vortex = new THREE.Mesh(vortexGeo, vortexMat);
    vortex.position.y = -0.1 * size;
    headGroup.add(vortex);
    group.userData.vortex = vortex;

    const rimGeo = new THREE.TorusGeometry(0.2 * size, 0.02, 8, 16);
    const rimMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
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

    return group;
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
