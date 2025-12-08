import * as THREE from 'three';

// --- Materials for Foliage ---
function createClayMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.0,
        roughness: 0.8, // Matte surface
        flatShading: false,
    });
}

const foliageMaterials = {
    grass: createClayMaterial(0x7CFC00), // Lawn Green
    flowerStem: createClayMaterial(0x228B22), // Forest Green
    flowerCenter: createClayMaterial(0xFFFACD), // Lemon Chiffon
    flowerPetal: [
        createClayMaterial(0xFF69B4), // Hot Pink
        createClayMaterial(0xBA55D3), // Medium Orchid
        createClayMaterial(0x87CEFA), // Light Sky Blue
    ],
    // Shared material for generic light washes
    lightBeam: new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }),
    // New Materials for Special Plants
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.1 }),
    lotusRing: createClayMaterial(0x222222), // Dark initially, lights up
    opticCable: new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1
    }),
    opticTip: new THREE.MeshBasicMaterial({ color: 0xFFFFFF }) // Pure light
};

// Registry for custom materials that should react to music
export const reactiveMaterials = [];

// Helper to register a material safely
function registerReactiveMaterial(mat) {
    if (reactiveMaterials.length < 3000) {
        reactiveMaterials.push(mat);
    }
}

// --- STANDARD PLANTS ---

export function createGrass(options = {}) {
    const { color = 0x7CFC00, shape = 'tall' } = options;
    const material = createClayMaterial(color);
    let geo;
    if (shape === 'tall') {
        const height = 0.5 + Math.random();
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
        geo.translate(0, height / 2, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > height * 0.5) {
                const bendFactor = (y - height * 0.5) / (height * 0.5);
                pos.setX(i, pos.getX(i) + bendFactor * 0.1);
            }
        }
    } else if (shape === 'bushy') {
        const height = 0.2 + Math.random() * 0.3;
        geo = new THREE.CylinderGeometry(0.1, 0.05, height, 8);
        geo.translate(0, height / 2, 0);
    }
    geo.computeVertexNormals();

    const blade = new THREE.Mesh(geo, material);
    blade.castShadow = true;
    blade.userData.type = 'grass';
    blade.userData.animationType = shape === 'tall' ? 'sway' : 'bounce';
    blade.userData.animationOffset = Math.random() * 10;
    return blade;
}

export function createFlower(options = {}) {
    const { color = null, shape = 'simple' } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    const centerGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
    center.name = 'flowerCenter';
    head.add(center);

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
        const petalGeo = new THREE.SphereGeometry(0.12, 8, 8);
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
            const petalCount = 6;
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
    group.userData.animationType = 'sway';
    group.userData.type = 'flower';
    group.userData.isFlower = true;
    return group;
}

export function createFloweringTree(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const trunkH = 3 + Math.random() * 2;
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkH, 16);
    const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x8B5A2B));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    const bloomCount = 5 + Math.floor(Math.random() * 5);
    for (let i = 0; i < bloomCount; i++) {
        const bloomGeo = new THREE.SphereGeometry(0.8 + Math.random() * 0.4, 16, 16);
        const bloom = new THREE.Mesh(bloomGeo, bloomMat);
        bloom.position.set(
            (Math.random() - 0.5) * 2,
            trunkH + Math.random() * 1.5,
            (Math.random() - 0.5) * 2
        );
        bloom.castShadow = true;
        group.add(bloom);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
    return group;
}

