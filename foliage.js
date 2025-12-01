import * as THREE from 'three';
import {
    createCandyMaterial,
    createGlowingCandyMaterial,
    createPetalMaterial,
    createIridescentMaterial,
    createJellyMaterial,
    createFrostedMaterial,
    createSwirledMaterial,
    createAudioReactiveMaterial,
    createGroundMaterial
} from './candy-materials.js';

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
    blade.userData.type = 'grass';
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
    group.userData.type = 'flower';
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
    group.userData.type = 'tree';
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
    group.userData.type = 'shrub';
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
    // Use enhanced glowing material
    const headMat = createGlowingCandyMaterial({
        baseColor: color,
        glowIntensity: intensity
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemHeight;
    group.add(head);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

/**
 * Creates a floating orb.
 * @param {Object} options - Options for floating orb: color, size
 * @returns {THREE.Mesh} A mesh representing the floating orb.
 */
export function createFloatingOrb(options = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 32, 32);
    // Use iridescent material for orb
    const mat = createIridescentMaterial({ baseColor: color, strength: 0.8 });
    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    orb.userData.type = 'orb';
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
    group.userData.type = 'vine';
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

// --- New imaginative flowering types (Refined) ---

/**
 * Starflower — a radial star-shaped bloom that slowly spins and breathes.
 */
export function createStarflower(options = {}) {
    const { color = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    // Stem
    const stemH = 0.7 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, stemH, 8); // Smoother
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    // Center - Glowing
    const centerMat = createGlowingCandyMaterial({ baseColor: 0xFFFACD, glowIntensity: 0.8 });
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), centerMat);
    center.position.y = stemH;
    group.add(center);

    // Star petals (cones) arranged radially
    // Increase segments for roundness
    const petalGeo = new THREE.ConeGeometry(0.09, 0.25, 16);
    const petalMat = createPetalMaterial({ baseColor: color, translucency: 0.6 });

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
    group.userData.type = 'starflower';
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
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stemH, 8), createClayMaterial(0x2E8B57));
    stem.castShadow = true;
    stem.position.y = 0;
    group.add(stem);

    // Bell petals - using LatheGeometry for a smooth bell shape
    const points = [];
    for (let i = 0; i < 10; i++) {
        const t = i / 9;
        points.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.15 * (1-t*0.5), t * 0.3));
    }
    const bellGeo = new THREE.LatheGeometry(points, 20);
    bellGeo.rotateX(Math.PI); // Face down
    const bellMat = createIridescentMaterial({ baseColor: color, strength: 0.4 });

    // Group petals/bell into a container for swaying
    const bloom = new THREE.Group();
    bloom.position.y = stemH; // Attach to top of stem

    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.castShadow = true;
    bloom.add(bell);

    // Inner clapper
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), createClayMaterial(0xFFD700));
    clapper.position.y = -0.15;
    bloom.add(clapper);

    group.add(bloom);

    group.userData.bloomRef = bloom; // Reference for animation
    group.userData.animationType = 'bellSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
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
        const length = 4 + Math.floor(Math.random() * 3);

        // Use tube geometry for smoother vine? Or just linked cylinders.
        // Linked cylinders allow independent segment rotation which is nice for physics-like sway.
        for (let i = 0; i < length; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.4, 8), createClayMaterial(0x2E8B57));
            seg.position.y = -i * 0.35;
            seg.rotation.z = Math.sin(i * 0.5) * 0.15;
            strand.add(seg);

            // Small clustered bloom - Glistering Jelly like
            if (i > 0 && Math.random() > 0.4) {
                const b = new THREE.Mesh(
                    new THREE.SphereGeometry(0.08, 12, 12),
                    createJellyMaterial({ baseColor: color, opacity: 0.9 })
                );
                b.position.y = seg.position.y - 0.1;
                b.position.x = (Math.random() - 0.5) * 0.1;
                b.position.z = (Math.random() - 0.5) * 0.1;
                strand.add(b);
            }
        }
        strand.position.x = (Math.random() - 0.5) * 0.8;
        strand.position.z = (Math.random() - 0.5) * 0.8;
        strand.position.y = 0;
        group.add(strand);
    }

    group.userData.animationType = 'vineSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

