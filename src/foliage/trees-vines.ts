import * as THREE from 'three';
import { color as tslColor, float, positionLocal, add } from 'three/tsl';
 // ⚡ OPTIMIZATION: Import Batcher
import { registerReactiveMaterial, pickAnimation, createClayMaterial, sharedGeometries, uAudioLow, createJuicyRimLight, getCachedProceduralMaterial, applyStandardDeformation } from './index.ts';
import { createLeafParticle } from './trees-core.ts';
export { VineSwing } from './vine-swing.ts';
export type { InputState, PlayerObject } from './vine-swing.ts';
export interface VineOptions {
    color?: number;
    length?: number;
}
export interface SwingableVineOptions {
    length?: number;
    color?: number;
}
export interface VineLadderOptions {
    length?: number;
    color?: number;
}
export function createVine(options: VineOptions = {}): THREE.Group {
    const { color = 0x228b22, length = 3 } = options;
    const group = new THREE.Group();
    // ⚡ BOLT + 🎨 PALETTE OPTIMIZATION:
    // Create the material ONCE outside the loop, add TSL Juice, and register it.
    const vineMat = getCachedProceduralMaterial(`vine_${color}`, color, () => {
        const mat = createClayMaterial(color);
        mat.positionNode = applyStandardDeformation(positionLocal);
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        mat.emissiveNode = add(
            mat.emissiveNode ?? tslColor(0x000000),
            createJuicyRimLight(tslColor(color), audioRimIntensity, float(3.0), mat.normalNode)
        );
        return mat;
    });
    registerReactiveMaterial(vineMat);
    for (let i = 0; i < length; i++) {
        // Shared geometry: CylinderLow
        // Shared material: vineMat
        const segment = new THREE.Mesh(sharedGeometries.cylinderLow, vineMat);
        segment.scale.set(0.05, 0.5, 0.05);
        segment.position.y = i * 0.5;
        segment.rotation.z = Math.sin(i * 0.5) * 0.2;
        group.add(segment);
    }
    group.userData.animationType = pickAnimation(['vineSway', 'spiralWave']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}
export function createVineCluster(x: number, z: number): THREE.Group {
    const cluster = new THREE.Group();
    cluster.position.set(x, 0, z);
    for (let i = 0; i < 3; i++) {
        const vine = createVine();
        vine.position.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        cluster.add(vine);
    }
    return cluster;
}
export function createSwingableVine(options: SwingableVineOptions = {}): THREE.Group {
    const { length = 12, color = 0x2e8b57 } = options;
    const group = new THREE.Group();
    const segmentCount = 8;
    const segLen = length / segmentCount;
    const vineMat = getCachedProceduralMaterial(`swingable_vine_${color}`, color, () => {
        const mat = createClayMaterial(color);
        mat.positionNode = applyStandardDeformation(positionLocal);
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        mat.emissiveNode = add(
            mat.emissiveNode ?? tslColor(0x000000),
            createJuicyRimLight(tslColor(color), audioRimIntensity, float(3.0), mat.normalNode)
        );
        return mat;
    });
    for (let i = 0; i < segmentCount; i++) {
        const mat = vineMat;
        const segmentGroup = new THREE.Group();
        segmentGroup.position.y = -i * segLen;
        const mesh = new THREE.Mesh(sharedGeometries.cylinderLow, mat);
        mesh.scale.set(0.15, segLen, 0.15);
        mesh.position.y = -segLen / 2;
        mesh.rotation.z = (Math.random() - 0.5) * 0.1;
        mesh.rotation.x = (Math.random() - 0.5) * 0.1;
        segmentGroup.add(mesh);
        if (Math.random() > 0.4) {
            const leaf = createLeafParticle({ color: 0x32cd32 });
            leaf.position.y = -segLen * 0.5;
            leaf.position.x = 0.1;
            leaf.rotation.z = Math.PI / 4;
            segmentGroup.add(leaf);
        }
        group.add(segmentGroup);
    }
    const hitGeo = new THREE.CylinderGeometry(0.5, 0.5, length, 8);
    hitGeo.translate(0, -length / 2, 0);
    const hitMat = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        wireframe: true,
        visible: false,
    });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.userData.isVineHitbox = true;
    group.add(hitbox);
    group.userData.type = 'vine';
    group.userData.isSwingable = true;
    group.userData.vineLength = length;
    return group;
}
export function createVineLadder(options: VineLadderOptions = {}): THREE.Group {
    const { length = 10, color = 0x2e8b57 } = options;
    const group = new THREE.Group();
    const segmentCount = 10;
    const segLen = length / segmentCount;
    const vineMat = getCachedProceduralMaterial(`vine_ladder_${color}`, color, () => {
        const mat = createClayMaterial(color);
        mat.positionNode = applyStandardDeformation(positionLocal);
        const audioRimIntensity = float(1.0).add(uAudioLow.mul(0.5));
        mat.emissiveNode = add(
            mat.emissiveNode ?? tslColor(0x000000),
            createJuicyRimLight(tslColor(color), audioRimIntensity, float(3.0), mat.normalNode)
        );
        return mat;
    });
    for (let i = 0; i < segmentCount; i++) {
        const segmentGroup = new THREE.Group();
        segmentGroup.position.y = -i * segLen;
        const mesh = new THREE.Mesh(sharedGeometries.cylinderLow, vineMat);
        mesh.scale.set(0.12, segLen, 0.12);
        mesh.position.y = -segLen / 2;
        mesh.rotation.z = (Math.random() - 0.5) * 0.05;
        mesh.rotation.x = (Math.random() - 0.5) * 0.05;
        segmentGroup.add(mesh);
        // Add rungs every other segment for ladder look
        if (i % 2 === 0) {
            const rungGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.6, 6);
            rungGeo.rotateZ(Math.PI / 2);
            const rung = new THREE.Mesh(rungGeo, vineMat);
            rung.position.y = -segLen * 0.5;
            segmentGroup.add(rung);
        }
        // Occasional leaf
        if (Math.random() > 0.5) {
            const leaf = createLeafParticle({ color: 0x32cd32 });
            leaf.position.y = -segLen * 0.5;
            leaf.position.x = 0.12;
            leaf.rotation.z = Math.PI / 4;
            segmentGroup.add(leaf);
        }
        group.add(segmentGroup);
    }
    // Climbable hitbox (invisible)
    const hitGeo = new THREE.CylinderGeometry(0.6, 0.6, length, 8);
    hitGeo.translate(0, -length / 2, 0);
    const hitMat = new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        wireframe: true,
        visible: false,
    });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.userData.isClimbable = true;
    group.add(hitbox);
    group.userData.type = 'vine_ladder';
    group.userData.isClimbable = true;
    group.userData.vineLength = length;
    group.userData.interactionText = '🪜 Climb';
    return group;
}