export function createShrub(options = {}) {
    const { color = 0x32CD32 } = options;
    const group = new THREE.Group();

    const baseGeo = new THREE.SphereGeometry(1 + Math.random() * 0.5, 16, 16);
    const base = new THREE.Mesh(baseGeo, createClayMaterial(color));
    base.position.y = 0.5;
    base.castShadow = true;
    group.add(base);

    const flowerMat = createClayMaterial(0xFF69B4);
    registerReactiveMaterial(flowerMat);

    const flowerCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < flowerCount; i++) {
        const flowerGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const flower = new THREE.Mesh(flowerGeo, flowerMat);
        flower.position.set(
            (Math.random() - 0.5) * 1.5,
            1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(flower);
    }

    group.userData.animationType = 'bounce';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

// --- SPECIAL PLANTS (Restored) ---

export function createGlowingFlower(options = {}) {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
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

    const washGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const wash = new THREE.Mesh(washGeo, foliageMaterials.lightBeam);
    wash.position.y = stemHeight;
    wash.userData.isWash = true;
    group.add(wash);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createFloatingOrb(options = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    registerReactiveMaterial(mat);

    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    orb.userData.type = 'orb';
    return orb;
}

export function createVine(options = {}) {
    const { color = 0x228B22, length = 3 } = options;
    const group = new THREE.Group();

    for (let i = 0; i < length; i++) {
        const segmentGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
        const segment = new THREE.Mesh(segmentGeo, createClayMaterial(color));
        segment.position.y = i * 0.5;
        segment.rotation.z = Math.sin(i * 0.5) * 0.2;
        group.add(segment);
    }

    group.userData.animationType = 'vineSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

export function createLeafParticle(options = {}) {
    const { color = 0x00ff00 } = options;
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(0.1, 0.1, 0, 0.2);
    leafShape.quadraticCurveTo(-0.1, 0.1, 0, 0);
    const geo = new THREE.ShapeGeometry(leafShape);
    const mat = createClayMaterial(color);
    const leaf = new THREE.Mesh(geo, mat);
    leaf.castShadow = true;
    return leaf;
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

    group.userData.animationType = 'sway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createWisteriaCluster(options = {}) {
    const { color = 0xCFA0FF, strands = 4 } = options;
    const group = new THREE.Group();

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    for (let s = 0; s < strands; s++) {
        const strand = new THREE.Group();
        const length = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < length; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), createClayMaterial(0x2E8B57));
            seg.position.y = -i * 0.35;
            seg.rotation.z = Math.sin(i * 0.5) * 0.15;
            strand.add(seg);

            if (i > 0 && Math.random() > 0.6) {
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), bloomMat);
                b.position.y = seg.position.y - 0.1;
                b.position.x = (Math.random() - 0.5) * 0.06;
                b.position.z = (Math.random() - 0.5) * 0.06;
                strand.add(b);
            }
        }
        strand.position.x = (Math.random() - 0.5) * 0.6;
        strand.position.y = 0;
        group.add(strand);
    }

    group.userData.animationType = 'vineSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

export function createBubbleWillow(options = {}) {
    const { color = 0x8A2BE2 } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, trunkH, 12);
    const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x5D4037));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 6 + Math.floor(Math.random() * 4);
    const branchMat = createClayMaterial(color);
    registerReactiveMaterial(branchMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const length = 1.5 + Math.random();
        const capsuleGeo = new THREE.CapsuleGeometry(0.2, length, 8, 16);
        const capsule = new THREE.Mesh(capsuleGeo, branchMat);

        capsule.position.set(0.5, -length / 2, 0);
        capsule.rotation.z = -Math.PI / 6;

        branchGroup.add(capsule);
        group.add(branchGroup);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
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
    const headGeo = new THREE.SphereGeometry(headR, 16, 16);
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

    group.userData.animationType = 'sway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createHelixPlant(options = {}) {
    const { color = 0x00FA9A } = options;
    const group = new THREE.Group();

    class SpiralCurve extends THREE.Curve {
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        getPoint(t, optionalTarget = new THREE.Vector3()) {
            const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale;
            const ty = t * 2.0 * this.scale;
            const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale;
            return optionalTarget.set(tx, ty, tz);
        }
    }

    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    const tipGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const tipMat = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5
    });
    registerReactiveMaterial(tipMat);

    const tip = new THREE.Mesh(tipGeo, tipMat);
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);

    group.userData.animationType = 'spring';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