/**
 * Bubble Willow — a tree with drooping, rounded tube-like branches (Capsules).
 */
export function createBubbleWillow(options = {}) {
    const { color = 0x8A2BE2 } = options;
    const group = new THREE.Group();

    // Trunk - Swirled candy material
    const trunkH = 2.5 + Math.random();
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, trunkH, 16);
    const trunkMat = createSwirledMaterial({ color1: 0x5D4037, color2: 0x8B4513, scale: 3.0 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Drooping branches (Capsules)
    const branchCount = 8 + Math.floor(Math.random() * 4);
    const branchMat = createCandyMaterial({ baseColor: color, roughness: 0.2, iridescence: 0.3 });

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        // Radial distribution
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        // The actual drooping part
        const length = 1.5 + Math.random();
        const capsuleGeo = new THREE.CapsuleGeometry(0.25, length, 8, 24);
        const capsule = new THREE.Mesh(capsuleGeo, branchMat);

        // Orient so it hangs down.
        capsule.position.set(0.6, -length/2, 0); // Offset
        capsule.rotation.z = -Math.PI / 5; // Angle out

        branchGroup.add(capsule);
        group.add(branchGroup);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
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
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.12, stemH, 12);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x6B8E23));
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Big Puffball Head
    const headR = 0.5 + Math.random() * 0.2;
    const headGeo = new THREE.SphereGeometry(headR, 24, 24);
    // Use frosted material for fuzzy look
    const headMat = createFrostedMaterial({ baseColor: color, roughness: 0.8, sparkle: true });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    // Spores (smaller spheres attached) - Increased count significantly
    const sporeCount = 15 + Math.floor(Math.random() * 10);
    const sporeGeo = new THREE.SphereGeometry(headR * 0.25, 12, 12);
    const sporeMat = createCandyMaterial({ baseColor: color + 0x111111, roughness: 0.6 });

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

        // Position slightly outside surface
        const offsetR = headR * (1.0 + Math.random() * 0.2);
        spore.position.set(x * offsetR, stemH + y * offsetR, z * offsetR);
        group.add(spore);
    }

    group.userData.animationType = 'sway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
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
            const tx = Math.cos(t * Math.PI * 4) * 0.3 * t * this.scale;
            const ty = t * 2.5 * this.scale;
            const tz = Math.sin(t * Math.PI * 4) * 0.3 * t * this.scale;
            return optionalTarget.set(tx, ty, tz);
        }
    }

    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    // Increased segments for smoothness
    const tubeGeo = new THREE.TubeGeometry(path, 64, 0.1, 12, false);
    const mat = createClayMaterial(color);
    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    // Glow ball at tip
    const tipGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const tipMat = createAudioReactiveMaterial({ baseColor: 0xFFFACD, intensity: 1.5 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    // Position at end of curve
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);

    group.userData.animationType = 'spring';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub'; // or helix
    return group;
}

/**
 * Balloon Bush — Clumps of varied spheres.
 */
export function createBalloonBush(options = {}) {
    const { color = 0xFF4500 } = options;
    const group = new THREE.Group();

    // Central mass not visible, just holder
    const sphereCount = 6 + Math.floor(Math.random() * 4);
    // Iridescent balloons
    const mat = createCandyMaterial({ baseColor: color, roughness: 0.2, iridescence: 0.5 });

    for (let i=0; i<sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.5;
        const geo = new THREE.SphereGeometry(r, 32, 32); // Smoother spheres
        const mesh = new THREE.Mesh(geo, mat);

        // Random cluster position
        mesh.position.set(
            (Math.random()-0.5) * 1.0,
            r + (Math.random()) * 0.8, // Lifted off ground
            (Math.random()-0.5) * 1.0
        );
        mesh.castShadow = true;
        group.add(mesh);
    }

    group.userData.animationType = 'bounce';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
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
    const cloudGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const cloudMat = createFrostedMaterial({ baseColor: color, roughness: 0.5 });
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
    group.userData.type = 'cloud';
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

// --- Instancing System (Grass) ---
let grassMeshes = [];
const dummy = new THREE.Object3D();
const MAX_PER_MESH = 1000; // Limit to prevent Uniform Buffer overflow (64KB limit)

export function initGrassSystem(scene, count = 5000) {
    grassMeshes = [];
    // Create geometry and material once
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);

    const mat = createClayMaterial(0x7CFC00);

    const meshCount = Math.ceil(count / MAX_PER_MESH);

    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0; // Start with 0 visible
        scene.add(mesh);
        grassMeshes.push(mesh);
    }

    return grassMeshes;
}

