import { uWindStrength } from '../systems/wind-uniforms.ts';
import { createBerryCluster } from './berries.ts';
import * as THREE from 'three';
import { color as tslColor, float, sin, positionLocal, add , time, positionWorld, vec3} from 'three/tsl';
 // Import explicit type for cast
 // ⚡ OPTIMIZATION: Import Batcher
import { registerReactiveMaterial, attachReactivity, createClayMaterial, createGradientMaterial, sharedGeometries, uAudioLow, createJuicyRimLight, getCachedProceduralMaterial , calculatePlayerPush} from './index.ts';
import { treeBatcher } from './tree-batcher.ts';
const _scratchPhysicsVec1 = new THREE.Vector3();
const _scratchPhysicsVec2 = new THREE.Vector3();
export interface TreeOptions {
    color?: number;
}
export interface LeafOptions {
    color?: number;
}
export function enhanceWithFloralJuice(material: any) {
    if (material.isNodeMaterial) {
        // 1. Audio Pulse (Squash/Stretch on Beat)
        const pulse = float(1.0).add(uAudioLow.mul(0.3));
        // 2. Wind Flutter (High Frequency Shiver)
        const flutterFreq = float(15.0);
        const flutterAmp = float(0.05).mul(uWindStrength.add(0.5));
        const flutter = sin(time.mul(flutterFreq).add(positionWorld.x).add(positionWorld.z)).mul(
            flutterAmp
        );
        let newPos = positionLocal.mul(pulse).add(vec3(flutter, flutter, flutter));
        // 3. Player Interaction (Push Away)
        const pushOffset = calculatePlayerPush(newPos);
        newPos = newPos.add(pushOffset);
        material.positionNode = newPos;
        // 4. Juicy Rim Light (Audio-reactive edge glow)
        // Memory explicitly notes: To apply createJuicyRimLight to non-instanced Three.js meshes without crashing WebGPU, construct a standard TSL color node (e.g., tslColor(colorHex)) and pass it as the baseColor argument instead of an instanced attribute.
        const rimLight = createJuicyRimLight(tslColor(0xffffff), float(1.5), float(3.0), null);
        material.emissiveNode = add(material.emissiveNode ?? tslColor(0x000000), rimLight);
    }
    return material;
}
// @refactor {target: "ts", reason: "complex-config", note: "Factory functions prone to undefined option bugs"}
export function createFloweringTree(options: TreeOptions = {}): THREE.Group {
    const { color = 0xff69b4 } = options;
    const group = new THREE.Group();
    const trunkH = 3 + Math.random() * 2;
    // Shared geometry: Cylinder
    const trunkMat = createGradientMaterial(0xa0724b, 0x6b4226, 0.8);
    const trunk = new THREE.Mesh(sharedGeometries.cylinder, trunkMat);
    trunk.scale.set(0.4, trunkH, 0.4);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);
    const bloomMat = getCachedProceduralMaterial(`flowering_tree_bloom_${color}`, color, () => {
        const mat = createClayMaterial(color);
        enhanceWithFloralJuice(mat);
        return mat;
    });
    registerReactiveMaterial(bloomMat);
    const bloomCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bloomCount; i++) {
        const cluster = new THREE.Group();
        const subBlooms = 2 + Math.floor(Math.random() * 2);
        for (let j = 0; j < subBlooms; j++) {
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
            color: 0xff00aa,
            count: 6 + Math.floor(Math.random() * 4),
            baseGlow: 0.3,
            shape: 'pear',
            size: 0.1,
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
    // ⚡ OPTIMIZATION: Register to Batcher on Placement
    group.userData.onPlacement = () => {
        treeBatcher.register(group, 'floweringTree');
        group.userData.isBatched = true;
        group.userData.onPlacement = null;
    };
    return attachReactivity(group);
}
export function createLeafParticle(options: LeafOptions = {}): THREE.Mesh {
    const { color = 0x00ff00 } = options;
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
