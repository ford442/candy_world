import * as THREE from 'three';
import { foliageMaterials, registerReactiveMaterial, attachReactivity, pickAnimation, createClayMaterial, createGradientMaterial, sharedGeometries } from './common.js';
import { color as tslColor, mix, float } from 'three/tsl';
import { uTwilight } from './sky.js';
import { createBerryCluster } from './berries.js';
import { FoliageObject } from './types.js';

// Configuration interfaces for tree creation options
export interface TreeOptions {
    color?: number;
}

export interface ShrubOptions {
    color?: number;
}

export interface VineOptions {
    color?: number;
    length?: number;
}

export interface LeafOptions {
    color?: number;
}

export interface WisteriaOptions {
    color?: number;
    strands?: number;
}

export interface BubbleWillowOptions {
    color?: number;
}

export interface HelixPlantOptions {
    color?: number;
}

export interface BalloonBushOptions {
    color?: number;
}

export interface AccordionPalmOptions {
    color?: number;
}

export interface FiberOpticWillowOptions {
    color?: number;
}

export interface SwingableVineOptions {
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

// @refactor {target: "ts", reason: "complex-config", note: "Factory functions prone to undefined option bugs"}
export function createFloweringTree(options: TreeOptions = {}): THREE.Group {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const trunkH = 3 + Math.random() * 2;
    // Shared geometry: Cylinder
    const trunkMat = createGradientMaterial(0xA0724B, 0x6B4226, 0.8);
    const trunk = new THREE.Mesh(sharedGeometries.cylinder, trunkMat);
    trunk.scale.set(0.4, trunkH, 0.4); // Average of 0.3 and 0.5
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    const bloomCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bloomCount; i++) {
        const cluster = new THREE.Group();
        const subBlooms = 2 + Math.floor(Math.random() * 2);

        for (let j = 0; j < subBlooms; j++) {
            // Shared geometry: Sphere
            const bloom = new THREE.Mesh(sharedGeometries.sphere, bloomMat);
            const size = 0.4 + Math.random() * 0.3;
            bloom.scale.setScalar(size);
            bloom.position.set(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            cluster.add(bloom);
        }

        cluster.position.set(
            (Math.random() - 0.5) * 2,
            trunkH + Math.random() * 1.5,
            (Math.random() - 0.5) * 2
        );
        group.add(cluster);
    }

    if (Math.random() > 0.4) {
        const berries = createBerryCluster({
            color: 0xFF00AA,
            count: 6 + Math.floor(Math.random() * 4),
            baseGlow: 0.3,
            shape: 'pear',
            size: 0.1
        });
        berries.position.set(
            (Math.random() - 0.5) * 1.5,
            trunkH + 1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(berries);
        group.userData.berries = berries;
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
    return attachReactivity(group) as FoliageObject;
}

export function createShrub(options: ShrubOptions = {}): THREE.Group {
    const { color = 0x32CD32 } = options;
    const group = new THREE.Group();

    // Shared geometry: Sphere
    const base = new THREE.Mesh(sharedGeometries.sphere, createClayMaterial(color));
    const size = 1 + Math.random() * 0.5;
    base.scale.setScalar(size);
    base.position.y = 0.5; // Keeping original position, though it might clip ground slightly with generic sphere center at 0
    base.castShadow = true;
    group.add(base);

    const flowerMat = createClayMaterial(0xFF69B4);
    registerReactiveMaterial(flowerMat);

    const flowerCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < flowerCount; i++) {
        // Shared geometry: SphereLow
        const flower = new THREE.Mesh(sharedGeometries.sphereLow, flowerMat);
        flower.scale.setScalar(0.2);
        flower.position.set(
            (Math.random() - 0.5) * 1.5,
            1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(flower);
    }

    if (Math.random() > 0.5) {
        const berries = createBerryCluster({
            color: 0xFF6600,
            count: 4 + Math.floor(Math.random() * 3),
            baseGlow: 0.25,
            shape: 'sphere',
            size: 0.08
        });
        berries.position.set(
            (Math.random() - 0.5) * 1.2,
            1.2,
            (Math.random() - 0.5) * 1.2
        );
        group.add(berries);
        group.userData.berries = berries;
    }

    group.userData.animationType = pickAnimation(['bounce', 'shiver', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return attachReactivity(group);
}

export function createVine(options: VineOptions = {}): THREE.Group {
    const { color = 0x228B22, length = 3 } = options;
    const group = new THREE.Group();

    for (let i = 0; i < length; i++) {
        // Shared geometry: CylinderLow
        const segment = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(color));
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

export function createLeafParticle(options: LeafOptions = {}): THREE.Mesh {
    const { color = 0x00ff00 } = options;
    // Keeping unique shape geometry for leaf
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

export function createWisteriaCluster(options: WisteriaOptions = {}): THREE.Group {
    const { color = 0xCFA0FF, strands = 4 } = options;
    const group = new THREE.Group();

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    for (let s = 0; s < strands; s++) {
        const strand = new THREE.Group();
        const length = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < length; i++) {
            // Shared geometry: CylinderLow
            const seg = new THREE.Mesh(sharedGeometries.cylinderLow, createClayMaterial(0x2E8B57));
            seg.scale.set(0.03, 0.4, 0.03);
            seg.position.y = -i * 0.35;
            seg.rotation.z = Math.sin(i * 0.5) * 0.15;
            strand.add(seg);

            if (i > 0 && Math.random() > 0.6) {
                // Shared geometry: SphereLow
                const b = new THREE.Mesh(sharedGeometries.sphereLow, bloomMat);
                b.scale.setScalar(0.05);
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

    group.userData.animationType = pickAnimation(['vineSway', 'spiralWave']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

export function createBubbleWillow(options: BubbleWillowOptions = {}): THREE.Group {
    const { color = 0x8A2BE2 } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    // Shared geometry: Cylinder
    const trunk = new THREE.Mesh(sharedGeometries.cylinder, createClayMaterial(0x5D4037));
    trunk.scale.set(0.5, trunkH, 0.5);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 4 + Math.floor(Math.random() * 2);
    const branchMat = createClayMaterial(color);
    registerReactiveMaterial(branchMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const length = 1.5 + Math.random();
        // Note: Using unique CapsuleGeometry here instead of shared geometry
        // because capsule proportions (radius vs length) vary per branch.
        // Scaling a shared capsule distorts the hemispherical ends, 
        // whereas we need uniform radius with variable length.
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
    return attachReactivity(group) as FoliageObject;
}

export function createHelixPlant(options: HelixPlantOptions = {}): THREE.Group {
    const { color = 0x00FA9A } = options;
    const group = new THREE.Group();

    class SpiralCurve extends THREE.Curve<THREE.Vector3> {
        scale: number;
        
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        
        // ⚡ OPTIMIZATION: Use optional target or create new only if needed
        getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
            const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale;
            const ty = t * 2.0 * this.scale;
            const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale;
            return optionalTarget.set(tx, ty, tz);
        }
    }

    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    const tipMat = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5
    });
    registerReactiveMaterial(tipMat);

    // Shared geometry: SphereLow
    const tip = new THREE.Mesh(sharedGeometries.sphereLow, tipMat);
    tip.scale.setScalar(0.15);
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);

    group.userData.animationType = pickAnimation(['spring', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return attachReactivity(group);
}

export function createBalloonBush(options: BalloonBushOptions = {}): THREE.Group {
    const { color = 0xFF4500 } = options;
    const group = new THREE.Group();

    const sphereCount = 5 + Math.floor(Math.random() * 5);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    for (let i = 0; i < sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.4;
        // Shared geometry: Sphere
        const mesh = new THREE.Mesh(sharedGeometries.sphere, mat);
        mesh.scale.setScalar(r);

        mesh.position.set(
            (Math.random() - 0.5) * 0.8,
            r + (Math.random()) * 0.8,
            (Math.random() - 0.5) * 0.8
        );
        mesh.castShadow = true;
        group.add(mesh);
    }

    group.userData.animationType = pickAnimation(['bounce', 'accordion', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return attachReactivity(group);
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

export function createAccordionPalm(options: AccordionPalmOptions = {}): THREE.Group {
    const { color = 0xFFD700 } = options;
    const group = new THREE.Group();

    const trunkHeight = 3.0;
    const segments = 10;
    const trunkGroup = new THREE.Group();

    const pleatGeo = new THREE.TorusGeometry(0.3, 0.15, 8, 16);
    const pleatMat = createClayMaterial(0x8B4513);

    for (let i = 0; i < segments; i++) {
        const pleat = new THREE.Mesh(pleatGeo, pleatMat);
        pleat.rotation.x = Math.PI / 2;
        pleat.position.y = i * (trunkHeight / segments);
        if (i % 2 === 0) {
            pleat.material = createClayMaterial(0xA0522D);
        }
        trunkGroup.add(pleat);
    }
    group.add(trunkGroup);

    const leafCount = 6;
    const leafGeo = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 8);
    leafGeo.translate(0, 0.75, 0);
    const leafMat = createClayMaterial(color);
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

export function createFiberOpticWillow(options: FiberOpticWillowOptions = {}): THREE.Group {
    const { color = 0xFFFFFF } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    // Shared geometry: Cylinder
    const trunk = new THREE.Mesh(sharedGeometries.cylinder, createClayMaterial(0x222222));
    trunk.scale.set(0.3, trunkH, 0.3);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 8;
    const cableMat = foliageMaterials.opticCable;
    const tipMat = foliageMaterials.opticTip.clone();

    // Twilight Boost for Fiber Optics
    const baseEmissive = tslColor(color).mul(0.8);
    const twilightBoost = baseEmissive.mul(uTwilight).mul(2.0); // Boost significantly at night
    tipMat.emissiveNode = baseEmissive.add(twilightBoost);

    registerReactiveMaterial(tipMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const len = 1.5 + Math.random();
        
        // Create whip container that rotates around branch attachment point
        const whip = new THREE.Group();
        whip.rotation.z = Math.PI / 4;

        // Cable: centered vertically within whip, extends downward
        const cable = new THREE.Mesh(sharedGeometries.cylinderLow, cableMat);
        cable.scale.set(0.02, len, 0.02);
        cable.position.set(0, -len/2, 0); // Center of cable at -len/2 from whip origin
        whip.add(cable);

        // Tip: positioned at end of cable
        const tip = new THREE.Mesh(sharedGeometries.sphereLow, tipMat);
        tip.scale.setScalar(0.08);
        tip.position.set(0, -len, 0); // End of cable
        whip.add(tip);

        branchGroup.add(whip);
        group.add(branchGroup);
    }

    group.userData.animationType = 'fiberWhip';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'willow';

    return attachReactivity(group);
}

// ⚡ OPTIMIZATION: Module-level scratch vectors for physics
const _scratchPhysicsVec1 = new THREE.Vector3();
const _scratchPhysicsVec2 = new THREE.Vector3();

// --- Vine Swing Physics ---
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
            // "Pumping" the swing
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

        // Clamp swing angle
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

        // Use scratch variable for target calculation
        const targetPos = _scratchPhysicsVec1.copy(this.anchorPoint);
        targetPos.y += dy;
        targetPos.addScaledVector(this.swingPlane, dh);

        if (this.isPlayerAttached) {
            player.position.copy(targetPos);
        }

        const dir = _scratchPhysicsVec2.subVectors(targetPos, this.anchorPoint).normalize();
        this.vine.quaternion.setFromUnitVectors(this.defaultDown, dir);
    }

    attach(player: PlayerObject, playerVelocity: THREE.Vector3): void {
        this.isPlayerAttached = true;

        const horizVel = _scratchPhysicsVec1.set(playerVelocity.x, 0, playerVelocity.z);
        if (horizVel.lengthSq() > 1.0) {
            this.swingPlane.copy(horizVel.normalize());
        } else {
            const toPlayer = _scratchPhysicsVec2.subVectors(player.position, this.anchorPoint);
            toPlayer.y = 0;
            if (toPlayer.lengthSq() > 0.1) {
                this.swingPlane.copy(toPlayer.normalize());
            }
        }

        const toPlayer = _scratchPhysicsVec2.subVectors(player.position, this.anchorPoint);
        const dy = toPlayer.y;
        const dh = toPlayer.dot(this.swingPlane);
        this.swingAngle = Math.atan2(dh, -dy);

        const cosA = Math.cos(this.swingAngle);
        const sinA = Math.sin(this.swingAngle);

        const vH = horizVel.length() * (playerVelocity.dot(this.swingPlane) > 0 ? 1 : -1);
        const vY = playerVelocity.y;

        const vTangential = vH * cosA + vY * sinA;

        this.swingAngularVel = vTangential / this.length;
    }

    detach(player: PlayerObject): number {
        this.isPlayerAttached = false;

        const tangentVel = this.swingAngularVel * this.length;
        const cosA = Math.cos(this.swingAngle);
        const sinA = Math.sin(this.swingAngle);

        const vH = tangentVel * cosA;
        const vY = tangentVel * sinA;

        player.velocity.x = this.swingPlane.x * vH;
        player.velocity.z = this.swingPlane.z * vH;
        player.velocity.y = vY;

        player.velocity.y += 5.0;

        return Date.now();
    }
}

export function createSwingableVine(options: SwingableVineOptions = {}): THREE.Group {
    const { length = 12, color = 0x2E8B57 } = options;
    const group = new THREE.Group();

    const segmentCount = 8;
    const segLen = length / segmentCount;

    for (let i = 0; i < segmentCount; i++) {
        // Shared geometry: CylinderLow
        const mat = createClayMaterial(color);

        // Container to avoid scaling distortion of children
        const segmentGroup = new THREE.Group();
        segmentGroup.position.y = -i * segLen; // Position the segment

        // The mesh itself (scaled)
        const mesh = new THREE.Mesh(sharedGeometries.cylinderLow, mat);
        mesh.scale.set(0.15, segLen, 0.15); // radius 0.15
        mesh.position.y = -segLen/2; // Center of segment relative to group top
        mesh.rotation.z = (Math.random() - 0.5) * 0.1;
        mesh.rotation.x = (Math.random() - 0.5) * 0.1;

        segmentGroup.add(mesh);

        if (Math.random() > 0.4) {
             const leaf = createLeafParticle({ color: 0x32CD32 });
             // Position relative to segmentGroup top
             leaf.position.y = -segLen * 0.5;
             leaf.position.x = 0.1;
             leaf.rotation.z = Math.PI / 4;
             // Add leaf to segmentGroup (unscaled) instead of mesh (scaled)
             segmentGroup.add(leaf);
        }

        group.add(segmentGroup);
    }

    const hitGeo = new THREE.CylinderGeometry(0.5, 0.5, length, 8);
    hitGeo.translate(0, -length/2, 0);
    const hitMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, wireframe: true, visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.userData.isVineHitbox = true;
    group.add(hitbox);

    group.userData.type = 'vine';
    group.userData.isSwingable = true;
    group.userData.vineLength = length;

    return group;
}