export function addGrassInstance(x, y, z) {
    // Find the first mesh that isn't full
    const mesh = grassMeshes.find(m => m.count < m.instanceMatrix.count);
    if (!mesh) return;

    const index = mesh.count;

    dummy.position.set(x, y, z);
    // Add some random rotation for variety
    dummy.rotation.y = Math.random() * Math.PI;
    // Slight scale variation
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);

    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

// --- Animation System ---

function freqToHue(freq) {
    // A simple log mapping for audible range (approx 55Hz to 10kHz)
    if (!freq || freq < 50) return 0;
    // Map A1 (55Hz) to C8 (4186Hz) or similar
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0; // Scale to rotate hue nicely
}

export function updateFoliageMaterials(audioData, isNight) {
    if (!audioData) return;

    // Nighttime Blinking Logic & Note Reactivity
    if (isNight) {
        const channels = audioData.channelData;
        if (!channels || channels.length === 0) return;

        foliageMaterials.flowerPetal.forEach((mat, i) => {
            // Map material index to a channel. We cycle through available channels.
            // Note: We might have more materials than channels or vice versa.
            // Let's check channels 1, 2, 3 mostly for melody/chords
            // But here we just cycle.
            const chIndex = (i + 1) % Math.min(channels.length, 8); // Skip Ch 0 (Kick) usually?
            const ch = channels[chIndex];

            const trigger = ch?.trigger || 0;
            const volume = ch?.volume || 0;
            const freq = ch?.freq || 0;

            // Idea 3: Note-Reactive Bioluminescence
            // If freq is present, update Emissive Color
            if (freq > 0) {
                 const targetHue = freqToHue(freq);
                 const color = new THREE.Color().setHSL(targetHue, 1.0, 0.5);
                 // Lerp current emissive color to target?
                 // Material.emissive is a color.
                 mat.emissive.lerp(color, 0.2);
            } else {
                 // Fallback to base color if silence
                 mat.emissive.lerp(mat.color, 0.1);
            }

            // Base emissive + pulse
            const intensity = 0.2 + volume * 0.5 + trigger * 3.0;
            mat.emissiveIntensity = intensity;
        });

        // Also center
        foliageMaterials.flowerCenter.emissive.setHex(0xFFFACD);
        foliageMaterials.flowerCenter.emissiveIntensity = audioData.kickTrigger * 3.0;

    } else {
        // Reset to day state (no emission)
        foliageMaterials.flowerPetal.forEach(mat => {
            mat.emissive.setHex(0x000000);
            mat.emissiveIntensity = 0;
        });
        foliageMaterials.flowerCenter.emissive.setHex(0x000000);
        foliageMaterials.flowerCenter.emissiveIntensity = 0;
    }
}

/**
 * Applies animations to foliage objects.
 * @param {THREE.Object3D} foliageObject The foliage object to animate.
 * @param {number} time The current animation time.
 * @param {Object} audioData Audio analysis data (optional).
 * @param {boolean} isDay Whether it is daytime (enables dancing).
 */
