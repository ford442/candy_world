import * as THREE from 'three';
import {
    color as tslColor,
    mix,
    float,
    sin,
    cos,
    vec3,
    positionLocal,
    positionWorld,
    time,
    normalWorld,
    normalLocal,
    add,
} from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu'; // Import explicit type for cast
import { calcVineDetachImpulse } from '../utils/wasm-foliage-interact.ts';
import { createBerryCluster } from './berries.ts';
import { gemFruitBatcher } from './gem-fruit-batcher.ts'; // ⚡ OPTIMIZATION: Import Batcher
import {
    foliageMaterials,
    registerReactiveMaterial,
    attachReactivity,
    pickAnimation,
    createClayMaterial,
    createGradientMaterial,
    sharedGeometries,
    uAudioLow,
    uAudioHigh,
    uWindSpeed,
    uWindStrength,
    calculatePlayerPush,
    createStandardNodeMaterial,
    createJuicyRimLight,
    getCachedProceduralMaterial,
    calculateWindSway,
    applyPlayerInteraction,
    applyStandardDeformation,
} from './index.ts';
import { uTwilight } from './sky.ts';
import { treeBatcher } from './tree-batcher.ts';
import { FoliageObject } from './types.ts';

const _scratchPhysicsVec1 = new THREE.Vector3();
const _scratchPhysicsVec2 = new THREE.Vector3();

import { enhanceWithFloralJuice } from './trees-core.ts';

export interface BubbleWillowOptions {
    color?: number;
}

export interface FiberOpticWillowOptions {
    color?: number;
}

export function createBubbleWillow(options: BubbleWillowOptions = {}): THREE.Group {
    const { color = 0x8a2be2 } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    const trunk = new THREE.Mesh(
        sharedGeometries.cylinder,
        createGradientMaterial(0x5d4037, 0x4a3025, 0.9)
    );
    trunk.scale.set(0.5, trunkH, 0.5);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 4 + Math.floor(Math.random() * 2);
    const branchMat = getCachedProceduralMaterial(`bubble_willow_branch_${color}`, color, () => {
        const mat = createClayMaterial(color);
        enhanceWithFloralJuice(mat);
        return mat;
    });
    registerReactiveMaterial(branchMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const length = 1.5 + Math.random();
        const capsuleGeo = new THREE.CapsuleGeometry(0.2, length, 8, 16);
        const capsuleMesh = new THREE.Mesh(capsuleGeo, branchMat);

        capsuleMesh.position.set(0.5, -length / 2, 0);
        capsuleMesh.rotation.z = -Math.PI / 6;

        branchGroup.add(capsuleMesh);
        group.add(branchGroup);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';

    // ⚡ OPTIMIZATION: Register to Batcher
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'bubbleWillow');
        if (group.userData.attachGemFruits) {
            group.userData.gemRefs = gemFruitBatcher.attachToTree(group, {
                height: trunkH,
                gemCount: 5 + Math.floor(Math.random() * 3),
            }).refs;
        }
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };

    return attachReactivity(group);
}

export function createFiberOpticWillow(options: FiberOpticWillowOptions = {}): THREE.Group {
    const { color = 0xffffff } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    const trunk = new THREE.Mesh(
        sharedGeometries.cylinder,
        createGradientMaterial(0x222222, 0x111111, 0.9)
    );
    trunk.scale.set(0.3, trunkH, 0.3);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 8;

    const cableMat = getCachedProceduralMaterial('optic_cable_willow', 0x111111, () => {
        const m = createClayMaterial(0x111111);
        m.roughness = 0.4;
        m.positionNode = applyStandardDeformation(positionLocal);
        m.emissiveNode = add(
            m.emissiveNode ?? tslColor(0x000000),
            createJuicyRimLight(
                tslColor(0x222222),
                float(1.0).add(uAudioLow.mul(0.5)),
                float(3.0),
                normalLocal
            )
        );
        return m;
    });
    registerReactiveMaterial(cableMat);

    const tipMat = getCachedProceduralMaterial(`optic_tip_willow_${color}`, color, () => {
        const m = createStandardNodeMaterial({ color: 0xffffff, roughness: 0.2 });
        const baseEmissive = tslColor(color).mul(0.8);
        const twilightBoost = baseEmissive.mul(uTwilight).mul(2.0);
        const rimLight = createJuicyRimLight(
            tslColor(color),
            float(2.0).add(uAudioHigh.mul(2.0)),
            float(2.0),
            normalLocal
        );
        m.emissiveNode = baseEmissive.add(twilightBoost).add(rimLight);
        m.positionNode = applyStandardDeformation(positionLocal);
        return m;
    });
    registerReactiveMaterial(tipMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const len = 1.5 + Math.random();

        const whip = new THREE.Group();
        whip.rotation.z = Math.PI / 4;

        const cable = new THREE.Mesh(sharedGeometries.cylinderLow, cableMat);
        cable.scale.set(0.02, len, 0.02);
        cable.position.set(0, -len / 2, 0);
        whip.add(cable);

        const tip = new THREE.Mesh(sharedGeometries.sphereLow, tipMat);
        tip.scale.setScalar(0.08);
        tip.position.set(0, -len, 0);
        whip.add(tip);

        branchGroup.add(whip);
        group.add(branchGroup);
    }

    group.userData.animationType = 'fiberWhip';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'willow';

    return attachReactivity(group);
}