export function createBalloonBush(options = {}) {
    const { color = 0xFF4500 } = options;
    const group = new THREE.Group();

    const sphereCount = 5 + Math.floor(Math.random() * 5);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    for (let i = 0; i < sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.4;
        const geo = new THREE.SphereGeometry(r, 16, 16);
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set(
            (Math.random() - 0.5) * 0.8,
            r + (Math.random()) * 0.8,
            (Math.random() - 0.5) * 0.8
        );
        mesh.castShadow = true;
        group.add(mesh);
    }

    group.userData.animationType = 'bounce';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

export function createRainingCloud(options = {}) {
    const { color = 0xB0C4DE, rainIntensity = 50 } = options;
    const group = new THREE.Group();

    const cloudGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const cloudMat = createClayMaterial(color);
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.castShadow = true;
    group.add(cloud);

    const rainGeo = new THREE.BufferGeometry();
    const rainCount = rainIntensity;
    const positions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 3;
        positions[i * 3 + 1] = Math.random() * -2;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
    const rain = new THREE.Points(rainGeo, rainMat);
    group.add(rain);

    group.userData.animationType = 'rain';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'cloud';
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

export function createFloatingOrbCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 5, z);
    for (let i = 0; i < 3; i++) {
        const orb = createFloatingOrb();
        orb.position.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        cluster.add(orb);
    }
    return cluster;
}

export function createVineCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 0, z);
    for (let i = 0; i < 3; i++) {
        const vine = createVine();
        vine.position.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        cluster.add(vine);
    }
    return cluster;
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

        const innerGeo = new THREE.SphereGeometry(0.15, 16, 16);
        const inner = new THREE.Mesh(innerGeo, petalMat);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        const washGeo = new THREE.SphereGeometry(1.2, 16, 16);
        const washMat = foliageMaterials.lightBeam.clone();
        washMat.color.setHex(color);
        const wash = new THREE.Mesh(washGeo, washMat);
        wash.userData.isWash = true;
        roseGroup.add(wash);

        branchGroup.add(roseGroup);
        group.add(branchGroup);
    }

    group.userData.animationType = 'sway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    return group;
}

// --- MISSING SPECIAL PLANTS RESTORED ---

/**
 * 1. The Subwoofer Lotus
 * Hovering lily pad that acts as a speaker cone.
 */
export function createSubwooferLotus(options = {}) {
    const { color = 0x2E8B57 } = options;
    const group = new THREE.Group();

    // The Pad (Speaker Cone)
    const padGeo = new THREE.CylinderGeometry(1.5, 0.2, 0.5, 16);
    padGeo.translate(0, 0.25, 0); // Pivot at bottom
    const padMat = createClayMaterial(color);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.castShadow = true;
    pad.receiveShadow = true;

    // Add "Equalizer" Rings on top
    const ringMat = foliageMaterials.lotusRing.clone(); // Clone to animate independently
    ringMat.emissive.setHex(0x000000);
    pad.userData.ringMaterial = ringMat;

    for (let i = 1; i <= 3; i++) {
        const ringGeo = new THREE.TorusGeometry(i * 0.3, 0.05, 8, 24);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.51; // Sit just on top
        pad.add(ring);
    }

    group.add(pad);

    group.userData.animationType = 'speakerPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'lotus';

    return group;
}

/**
 * 2. The Accordion Palm
 * Pleated trunk that stretches.
 */
export function createAccordionPalm(options = {}) {
    const { color = 0xFFD700 } = options;
    const group = new THREE.Group();

    const trunkHeight = 3.0;
    const segments = 10;
    const trunkGroup = new THREE.Group();

    const pleatGeo = new THREE.TorusGeometry(0.3, 0.15, 8, 16);
    const pleatMat = createClayMaterial(0x8B4513); // Brown wood

    for (let i = 0; i < segments; i++) {
        const pleat = new THREE.Mesh(pleatGeo, pleatMat);
        pleat.rotation.x = Math.PI / 2;
        pleat.position.y = i * (trunkHeight / segments);
        if (i % 2 === 0) {
            pleat.material = createClayMaterial(0xA0522D);
        }
        trunkGroup.add(pleat);
    }
    group.add(trunkGroup);

    // Leaves on top
    const leafCount = 6;
    const leafGeo = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 8);
    leafGeo.translate(0, 0.75, 0); // Pivot at base
    const leafMat = createClayMaterial(color);
    registerReactiveMaterial(leafMat);

    const headGroup = new THREE.Group();
    headGroup.position.y = trunkHeight;
    trunkGroup.add(headGroup);

    for (let i = 0; i < leafCount; i++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.rotation.z = Math.PI / 3;
        leaf.rotation.y = (i / leafCount) * Math.PI * 2;
        headGroup.add(leaf);
    }

    group.userData.animationType = 'accordionStretch';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
    group.userData.trunk = trunkGroup;

    return group;
}

