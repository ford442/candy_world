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
import { createLeafParticle } from './trees-core.ts';

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

export interface InputState {
    forward: boolean;
    backward: boolean;
}

export interface PlayerObject extends THREE.Object3D {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
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

export class VineSwing {
    vine: THREE.Object3D;
    anchorPoint: THREE.Vector3;
    length: number;
    isPlayerAttached: boolean;
    swingAngle: number;
    swingAngularVel: number;
    swingPlane: THREE.Vector3;
    rotationAxis: THREE.Vector3;
    defaultDown: THREE.Vector3;

    constructor(vineMesh: THREE.Object3D, length = 8) {
        this.vine = vineMesh;
        this.anchorPoint = vineMesh.position.clone();
        this.length = length;
        this.isPlayerAttached = false;
        this.swingAngle = 0;
        this.swingAngularVel = 0;
        this.swingPlane = new THREE.Vector3(1, 0, 0);
        this.rotationAxis = new THREE.Vector3(0, 0, 1);
        this.defaultDown = new THREE.Vector3(0, -1, 0);
    }

    update(player: PlayerObject, delta: number, inputState: InputState | null): void {
        const gravity = 20.0;
        const damping = 0.99;

        const angularAccel = (-gravity / this.length) * Math.sin(this.swingAngle);
        this.swingAngularVel += angularAccel * delta;
        this.swingAngularVel *= damping;

        if (this.isPlayerAttached && inputState) {
            const pumpForce = 3.0;

            if (inputState.forward) {
                if (Math.abs(this.swingAngularVel) > 0.1) {
                    this.swingAngularVel += Math.sign(this.swingAngularVel) * pumpForce * delta;
                } else {
                    this.swingAngularVel += pumpForce * delta;
                }
            } else if (inputState.backward) {
                this.swingAngularVel -= Math.sign(this.swingAngularVel) * pumpForce * delta;
            }
        }

        this.swingAngle += this.swingAngularVel * delta;

        const maxAngle = Math.PI * 0.45;
        if (this.swingAngle > maxAngle) {
            this.swingAngle = maxAngle;
            this.swingAngularVel *= -0.5;
        } else if (this.swingAngle < -maxAngle) {
            this.swingAngle = -maxAngle;
            this.swingAngularVel *= -0.5;
        }

        const dy = -Math.cos(this.swingAngle) * this.length;
        const dh = Math.sin(this.swingAngle) * this.length;

        const targetPos = _scratchPhysicsVec1.copy(this.anchorPoint);
        targetPos.y += dy;
        targetPos.addScaledVector(this.swingPlane, dh);

        if (this.isPlayerAttached) {
            player.position.copy(targetPos);
        }

        const dir = _scratchPhysicsVec2.subVectors(targetPos, this.anchorPoint).normalize();
        this.vine.quaternion.setFromUnitVectors(this.defaultDown, dir);
    }

    detach(player: PlayerObject): number {
        this.isPlayerAttached = false;

        const impulse = calcVineDetachImpulse(
            this.length,
            this.swingAngle,
            this.swingAngularVel,
            this.swingPlane.x,
            this.swingPlane.z
        );

        player.velocity.x = impulse.vx;
        player.velocity.y = impulse.vy;
        player.velocity.z = impulse.vz;

        return Date.now();
    }
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
