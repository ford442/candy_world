// src/foliage/mushrooms.js

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
    // All mushrooms get faces now if requested, but giants always have them
    const showFace = isGiant || hasFace;

    const baseScale = isGiant ? 8.0 * scale : 1.0 * scale;
    const stemH = (1.0 + Math.random() * 0.5) * baseScale;
    const stemR = (0.15 + Math.random() * 0.1) * baseScale;
    const capR = stemR * (2.5 + Math.random()) * (isGiant ? 1.0 : 1.2);

    // Stem Geometry (Lathe)
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

    // Cap Geometry (Sphere)
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

    // Clone material to allow individual emissive strobing
    const instanceCapMat = capMat.clone();
    // Ensure base emissive is set for fade-back
    instanceCapMat.userData.baseEmissive = new THREE.Color(0x000000);

    const cap = new THREE.Mesh(capGeo, instanceCapMat);
    cap.position.y = stemH - (capR * 0.2);
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    // Gills (Cone)
    const gillGeo = new THREE.ConeGeometry(capR * 0.9, capR * 0.4, 24, 1, true);
    const gillMat = foliageMaterials.mushroomGills;
    const gill = new THREE.Mesh(gillGeo, gillMat);
    gill.position.y = stemH - (capR * 0.2);
    gill.rotation.x = Math.PI;
    group.add(gill);

    // Spots
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

    // Face
    if (showFace) {
        const faceGroup = new THREE.Group();
        // Position face on the front of the stem/cap junction
        faceGroup.position.set(0, stemH * 0.6, stemR * 0.85);
        const faceScale = isGiant ? baseScale : baseScale * 0.6;
        faceGroup.scale.set(faceScale, faceScale, faceScale);

        // Eyes
        const leftEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        leftEye.position.set(-0.15, 0.1, 0.1);
        const rightEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        rightEye.position.set(0.15, 0.1, 0.1);

        // Pupils
        const pupilGeo = new THREE.SphereGeometry(0.06, 8, 8);
        const leftPupil = new THREE.Mesh(pupilGeo, foliageMaterials.pupil);
        leftPupil.position.set(0, 0, 0.1);
        leftEye.add(leftPupil);

        const rightPupil = new THREE.Mesh(pupilGeo, foliageMaterials.pupil);
        rightPupil.position.set(0, 0, 0.1);
        rightEye.add(rightPupil);

        // Smile
        const smileGeo = new THREE.TorusGeometry(0.12, 0.04, 6, 12, Math.PI);
        const smile = new THREE.Mesh(smileGeo, foliageMaterials.clayMouth);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -0.05, 0.1);

        // Cheeks (Rosy!)
        const cheekGeo = new THREE.SphereGeometry(0.08, 8, 8);
        const leftCheek = new THREE.Mesh(cheekGeo, foliageMaterials.mushroomCheek);
        leftCheek.position.set(-0.25, 0.0, 0.05);
        leftCheek.scale.set(1, 0.6, 0.5);

        const rightCheek = new THREE.Mesh(cheekGeo, foliageMaterials.mushroomCheek);
        rightCheek.position.set(0.25, 0.0, 0.05);
        rightCheek.scale.set(1, 0.6, 0.5);

        faceGroup.add(leftEye, rightEye, smile, leftCheek, rightCheek);
        group.add(faceGroup);
    }

    // Giant Breathing Effect & Pulsing Stripes (TSL)
    if (isGiant) {
        const breathMat = new MeshStandardNodeMaterial({
            color: instanceCapMat.color, // Use the clay color
            roughness: 0.8,
            metalness: 0.0,
        });

        const pos = positionLocal;
        const breathSpeed = time.mul(2.0);
        const breath = sin(breathSpeed).mul(0.1).add(1.0);
        // Displace vertices for breathing
        breathMat.positionNode = pos.mul(breath);

        // Animated Emission Stripes
        // Use positionLocal.y to create horizontal stripes
        // Use time to move them upwards
        const stripeFreq = 10.0;
        const stripeSpeed = 2.0;
        const stripePattern = sin(pos.y.mul(stripeFreq).sub(time.mul(stripeSpeed)));

        // Clamp to 0-1 and sharpen
        const stripeIntensity = stripePattern.add(1.0).mul(0.5).pow(2.0);

        // Base color pulse + Stripe overlay
        const basePulse = sin(breathSpeed.mul(2.0)).mul(0.1).add(0.2);
        const totalEmission = stripeIntensity.mul(0.3).add(basePulse);

        breathMat.emissiveNode = color(instanceCapMat.color).mul(totalEmission);

        cap.material = breathMat;
        // Keep reference for reactivity override
        instanceCapMat.colorNode = breathMat.colorNode;
    }

    group.userData.animationType = pickAnimation(['wobble', 'bounce', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'mushroom';
    group.userData.colorIndex = typeof chosenColorIndex === 'number' ? chosenColorIndex : -1;
    
    // --- IMPORTANT: Metadata for Weather System ---
    group.userData.size = size;
    group.userData.capRadius = capR;
    group.userData.capHeight = stemH;
    group.userData.stemRadius = stemR;

    // Register cap for flash animation system
    group.userData.reactiveMeshes = [cap];
    // ----------------------------------------------

    if (isGiant || isBouncy) {
        group.userData.isTrampoline = true;
    }

    // Attach Reactivity with Custom Logic
    attachReactivity(group, { minLight: 0.0, maxLight: 0.6, type: 'flora' });

    // Custom Reactivity Method: Retrigger Strobe & Bounce
    group.reactToNote = (note, colorVal, velocity) => {
        // 1. Strobe Effect (via animateFoliage system)
        cap.userData.flashColor = new THREE.Color(colorVal);
        cap.userData.flashIntensity = 1.0 + (velocity * 2.0); // High intensity
        cap.userData.flashDecay = 0.1; // Fast decay for strobe effect

        // 2. Bounce / Retrigger Squish
        // 'velocity' (0-1) determines squash
        const squash = 1.0 - (velocity * 0.3);
        const stretch = 1.0 + (velocity * 0.3);

        group.scale.set(baseScale * stretch, baseScale * squash, baseScale * stretch);

        // Reset scale slowly
        setTimeout(() => {
            if (group) group.scale.setScalar(baseScale);
        }, 80); // Fast snap back
    };

    return group;
}
