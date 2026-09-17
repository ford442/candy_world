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

export interface AccordionPalmOptions {
    color?: number;
}

export function createAccordionPalm(options: AccordionPalmOptions = {}): THREE.Group {
    const { color = 0xffd700 } = options;
    const group = new THREE.Group();

    const trunkHeight = 3.0;
    const segments = 10;
    const trunkGroup = new THREE.Group();

    const pleatGeo = new THREE.TorusGeometry(0.3, 0.15, 8, 16);

    // 🎨 PALETTE: Add TSL Juice (Wind Sway and Rim Light) to the Accordion trunk pleats
    const pleatMatBase = getCachedProceduralMaterial(`accordion_palm_pleat_base`, 0x8b4513, () => {
        const mat = createClayMaterial(0x8b4513) as MeshStandardNodeMaterial;
        mat.positionNode = applyStandardDeformation(positionLocal);
        const rim = createJuicyRimLight(
            tslColor(0x8b4513),
            float(1.0).add(uAudioLow.mul(0.5)),
            float(3.0),
            mat.normalNode || normalLocal
        );
        mat.emissiveNode = add(mat.emissiveNode ?? tslColor(0x000000), rim);
        return mat;
    });
    registerReactiveMaterial(pleatMatBase);

    const pleatMatAlt = getCachedProceduralMaterial(`accordion_palm_pleat_alt`, 0xa0522d, () => {
        const mat = createClayMaterial(0xa0522d) as MeshStandardNodeMaterial;
        mat.positionNode = applyStandardDeformation(positionLocal);
        const rim = createJuicyRimLight(
            tslColor(0xa0522d),
            float(1.0).add(uAudioLow.mul(0.5)),
            float(3.0),
            mat.normalNode || normalLocal
        );
        mat.emissiveNode = add(mat.emissiveNode ?? tslColor(0x000000), rim);
        return mat;
    });
    registerReactiveMaterial(pleatMatAlt);

    for (let i = 0; i < segments; i++) {
        const activeMat = i % 2 === 0 ? pleatMatAlt : pleatMatBase;
        const pleat = new THREE.Mesh(pleatGeo, activeMat);
        pleat.rotation.x = Math.PI / 2;
        pleat.position.y = i * (trunkHeight / segments);
        trunkGroup.add(pleat);
    }
    group.add(trunkGroup);

    const leafCount = 6;
    const leafGeo = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 8);
    leafGeo.translate(0, 0.75, 0);

    // 🎨 PALETTE: Add TSL Juice (Wind Sway and Audio Reactive Rim Light) to the Palm Leaves
    const leafMat = getCachedProceduralMaterial(`accordion_palm_leaf_${color}`, color, () => {
        const mat = createClayMaterial(color) as MeshStandardNodeMaterial;
        mat.positionNode = applyStandardDeformation(positionLocal);
        const rim = createJuicyRimLight(
            tslColor(color),
            float(1.5).add(uAudioHigh.mul(2.0)),
            float(3.0),
            mat.normalNode || normalLocal
        );
        mat.emissiveNode = add(mat.emissiveNode ?? tslColor(0x000000), rim);
        return mat;
    });
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