/**
 * 3. The Fiber-Optic Weeping Willow
 * Glowing cables that whip around.
 */
export function createFiberOpticWillow(options = {}) {
    const { color = 0xFFFFFF } = options;
    const group = new THREE.Group();

    // Trunk
    const trunkH = 2.5 + Math.random();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.4, trunkH, 12),
        createClayMaterial(0x222222) // Dark trunk
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Cable Branches
    const branchCount = 12;
    const cableMat = foliageMaterials.opticCable;
    const tipMat = foliageMaterials.opticTip.clone();
    registerReactiveMaterial(tipMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const len = 1.5 + Math.random();
        const cableGeo = new THREE.CylinderGeometry(0.02, 0.02, len, 4);
        cableGeo.translate(0, -len / 2, 0); // Hang down
        const cable = new THREE.Mesh(cableGeo, cableMat);

        cable.rotation.z = Math.PI / 4;

        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), tipMat);
        tip.position.y = -len;
        cable.add(tip);

        branchGroup.add(cable);
        group.add(branchGroup);
    }

    group.userData.animationType = 'fiberWhip';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'willow';

    return group;
}

// --- Instancing System (Grass) ---
let grassMeshes = [];
const dummy = new THREE.Object3D();
const MAX_PER_MESH = 1000;

export function initGrassSystem(scene, count = 5000) {
    grassMeshes = [];
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);

    const mat = createClayMaterial(0x7CFC00);

    const meshCount = Math.ceil(count / MAX_PER_MESH);

    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        scene.add(mesh);
        grassMeshes.push(mesh);
    }

    return grassMeshes;
}

export function addGrassInstance(x, y, z) {
    const mesh = grassMeshes.find(m => m.count < m.instanceMatrix.count);
    if (!mesh) return;

    const index = mesh.count;

    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);

    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

// --- Animation System ---

function freqToHue(freq) {
    if (!freq || freq < 50) return 0;
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0;
}

export function updateFoliageMaterials(audioData, isNight) {
    if (!audioData) return;

    if (isNight) {
        const channels = audioData.channelData;
        if (!channels || channels.length === 0) return;

        // Helper to update a material list
        const updateMats = (mats, startCh) => {
            mats.forEach((mat, i) => {
                const chIndex = startCh + (i % 4);
                const ch = channels[Math.min(chIndex, channels.length - 1)];

                const trigger = ch?.trigger || 0;
                const volume = ch?.volume || 0;
                const freq = ch?.freq || 0;

                if (freq > 0) {
                    let targetHue = freqToHue(freq);
                    targetHue = (targetHue + i * 0.1) % 1.0;
                    const color = new THREE.Color().setHSL(targetHue, 1.0, 0.5);
                    mat.emissive.lerp(color, 0.3);
                } else {
                    mat.emissive.lerp(new THREE.Color(0x220044), 0.1);
                }

                const intensity = 0.2 + volume * 0.5 + trigger * 1.5;
                mat.emissiveIntensity = intensity;
            });
        };

        // 1. Update Petals and Custom Reactive Materials
        updateMats(foliageMaterials.flowerPetal, 1);
        updateMats(reactiveMaterials, 1);

        // 2. Flower Center (Contrast Blink)
        const melodyCh = channels[1];
        if (melodyCh && melodyCh.freq > 0) {
            let hue = freqToHue(melodyCh.freq);
            hue = (hue + 0.5) % 1.0; // Complementary color
            const centerColor = new THREE.Color().setHSL(hue, 1.0, 0.6);
            foliageMaterials.flowerCenter.emissive.lerp(centerColor, 0.2);
        } else {
            foliageMaterials.flowerCenter.emissive.lerp(new THREE.Color(0xFFFACD), 0.1);
        }
        foliageMaterials.flowerCenter.emissiveIntensity = 0.5 + audioData.kickTrigger * 2.0;

        // 3. Update Light Beams (Strobe/Wash)
        const beamMat = foliageMaterials.lightBeam;
        const kick = audioData.kickTrigger;
        const pan = channels[1]?.pan || 0;
        const beamHue = 0.6 + pan * 0.1;
        beamMat.color.setHSL(beamHue, 0.8, 0.8);

        let effectActive = 0;
        for (let c of channels) if (c.activeEffect > 0) effectActive = 1;

        let opacity = kick * 0.4;
        if (effectActive) {
            opacity += Math.random() * 0.3; // Flicker
        }
        beamMat.opacity = Math.max(0, Math.min(0.8, opacity));

        // 4. Grass (Chords)
        const chordVol = Math.max(channels[3]?.volume || 0, channels[4]?.volume || 0);
        const grassHue = 0.6 + chordVol * 0.1;
        foliageMaterials.grass.emissive.setHSL(grassHue, 0.8, 0.2);
        foliageMaterials.grass.emissiveIntensity = 0.2 + chordVol * 0.8;

    } else {
        const resetMats = (mats) => {
            mats.forEach(mat => {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
            });
        };

        resetMats(foliageMaterials.flowerPetal);
        resetMats(reactiveMaterials);

        foliageMaterials.flowerCenter.emissive.setHex(0x000000);
        foliageMaterials.flowerCenter.emissiveIntensity = 0;

        foliageMaterials.grass.emissive.setHex(0x000000);
        foliageMaterials.grass.emissiveIntensity = 0;

        foliageMaterials.lightBeam.opacity = 0;
    }
}

