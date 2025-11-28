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
};

/**
 * Creates a blade of grass with variety.
 * @param {Object} options - Options for grass: color, shape ('tall', 'bushy')
 * @returns {THREE.Mesh} A mesh representing a blade of grass.
 */
export function createGrass(options = {}) {
    const { color = 0x7CFC00, shape = 'tall' } = options;
    const material = createClayMaterial(color);
    let geo;
    if (shape === 'tall') {
        const height = 0.5 + Math.random();
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
        geo.translate(0, height / 2, 0); // Anchor at the bottom
        // Add a slight curve
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > height * 0.5) { // Only bend the top half
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
    blade.userData.animationType = shape === 'tall' ? 'sway' : 'bounce';
    blade.userData.animationOffset = Math.random() * 10;
    return blade;
}

/**
 * Creates a flower with variety.
 * @param {Object} options - Options for flower: color, shape ('simple', 'multi', 'spiral', 'layered')
 * @returns {THREE.Group} A group containing all parts of the flower.
 */
export function createFlower(options = {}) {
    const { color = null, shape = 'simple' } = options;
    const group = new THREE.Group();

    // Stem
    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0); // Anchor at the bottom
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    // Flower Head
    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    // Center
    const centerGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
    head.add(center);

    // Petals based on shape
    let petalMat = color ? createClayMaterial(color) : foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];
    if (shape === 'simple') {
        const petalCount = 5 + Math.floor(Math.random() * 2);
        const petalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        petalGeo.scale(1, 0.5, 1); // Flatten it a bit
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(
                Math.cos(angle) * 0.18,
                0,
                Math.sin(angle) * 0.18
            );
            petal.rotation.z = Math.PI / 4;
            head.add(petal);
        }
    } else if (shape === 'multi') {
        const petalCount = 8 + Math.floor(Math.random() * 4);
        const petalGeo = new THREE.SphereGeometry(0.12, 8, 8);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(
                Math.cos(angle) * 0.2,
                Math.sin(i * 0.5) * 0.1,
                Math.sin(angle) * 0.2
            );
            head.add(petal);
        }
    } else if (shape === 'spiral') {
        const petalCount = 10;
        const petalGeo = new THREE.ConeGeometry(0.1, 0.2, 6);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 4; // Spiral
            const radius = 0.05 + (i / petalCount) * 0.15;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(
                Math.cos(angle) * radius,
                (i / petalCount) * 0.1,
                Math.sin(angle) * radius
            );
            petal.rotation.z = angle;
            head.add(petal);
        }
    } else if (shape === 'layered') {
        // Two layers
        for (let layer = 0; layer < 2; layer++) {
            const petalCount = 6;
            const petalGeo = new THREE.IcosahedronGeometry(0.12, 0);
            petalGeo.scale(1, 0.5, 1);
            const layerColor = layer === 0 ? petalMat : createClayMaterial(color ? color + 0x111111 : 0xFFD700); // Slightly different color
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

    // Add a unique animation offset to each flower
    group.userData.animationOffset = Math.random() * 10;
    group.userData.animationType = 'sway';
    return group;
}

/**
 * Creates a flowering tree.
 * @param {Object} options - Options for tree: color, shape
 * @returns {THREE.Group} A group containing the tree.
 */
export function createFloweringTree(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    // Trunk
    const trunkH = 3 + Math.random() * 2;
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkH, 16);
    const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x8B5A2B));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Blooms
    const bloomMat = createClayMaterial(color);
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
    return group;
}

/**
 * Creates a shrub with flowers.
 * @param {Object} options - Options for shrub: color
 * @returns {THREE.Group} A group containing the shrub.
 */
export function createShrub(options = {}) {
    const { color = 0x32CD32 } = options;
    const group = new THREE.Group();

    // Base
    const baseGeo = new THREE.SphereGeometry(1 + Math.random() * 0.5, 16, 16);
    const base = new THREE.Mesh(baseGeo, createClayMaterial(color));
    base.position.y = 0.5;
    base.castShadow = true;
    group.add(base);

    // Flowers on top
    const flowerCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < flowerCount; i++) {
        const flowerGeo = new THREE.SphereGeometry(0.2, 8, 8);
        const flower = new THREE.Mesh(flowerGeo, createClayMaterial(0xFF69B4));
        flower.position.set(
            (Math.random() - 0.5) * 1.5,
            1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(flower);
    }

    group.userData.animationType = 'bounce';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

// --- New Foliage Types ---

/**
 * Creates a glowing flower.
 * @param {Object} options - Options for glowing flower: color, intensity
 * @returns {THREE.Group} A group containing the glowing flower.
 */
export function createGlowingFlower(options = {}) {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    // Stem
    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    // Glowing Head
    const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const headMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.8
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemHeight;
    group.add(head);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Creates a floating orb.
 * @param {Object} options - Options for floating orb: color, size
 * @returns {THREE.Mesh} A mesh representing the floating orb.
 */
export function createFloatingOrb(options = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 16, 16);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    return orb;
}

/**
 * Creates an animated vine.
 * @param {Object} options - Options for vine: color, length
 * @returns {THREE.Group} A group containing the vine.
 */
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
    return group;
}

