// Deprecated compatibility wrapper for creators directory
export * from './creators/index.ts';

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
        const u = Math.random(); const v = Math.random(); const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1); const x = Math.sin(phi) * Math.cos(theta); const y = Math.sin(phi) * Math.sin(theta); const z = Math.cos(phi);
        spore.position.set(x * headR, stemH + y * headR, z * headR);
        group.add(spore);
    }
    group.userData.animationType = 'sway'; group.userData.animationOffset = Math.random() * 10; group.userData.type = 'flower'; return group;
}

export function createHelixPlant(options = {}) {
    const { color = 0x00FA9A } = options;
    const group = new THREE.Group();
    class SpiralCurve extends THREE.Curve { constructor(scale = 1) { super(); this.scale = scale } getPoint(t, optionalTarget = new THREE.Vector3()) { const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale; const ty = t * 2.0 * this.scale; const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale; return optionalTarget.set(tx, ty, tz); } }
    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
    const mat = createClayMaterial(color); registerReactiveMaterial(mat); const mesh = new THREE.Mesh(tubeGeo, mat); mesh.castShadow = true; group.add(mesh);
    const tipGeo = new THREE.SphereGeometry(0.15, 8, 8); const tipMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5 }); registerReactiveMaterial(tipMat); const tip = new THREE.Mesh(tipGeo, tipMat); const endPoint = path.getPoint(1); tip.position.copy(endPoint); group.add(tip);
    group.userData.animationType = 'spring'; group.userData.animationOffset = Math.random() * 10; group.userData.type = 'shrub'; return group;
}

export function createBalloonBush(options = {}) {
    const { color = 0xFF4500 } = options; const group = new THREE.Group(); const sphereCount = 5 + Math.floor(Math.random() * 5); const mat = createClayMaterial(color); registerReactiveMaterial(mat); for (let i = 0; i < sphereCount; i++) { const r = 0.3 + Math.random() * 0.4; const geo = new THREE.SphereGeometry(r, 16, 16); const mesh = new THREE.Mesh(geo, mat); mesh.position.set((Math.random() - 0.5) * 0.8, r + (Math.random()) * 0.8, (Math.random() - 0.5) * 0.8); mesh.castShadow = true; group.add(mesh); } group.userData.animationType = 'bounce'; group.userData.animationOffset = Math.random() * 10; group.userData.type = 'shrub'; return group; }

export function createPrismRoseBush(options = {}) {
    const group = new THREE.Group();
    const stemsMat = createClayMaterial(0x5D4037);
    const baseHeight = 1.0 + Math.random() * 0.5;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, baseHeight, 8); trunkGeo.translate(0, baseHeight/2, 0); const trunk = new THREE.Mesh(trunkGeo, stemsMat); trunk.castShadow = true; group.add(trunk);
    const branchCount = 3 + Math.floor(Math.random() * 3);
    const roseColors = [0xFF0055, 0xFFAA00, 0x00CCFF, 0xFF00FF, 0x00FF88];
    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group(); branchGroup.position.y = baseHeight * 0.8; branchGroup.rotation.y = (i / branchCount) * Math.PI * 2; branchGroup.rotation.z = Math.PI / 4; const branchLen = 0.8 + Math.random() * 0.5; const branchGeo = new THREE.CylinderGeometry(0.08, 0.1, branchLen, 6); branchGeo.translate(0, branchLen/2, 0); const branch = new THREE.Mesh(branchGeo, stemsMat); branchGroup.add(branch);
        const roseGroup = new THREE.Group(); roseGroup.position.y = branchLen; const color = roseColors[Math.floor(Math.random() * roseColors.length)]; const petalMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, emissive: 0x000000, emissiveIntensity: 0.0 }); registerReactiveMaterial(petalMat); const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3); const outer = new THREE.Mesh(outerGeo, petalMat); outer.scale.set(1,0.6,1); roseGroup.add(outer); const innerGeo = new THREE.SphereGeometry(0.15, 16, 16); const inner = new THREE.Mesh(innerGeo, petalMat); inner.position.y = 0.05; roseGroup.add(inner);
        const washGeo = new THREE.SphereGeometry(1.2, 16, 16); const washMat = foliageMaterials.lightBeam.clone(); washMat.color.setHex(color); const wash = new THREE.Mesh(washGeo, washMat); wash.userData.isWash = true; roseGroup.add(wash);
        branchGroup.add(roseGroup); group.add(branchGroup);
    }
    group.userData.animationType = 'sway'; group.userData.animationOffset = Math.random() * 10; group.userData.type = 'flower'; return group;
}

// Additional creations can be added or split further as needed
