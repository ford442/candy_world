import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { time, positionLocal, sin, vec3, color, normalView, dot, float, max } from 'three/tsl';
import { uWindSpeed, uWindDirection, createClayMaterial } from './common.js';

let grassMeshes = [];
const dummy = new THREE.Object3D();
const MAX_PER_MESH = 1000;

export function initGrassSystem(scene, count = 5000) {
    grassMeshes = [];
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0);
    // Ensure normals exist for node materials
    geo.computeVertexNormals();

    const mat = new MeshStandardNodeMaterial({
        color: 0x7CFC00,
        roughness: 0.8,
        metalness: 0.0
    });

    const windTime = time.mul(uWindSpeed.max(0.5));
    const swayPhase = positionLocal.x.add(positionLocal.z).add(windTime);
    const swayAmt = positionLocal.y.mul(0.3).mul(sin(swayPhase));

    const swayX = swayAmt.mul(uWindDirection.x);
    const swayZ = swayAmt.mul(uWindDirection.z);

    mat.positionNode = positionLocal.add(vec3(swayX, 0, swayZ));

    // Inline rim-light node logic (safer than calling addRimLight on non-node materials)
    const NdotV = max(0.0, dot(normalView, vec3(0, 0, 1)));
    const rimFactor = float(1.0).sub(NdotV).pow(3.0).mul(0.6);
    const baseColorNode = color(0x7CFC00);
    const rimColorNode = color(0xAAFFAA);
    mat.colorNode = baseColorNode.add(rimColorNode.mul(rimFactor));

    const meshCount = Math.ceil(count / MAX_PER_MESH);

    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.receiveShadow = true;
        scene.add(mesh);
        grassMeshes.push(mesh);
    }

    return grassMeshes;
}

export function addGrassInstance(x, y, z) {
    const mesh = grassMeshes.find(m => m.count < m.instanceMatrix.count);
    if (!mesh) return;

    const index = mesh.count;

    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);

    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

export function createGrass(options = {}) {
    const { color = 0x7CFC00, shape = 'tall' } = options;
    const material = createClayMaterial(color);
    let geo;
    if (shape === 'tall') {
        const height = 0.5 + Math.random();
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
        geo.translate(0, height / 2, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > height * 0.5) {
                const bendFactor = (y - height * 0.5) / (height * 0.5);
                pos.setX(i, pos.getX(i) + bendFactor * 0.1);
            }
        }
    } else if (shape === 'bushy') {
        const height = 0.2 + Math.random() * 0.3;
        geo = new THREE.CylinderGeometry(0.1, 0.05, height, 8);
        geo.translate(0, height / 2, 0);
    }
    geo.computeVertexNormals();

    const blade = new THREE.Mesh(geo, material);
    blade.castShadow = true;
    blade.userData.type = 'grass';
    blade.userData.animationType = shape === 'tall' ? 'sway' : 'shiver';
    blade.userData.animationOffset = Math.random() * 10;
    return blade;
}