/**
 * Creates a single leaf particle for effects.
 * @param {Object} options - Options for the leaf: color
 * @returns {THREE.Mesh} A mesh representing a leaf.
 */
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

// --- New imaginative flowering types ---

/**
 * Starflower — a radial star-shaped bloom that slowly spins.
 */
export function createStarflower(options = {}) {
    const { color = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    // Stem
    const stemH = 0.7 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, stemH, 6);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    // Center
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), createClayMaterial(0xFFFACD));
    center.position.y = stemH;
    group.add(center);

    // Star petals (cones) arranged radially
    const petalGeo = new THREE.ConeGeometry(0.09, 0.2, 6);
    const petalMat = createClayMaterial(color);
    const petalCount = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.16, stemH, Math.sin(angle) * 0.16);
        petal.rotation.x = Math.PI * 0.5;
        petal.rotation.z = angle;
        group.add(petal);
    }

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Bell Bloom — hanging bell-shaped petals that sway more dramatically.
 */
export function createBellBloom(options = {}) {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    // Short stem
    const stemH = 0.4 + Math.random() * 0.2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stemH, 6), createClayMaterial(0x2E8B57));
    stem.castShadow = true;
    stem.position.y = 0;
    group.add(stem);

    // Bell petals — cones pointing downward
    const petalGeo = new THREE.ConeGeometry(0.12, 0.28, 10);
    const petalMat = createClayMaterial(color);
    const petals = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petals; i++) {
        const p = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petals) * Math.PI * 2;
        p.position.set(Math.cos(angle) * 0.08, -0.08, Math.sin(angle) * 0.08);
        p.rotation.x = Math.PI; // point downward
        p.castShadow = true;
        group.add(p);
    }

    group.userData.animationType = 'sway'; // reuse sway but amplitude can be larger via offset
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Wisteria Cluster — multiple short vine segments with clustered tiny blooms.
 */
export function createWisteriaCluster(options = {}) {
    const { color = 0xCFA0FF, strands = 4 } = options;
    const group = new THREE.Group();

    for (let s = 0; s < strands; s++) {
        const strand = new THREE.Group();
        const length = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < length; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), createClayMaterial(0x2E8B57));
            seg.position.y = -i * 0.35;
            seg.rotation.z = Math.sin(i * 0.5) * 0.15;
            strand.add(seg);

            // Small clustered bloom
            if (i > 0 && Math.random() > 0.6) {
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), createClayMaterial(color));
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
    return group;
}

// --- New Roundy Foliage Types (Requested by User) ---

/**
 * Bubble Willow — a tree with drooping, rounded tube-like branches (Capsules).
 */
export function createBubbleWillow(options = {}) {
    const { color = 0x8A2BE2 } = options;
    const group = new THREE.Group();

    // Trunk
    const trunkH = 2.5 + Math.random();
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, trunkH, 12);
    const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x5D4037));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Drooping branches (Capsules)
    const branchCount = 6 + Math.floor(Math.random() * 4);
    const branchMat = createClayMaterial(color);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        // Radial distribution
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        // The actual drooping part
        const length = 1.5 + Math.random();
        const capsuleGeo = new THREE.CapsuleGeometry(0.2, length, 8, 16);
        const capsule = new THREE.Mesh(capsuleGeo, branchMat);

        // Orient so it hangs down.
        // Default capsule is vertical. We want it to curve out and down.
        // Simplified: Rotate it so it points somewhat down-out
        capsule.position.set(0.5, -length/2, 0); // Offset
        capsule.rotation.z = -Math.PI / 6; // Angle out

        branchGroup.add(capsule);
        group.add(branchGroup);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Puffball Flower — Large spherical blooms on thick stems.
 */
export function createPuffballFlower(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    // Thick Stem
    const stemH = 1.0 + Math.random() * 0.5;
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.12, stemH, 8);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x6B8E23));
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Big Puffball Head
    const headR = 0.4 + Math.random() * 0.2;
    const headGeo = new THREE.SphereGeometry(headR, 16, 16);
    const headMat = createClayMaterial(color);
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    // Spores (smaller spheres attached)
    const sporeCount = 4 + Math.floor(Math.random() * 4);
    const sporeGeo = new THREE.SphereGeometry(headR * 0.3, 8, 8);
    const sporeMat = createClayMaterial(color + 0x111111); // Slightly lighter
    for(let i=0; i<sporeCount; i++) {
        const spore = new THREE.Mesh(sporeGeo, sporeMat);
        // Random point on sphere surface
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
    return group;
}

/**
 * Helix Plant — Smooth, rounded spiral shapes.
 */
export function createHelixPlant(options = {}) {
    const { color = 0x00FA9A } = options;
    const group = new THREE.Group();

    // Create a spiral curve
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
    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    // Glow ball at tip
    const tipGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const tipMat = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    // Position at end of curve
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);

    group.userData.animationType = 'spring'; // New animation type needed? Or reuse bounce?
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Balloon Bush — Clumps of varied spheres.
 */
