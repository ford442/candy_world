import * as THREE from 'three';

// --- Materials for Foliage ---
const foliageMaterials = {
    grass: new THREE.MeshLambertMaterial({ color: 0x4CBB17 }), // Kelly Green
    flowerStem: new THREE.MeshLambertMaterial({ color: 0x006400 }), // Dark Green
    flowerCenter: new THREE.MeshLambertMaterial({ color: 0xFFD700 }), // Gold
    flowerPetal: [
        new THREE.MeshPhongMaterial({ color: 0xFF1493, shininess: 30 }), // Deep Pink
        new THREE.MeshPhongMaterial({ color: 0x9370DB, shininess: 30 }), // Medium Purple
        new THREE.MeshPhongMaterial({ color: 0x00BFFF, shininess: 30 }), // Deep Sky Blue
    ],
};

/**
 * Creates a simple blade of grass.
 * @returns {THREE.Mesh} A mesh representing a blade of grass.
 */
export function createGrass() {
    const height = 0.5 + Math.random() * 0.5;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
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
    geo.computeVertexNormals();


    const blade = new THREE.Mesh(geo, foliageMaterials.grass);
    blade.castShadow = true;
    return blade;
}

/**
 * Creates a simple flower with a stem, center, and petals.
 * @returns {THREE.Group} A group containing all parts of the flower.
 */
export function createFlower() {
    const group = new THREE.Group();

    // Stem
    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0); // Anchor at the bottom
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    // Flower Head (Center + Petals)
    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    // Center
    const centerGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
    head.add(center);

    // Petals
    const petalCount = 5 + Math.floor(Math.random() * 2);
    const petalGeo = new THREE.IcosahedronGeometry(0.15, 0);
    petalGeo.scale(1, 0.5, 1); // Flatten it a bit
    const petalMat = foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];

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

    // Add a unique animation offset to each flower
    group.userData.animationOffset = Math.random() * 10;

    return group;
}

/**
 * Applies a gentle swaying animation to a foliage object.
 * @param {THREE.Object3D} foliageObject The flower or grass object to animate.
 * @param {number} time The current animation time.
 */
export function animateFoliage(foliageObject, time) {
    const offset = foliageObject.userData.animationOffset || 0;
    // Swaying for the whole object
    foliageObject.rotation.z = Math.sin(time * 2 + offset) * 0.1;
    foliageObject.rotation.x = Math.cos(time * 1.5 + offset) * 0.1;

    // For flowers, also animate the head
    const head = foliageObject.children[1]; // Assuming the head is the second child
    if (head) {
        head.rotation.y = time * 0.5;
    }
}