/**
 * Applies animations to foliage objects.
 */
export function animateFoliage(foliageObject, time, audioData, isDay) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType || 'sway';
    const plantType = foliageObject.userData.type;

    let groove = 0;
    let kick = 0;
    let beatPhase = 0;
    let bassVol = 0;
    let leadVol = 0;
    let chordVol = 0;

    if (audioData) {
        groove = audioData.grooveAmount || 0;
        kick = audioData.kickTrigger || 0;
        beatPhase = audioData.beatPhase || 0;
        if (audioData.channelData) {
            bassVol = audioData.channelData[0]?.volume || 0;
            leadVol = Math.max(audioData.channelData[1]?.volume || 0, audioData.channelData[2]?.volume || 0);
            chordVol = Math.max(audioData.channelData[3]?.volume || 0, audioData.channelData[4]?.volume || 0);
        }
    }

    const isNightDancer = (type === 'glowPulse' || plantType === 'starflower' || type === 'spin' || type === 'fiberWhip' || type === 'speakerPulse');
    let isActive = false;
    if (isNightDancer) {
        isActive = !isDay;
    } else {
        isActive = isDay;
    }

    let baseIntensity = isActive ? (1.0 + groove * 8.0) : 0.2;
    let squash = 1.0;
    let spin = 0.0;
    let wave = 0.0;

    if (isActive) {
        if (plantType === 'tree' || plantType === 'mushroom') squash = 1.0 + bassVol * 0.3;
        if (plantType === 'flower' || plantType === 'orb' || plantType === 'starflower') spin = leadVol * 5.0;
        if (plantType === 'grass' || plantType === 'vine' || plantType === 'shrub') wave = chordVol * 2.0;
    }

    const animTime = time + (beatPhase * 2.0);
    const intensity = baseIntensity + wave;

    if (foliageObject.userData.originalY === undefined) {
        foliageObject.userData.originalY = foliageObject.position.y;
    }
    const originalY = foliageObject.userData.originalY;

    // --- Special: Animate Light Beams/Wash ---
    if (foliageObject.userData.isFlower) {
        const melodyCh = audioData?.channelData?.[1];
        if (melodyCh && melodyCh.trigger) {
            const hue = freqToHue(melodyCh.freq);
            const center = foliageObject.getObjectByName('flowerCenter');
            if (center) {
                center.material.emissive.setHSL(hue, 1, 0.5);
            }
            const beam = foliageObject.getObjectByProperty('isBeam', true);
            if (beam) {
                beam.material.color.setHSL(hue, 1, 0.5);
                beam.material.opacity = 1.0;
                beam.scale.y = 10;
            }
        } else {
            const center = foliageObject.getObjectByName('flowerCenter');
            if (center) {
                center.material.emissive.setHSL(0, 0, 0);
            }
            const beam = foliageObject.getObjectByProperty('isBeam', true);
            if (beam) {
                beam.material.opacity *= 0.9;
                beam.scale.y *= 0.9;
            }
        }
    }

    if (plantType === 'tree' || plantType === 'mushroom') {
        if (squash > 1.01) foliageObject.scale.set(squash, 1.0 / squash, squash);
        else foliageObject.scale.set(1, 1, 1);
    }

    if (spin > 0) foliageObject.rotation.y += spin * 0.1;

    // --- RESTORED COMPLEX ANIMATIONS ---

    if (type === 'speakerPulse') {
        // Subwoofer Lotus
        foliageObject.position.y = originalY + Math.sin(time + offset) * 0.2;
        const pump = kick * 0.5;
        const pad = foliageObject.children[0];
        if (pad) {
            pad.scale.set(1.0 + pump * 0.2, 1.0 - pump * 0.5, 1.0 + pump * 0.2);
            // Light up rings if night
            if (!isDay && pad.userData.ringMaterial) {
                const ringMat = pad.userData.ringMaterial;
                const glow = pump * 5.0;
                ringMat.emissive.setHSL(0.0 + pump * 0.2, 1.0, 0.5);
                ringMat.emissiveIntensity = glow;
            }
        }

    } else if (type === 'accordionStretch') {
        // Accordion Palm
        const trunkGroup = foliageObject.userData.trunk;
        if (trunkGroup) {
            const stretch = 1.0 + Math.max(0, Math.sin(animTime * 10 + offset)) * 0.3 * intensity;
            trunkGroup.scale.y = stretch;
            const width = 1.0 / Math.sqrt(stretch);
            trunkGroup.scale.x = width;
            trunkGroup.scale.z = width;
        }

    } else if (type === 'fiberWhip') {
        // Fiber Optic Willow
        foliageObject.rotation.y = Math.sin(time * 0.5 + offset) * 0.1;
        const whip = leadVol * 2.0;
        foliageObject.children.forEach((branchGroup, i) => {
            if (branchGroup === foliageObject.children[0]) return; // Skip trunk
            const childOffset = i * 0.5;
            const cable = branchGroup.children[0];
            let rotZ = Math.PI / 4 + Math.sin(time * 2 + childOffset) * 0.1;
            if (!isDay) {
                rotZ += Math.sin(time * 10 + childOffset) * whip;
                const tip = cable.children[0];
                if (tip) tip.visible = Math.random() < (0.5 + whip);
            }
            if (cable) cable.rotation.z = rotZ;
        });

    } else if (type === 'sway' || type === 'gentleSway' || type === 'vineSway' || type === 'spin') {
        const t = animTime + offset;
        if (type === 'vineSway') {
            foliageObject.children.forEach((segment, i) => {
                segment.rotation.z = Math.sin(t * 2 + i * 0.5) * 0.2 * intensity;
            });
        } else {
            const tFinal = (plantType === 'tree') ? animTime : (time + offset);
            const speed = (plantType === 'tree') ? 1.0 : 2.0;

            if (type === 'spin') {
                foliageObject.rotation.y += 0.02 * intensity;
                foliageObject.rotation.z = Math.cos(time * 0.5 + offset) * 0.05 * intensity;
            } else {
                foliageObject.rotation.z = Math.sin(tFinal * speed + offset) * 0.05 * intensity;
                foliageObject.rotation.x = Math.cos(tFinal * speed * 0.8 + offset) * 0.05 * intensity;
            }
        }
    } else if (type === 'bounce') {
        foliageObject.position.y = originalY + Math.sin(animTime * 3 + offset) * 0.1 * intensity;
        if (isActive && kick > 0.1) foliageObject.position.y += kick * 0.2;

    } else if (type === 'glowPulse') {
        // ... (handled by material update mostly)
    } else if (type === 'float') {
        foliageObject.position.y = originalY + Math.sin(time * 1.5 + offset) * 0.2;
        if (!isDay && kick > 0.1) foliageObject.scale.setScalar(1.0 + kick * 0.2);

    } else if (type === 'spring') {
        foliageObject.scale.y = 1.0 + Math.sin(time * 3 + offset) * 0.1 * intensity + (kick * 0.5);

    } else if (type === 'rain') {
        const rain = foliageObject.children[1];
        if (rain) {
            const positions = rain.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                let y = positions.getY(i);
                y -= 0.1 + (kick * 0.2);
                if (y < -2) y = 0;
                positions.setY(i, y);
            }
            positions.needsUpdate = true;
        }
    }
}