export function createBalloonBush(options = {}) {
    const { color = 0xFF4500 } = options;
    const group = new THREE.Group();

    // Central mass not visible, just holder
    const sphereCount = 5 + Math.floor(Math.random() * 5);
    const mat = createClayMaterial(color);

    for (let i=0; i<sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.4;
        const geo = new THREE.SphereGeometry(r, 16, 16);
        const mesh = new THREE.Mesh(geo, mat);

        // Random cluster position
        mesh.position.set(
            (Math.random()-0.5) * 0.8,
            r + (Math.random()) * 0.8, // Lifted off ground
            (Math.random()-0.5) * 0.8
        );
        mesh.castShadow = true;
        group.add(mesh);
    }

    group.userData.animationType = 'bounce';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Creates a raining cloud with particle effects.
 * @param {Object} options - Options for the cloud: color, rain intensity.
 * @returns {THREE.Group} A group containing the cloud and rain particles.
 */
export function createRainingCloud(options = {}) {
    const { color = 0xB0C4DE, rainIntensity = 50 } = options;
    const group = new THREE.Group();

    // Cloud body
    const cloudGeo = new THREE.SphereGeometry(1.5, 16, 16);
    const cloudMat = createClayMaterial(color);
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.castShadow = true;
    group.add(cloud);

    // Rain particles
    const rainGeo = new THREE.BufferGeometry();
    const rainCount = rainIntensity;
    const positions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 3; // x
        positions[i * 3 + 1] = Math.random() * -2; // y
        positions[i * 3 + 2] = (Math.random() - 0.5) * 3; // z
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
    const rain = new THREE.Points(rainGeo, rainMat);
    group.add(rain);

    group.userData.animationType = 'rain';
    group.userData.animationOffset = Math.random() * 10;
    return group;
}

/**
 * Creates a patch of glowing flowers.
 */
export function createGlowingFlowerPatch(x, z) {
    const patch = new THREE.Group();
    patch.position.set(x, 0, z);
    for(let i=0; i<5; i++) {
        const gf = createGlowingFlower();
        gf.position.set(Math.random()*2 - 1, 0, Math.random()*2 - 1);
        patch.add(gf);
    }
    return patch;
}

/**
 * Creates a cluster of floating orbs.
 */
export function createFloatingOrbCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 5, z);
    for(let i=0; i<3; i++) {
        const orb = createFloatingOrb();
        orb.position.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        cluster.add(orb);
    }
    return cluster;
}

/**
 * Creates a cluster of vines.
 */
export function createVineCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 0, z);
    for(let i=0; i<3; i++) {
        const vine = createVine();
        vine.position.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        cluster.add(vine);
    }
    return cluster;
}

// --- Animation System ---

/**
 * Applies animations to foliage objects.
 * @param {THREE.Object3D} foliageObject The foliage object to animate.
 * @param {number} time The current animation time.
 */
export function animateFoliage(foliageObject, time) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType || 'sway';

    if (type === 'rain') {
        const rain = foliageObject.children[1];
        if (rain) {
            const positions = rain.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                let y = positions.getY(i);
                y -= 0.1; // Move rain downward
                if (y < -2) y = 0; // Reset position
                positions.setY(i, y);
            }
            positions.needsUpdate = true;
        }
    }

    if (type === 'sway') {
        foliageObject.rotation.z = Math.sin(time * 2 + offset) * 0.1;
        foliageObject.rotation.x = Math.cos(time * 1.5 + offset) * 0.1;
        // For flowers, also animate the head
        const head = foliageObject.children[1];
        if (head) {
            head.rotation.y = time * 0.5;
        }
    } else if (type === 'bounce') {
        foliageObject.position.y += Math.sin(time * 3 + offset) * 0.01;
    } else if (type === 'gentleSway') {
        foliageObject.rotation.z = Math.sin(time + offset) * 0.05;
    } else if (type === 'glowPulse') {
        if (foliageObject.children[1] && foliageObject.children[1].material) {
            foliageObject.children[1].material.emissiveIntensity = 1.5 + Math.sin(time * 3 + offset) * 0.5;
        }
    } else if (type === 'float') {
        foliageObject.position.y += Math.sin(time * 2 + offset) * 0.05;
    } else if (type === 'vineSway') {
        foliageObject.children.forEach((segment, i) => {
            segment.rotation.z = Math.sin(time * 2 + offset + i * 0.5) * 0.2;
        });
    } else if (type === 'spin') {
        // global spin of the whole group
        foliageObject.rotation.y = Math.sin(time + offset) * 0.8;
        foliageObject.rotation.z = Math.cos(time * 0.5 + offset) * 0.05;
    } else if (type === 'spring') {
        // Scale vertical stretch
        foliageObject.scale.y = 1.0 + Math.sin(time * 3 + offset) * 0.1;
    }
}
