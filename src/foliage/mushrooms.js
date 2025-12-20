import * as THREE from 'three';
import { color, time, sin, positionLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { foliageMaterials, registerReactiveMaterial, attachReactivity, pickAnimation, eyeGeo } from './common.js';

export function createMushroom(options = {}) {
    const {
        size = 'regular',
        scale = 1.0,
        colorIndex = -1,
        hasFace = false,
        isBouncy = false
    } = options;

    const group = new THREE.Group();
    const isGiant = size === 'giant';
    const showFace = isGiant || hasFace;

    const baseScale = isGiant ? 8.0 * scale : 1.0 * scale;
    const stemH = (1.0 + Math.random() * 0.5) * baseScale;
    const stemR = (0.15 + Math.random() * 0.1) * baseScale;
    const capR = stemR * (2.5 + Math.random()) * (isGiant ? 1.0 : 1.2);

    const stemPoints = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const r = stemR * (1.0 - Math.pow(t - 0.3, 2) * 0.5);
        const y = t * stemH;
        stemPoints.push(new THREE.Vector2(r, y));
    }
    const stemGeo = new THREE.LatheGeometry(stemPoints, 16);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.mushroomStem);
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    const capGeo = new THREE.SphereGeometry(capR, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.8);
    let capMat;
    let chosenColorIndex;
    if (colorIndex >= 0 && colorIndex < foliageMaterials.mushroomCap.length) {
        chosenColorIndex = colorIndex;
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    } else {
        chosenColorIndex = Math.floor(Math.random() * foliageMaterials.mushroomCap.length);
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    }

    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = stemH - (capR * 0.2);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const gillGeo = new THREE.ConeGeometry(capR * 0.9, capR * 0.4, 24, 1, true);
    const gillMat = foliageMaterials.mushroomGills;
    const gill = new THREE.Mesh(gillGeo, gillMat);
    gill.position.y = stemH - (capR * 0.2);
    gill.rotation.x = Math.PI;
    group.add(gill);

    const spotCount = 3 + Math.floor(Math.random() * 5);
    const spotGeo = new THREE.SphereGeometry(capR * 0.15, 6, 6);
    const spotMat = foliageMaterials.mushroomSpots;

    for (let i = 0; i < spotCount; i++) {
        const u = Math.random();
        const v = Math.random() * 0.5;
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(1 - v);

        const x = Math.sin(phi) * Math.cos(theta) * capR;
        const y = Math.cos(phi) * capR;
        const z = Math.sin(phi) * Math.sin(theta) * capR;

        const spot = new THREE.Mesh(spotGeo, spotMat);
        spot.position.set(x, y + stemH - (capR * 0.2), z);
        spot.scale.set(1, 0.2, 1);
        spot.lookAt(0, stemH + capR, 0);
        group.add(spot);
    }

    if (showFace) {
        const faceGroup = new THREE.Group();
        // Adjust position based on size
        // For regular mushrooms, we need to be careful with positioning relative to stemR/H which are calculated above
        // The original code used stemR * 0.95 which pushes it to the surface of the stem
        faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);

        // Scale face: For giants, baseScale is 8.0. For regular, it's 1.0.
        // However, the original code used 'faceScale = baseScale' which meant for giants (8x), the face was 8x bigger.
        // But for regular (1x), we might want it slightly larger relative to the stem if the stem is thin?
        // Let's stick to baseScale first.
        const faceScale = isGiant ? baseScale : baseScale * 0.6;
        faceGroup.scale.set(faceScale, faceScale, faceScale);

        const leftEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        leftEye.position.set(-0.15, 0.1, 0);
        const rightEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        rightEye.position.set(0.15, 0.1, 0);

        const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
        const smile = new THREE.Mesh(smileGeo, foliageMaterials.mouth);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -0.05, 0);

        faceGroup.add(leftEye, rightEye, smile);
        group.add(faceGroup);
    }

    const isGlowing = Math.random() < 0.2;

    if (isGiant) {
        const breathMat = new MeshStandardNodeMaterial({
            color: capMat.color,
            roughness: 0.8,
            metalness: 0.0,
        });

        const pos = positionLocal;
        const breathSpeed = time.mul(2.0);

        const breath = sin(breathSpeed).mul(0.1).add(1.0);

        breathMat.positionNode = pos.mul(breath);

        const emissivePulse = sin(breathSpeed.mul(2.0)).mul(0.2).add(0.3);
        breathMat.emissiveNode = color(capMat.color).mul(emissivePulse);

        cap.material = breathMat;
    }
    else if (isGlowing) {
        const light = new THREE.PointLight(capMat.color, 1.0, 5.0);
        light.position.y = stemH;
        group.add(light);

        const glowMat = capMat.clone();
        glowMat.emissive = capMat.color;
        glowMat.emissiveIntensity = 0.5;
        cap.material = glowMat;
        registerReactiveMaterial(glowMat);
    }

    group.userData.animationType = pickAnimation(['wobble', 'bounce', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'mushroom';
    group.userData.colorIndex = typeof chosenColorIndex === 'number' ? chosenColorIndex : -1;

    if (isGiant || isBouncy) {
        group.userData.isTrampoline = true;
    }

    return attachReactivity(group);
}
