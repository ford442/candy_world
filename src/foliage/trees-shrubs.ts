import * as THREE from 'three';
 // Import explicit type for cast
import { createBerryCluster } from './berries.ts';
 // ⚡ OPTIMIZATION: Import Batcher
import { registerReactiveMaterial, attachReactivity, pickAnimation, createClayMaterial, sharedGeometries, createStandardNodeMaterial, getCachedProceduralMaterial } from './index.ts';
import { treeBatcher } from './tree-batcher.ts';
import { enhanceWithFloralJuice } from './trees-core.ts';
const _scratchPhysicsVec1 = new THREE.Vector3();
const _scratchPhysicsVec2 = new THREE.Vector3();
export interface ShrubOptions {
    color?: number;
}
export interface HelixPlantOptions {
    color?: number;
}
export interface BalloonBushOptions {
    color?: number;
}
export function createShrub(options: ShrubOptions = {}): THREE.Group {
    const { color = 0x32cd32 } = options;
    const group = new THREE.Group();
    // Shared geometry: Sphere
    const base = new THREE.Mesh(sharedGeometries.sphere, createClayMaterial(color));
    const size = 1 + Math.random() * 0.5;
    base.scale.setScalar(size);
    base.position.y = 0.5;
    base.castShadow = true;
    group.add(base);
    const flowerMat = getCachedProceduralMaterial(`shrub_flower`, 0xff69b4, () => {
        const mat = createClayMaterial(0xff69b4);
        enhanceWithFloralJuice(mat);
        return mat;
    });
    registerReactiveMaterial(flowerMat);
    const flowerCount = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < flowerCount; i++) {
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
            color: 0xff6600,
            count: 4 + Math.floor(Math.random() * 3),
            baseGlow: 0.25,
            shape: 'sphere',
            size: 0.08,
        });
        berries.position.set((Math.random() - 0.5) * 1.2, 1.2, (Math.random() - 0.5) * 1.2);
        group.add(berries);
        group.userData.berries = berries;
    }
    group.userData.animationType = pickAnimation(['bounce', 'shiver', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    // ⚡ OPTIMIZATION: Register to Batcher
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'shrub');
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };
    return attachReactivity(group);
}
export function createHelixPlant(options: HelixPlantOptions = {}): THREE.Group {
    const { color = 0x00fa9a } = options;
    const group = new THREE.Group();
    // ⚡ OPTIMIZATION: Scratch vector to prevent GC spikes in curve generation if optionalTarget is missing
    const _scratchCurvePoint = new THREE.Vector3();
    class SpiralCurve extends THREE.Curve<THREE.Vector3> {
        scale: number;
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        getPoint(t: number, optionalTarget?: THREE.Vector3): THREE.Vector3 {
            const point = optionalTarget || _scratchCurvePoint;
            const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale;
            const ty = t * 2.0 * this.scale;
            const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale;
            return point.set(tx, ty, tz);
        }
    }
    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
    const mat = getCachedProceduralMaterial(`helix_plant_${color}`, color, () => {
        const m = createClayMaterial(color);
        enhanceWithFloralJuice(m);
        return m;
    });
    registerReactiveMaterial(mat);
    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);
    const tipMat = createStandardNodeMaterial({
        color: 0xffffff,
        emissive: 0xfffacd,
        emissiveIntensity: 0.5,
        roughness: 0.5,
    });
    registerReactiveMaterial(tipMat);
    const tip = new THREE.Mesh(sharedGeometries.sphereLow, tipMat);
    tip.scale.setScalar(0.15);
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);
    group.userData.animationType = pickAnimation(['spring', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    // ⚡ OPTIMIZATION: Register to Batcher
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'helixPlant');
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };
    return attachReactivity(group);
}
export function createBalloonBush(options: BalloonBushOptions = {}): THREE.Group {
    const { color = 0xff4500 } = options;
    const group = new THREE.Group();
    const sphereCount = 5 + Math.floor(Math.random() * 5);
    const mat = getCachedProceduralMaterial(`balloon_bush_${color}`, color, () => {
        const m = createClayMaterial(color);
        enhanceWithFloralJuice(m);
        return m;
    });
    registerReactiveMaterial(mat);
    for (let i = 0; i < sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.4;
        const mesh = new THREE.Mesh(sharedGeometries.sphere, mat);
        mesh.scale.setScalar(r);
        mesh.position.set(
            (Math.random() - 0.5) * 0.8,
            r + Math.random() * 0.8,
            (Math.random() - 0.5) * 0.8
        );
        mesh.castShadow = true;
        group.add(mesh);
    }
    group.userData.animationType = pickAnimation(['bounce', 'accordion', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    // ⚡ OPTIMIZATION: Register to Batcher
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'balloonBush');
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };
    return attachReactivity(group);
}