export function animateFoliage(foliageObject, time, audioData, isDay) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType || 'sway';
    const plantType = foliageObject.userData.type;

    // --- Audio Analysis ---
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
            // Sum leads (typically 1 and 2)
            leadVol = Math.max(audioData.channelData[1]?.volume || 0, audioData.channelData[2]?.volume || 0);
            // Sum chords (typically 3+)
            chordVol = Math.max(audioData.channelData[3]?.volume || 0, audioData.channelData[4]?.volume || 0);
        }
    }

    // --- Intensity Logic (Midnight Dance) ---
    // User requested "invert logic... dance harder when sun goes down"
    // Day = Relaxed (0.5), Night = Party Mode (1.0 + Groove)
    const baseIntensity = isDay ? 0.5 : (1.0 + groove * 8.0);

    // --- Channel Mappings (Night Only) ---
    let squash = 1.0;
    let spin = 0.0;
    let wave = 0.0;

    if (!isDay) {
        if (plantType === 'tree' || plantType === 'mushroom') {
            // Squash/Stretch on Bass
            squash = 1.0 + bassVol * 0.3;
        }
        if (plantType === 'flower' || plantType === 'orb' || plantType === 'starflower') {
            // Spin on Leads
            spin = leadVol * 5.0;
        }
        if (plantType === 'grass' || plantType === 'vine' || plantType === 'shrub') {
            // Wave on Chords
            wave = chordVol * 2.0;
        }
    }

    // --- Animation Time ---
    // Sync to Beat Phase for tight synchronization
    const animTime = time + (beatPhase * 2.0);

    // --- Apply Effects ---

    // 1. Squash/Stretch (Trees/Mushrooms)
    if (plantType === 'tree' || plantType === 'mushroom') {
        if (squash > 1.01) {
            foliageObject.scale.set(squash, 1.0 / squash, squash);
        } else {
            // Reset to normal if not squashing (assuming no dynamic growth for these)
            foliageObject.scale.set(1, 1, 1);
        }
    }

    // 2. Spin (Flowers)
    if (spin > 0) {
        foliageObject.rotation.y += spin * 0.1;
    }

    // 3. Movement Types
    const intensity = baseIntensity + wave;

    // Capture Original Y to prevent drift
    if (foliageObject.userData.originalY === undefined) {
        foliageObject.userData.originalY = foliageObject.position.y;
    }
    const originalY = foliageObject.userData.originalY;

    if (type === 'sway' || type === 'gentleSway' || type === 'vineSway' || type === 'spin') {
        const t = animTime + offset;

        if (type === 'vineSway') {
            foliageObject.children.forEach((segment, i) => {
                segment.rotation.z = Math.sin(t * 2 + i * 0.5) * 0.2 * intensity;
            });
        } else {
            // Trees wave in tempo
            // If tree, use strict beat time, else modulated time
            const tFinal = (plantType === 'tree') ? animTime : (time + offset);
            const speed = (plantType === 'tree') ? 1.0 : 2.0;

            if (type === 'spin') {
                // Continuous spin base
                foliageObject.rotation.y += 0.02 * intensity;
                foliageObject.rotation.z = Math.cos(time * 0.5 + offset) * 0.05 * intensity;

                // Starflower breathing
                if (plantType === 'starflower') {
                    const breath = 1.0 + Math.sin(time * 2.0) * 0.1;
                    foliageObject.scale.setScalar(breath);
                }
            } else {
                foliageObject.rotation.z = Math.sin(tFinal * speed + offset) * 0.05 * intensity;
                foliageObject.rotation.x = Math.cos(tFinal * speed * 0.8 + offset) * 0.05 * intensity;
            }
        }
    } else if (type === 'bellSway') {
        const bloom = foliageObject.userData.bloomRef;
        if (bloom) {
            bloom.rotation.z = Math.sin(animTime * 2.0 + offset) * 0.3 * intensity;
            bloom.rotation.x = Math.cos(animTime * 1.5 + offset) * 0.1 * intensity;
        }

    } else if (type === 'bounce') {
        foliageObject.position.y = originalY + Math.sin(animTime * 3 + offset) * 0.1 * intensity;
        // Kick bounce
        if (kick > 0.1) foliageObject.position.y += kick * 0.2;

    } else if (type === 'glowPulse') {
        if (foliageObject.children[1] && foliageObject.children[1].material) {
            foliageObject.children[1].material.emissiveIntensity = 1.5 + Math.sin(time * 3 + offset) * 0.5 + (kick * 2.0);
        }
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
                y -= 0.1 + (kick * 0.2); // Rain falls faster on kick
                if (y < -2) y = 0; // Reset position
                positions.setY(i, y);
            }
            positions.needsUpdate = true;
        }
    }
}
