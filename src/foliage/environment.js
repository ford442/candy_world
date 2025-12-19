import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { time, vec3, positionLocal, length, sin, cos } from 'three/tsl';
import { registerReactiveMaterial, attachReactivity } from './common.js';

export function createMelodyLake(width = 200, depth = 200) {
    const geo = new THREE.PlaneGeometry(width, depth, 64, 64);
    geo.rotateX(-Math.PI / 2);

    const mat = new MeshStandardNodeMaterial({
        color: 0x40E0D0,
        roughness: 0.1,
        metalness: 0.5,
        transparent: true,
        opacity: 0.8,
    });

    const pos = positionLocal;
    const dist = length(pos.xz);

    const ripple = sin(dist.mul(0.5).sub(time.mul(2.0))).mul(0.5);
    const wave = sin(pos.x.mul(0.2).add(time)).mul(cos(pos.z.mul(0.2).add(time))).mul(0.5);

    mat.positionNode = vec3(pos.x, pos.y.add(ripple).add(wave), pos.z);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.type = 'lake';

    return mesh;
}

export function createFloatingOrb(options = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    registerReactiveMaterial(mat);

    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    orb.userData.type = 'orb';

    const light = new THREE.PointLight(color, 0.5, 4.0);
    orb.add(light);

    return attachReactivity(orb);
}

export function createFloatingOrbCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 5, z);
    for (let i = 0; i < 3; i++) {
        const orb = createFloatingOrb();
        orb.position.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        cluster.add(orb);
    }
    return cluster;
}

export function createKickDrumGeyser(options = {}) {
    const { color = 0xFF4500, maxHeight = 5.0 } = options;
    const group = new THREE.Group();

    const baseGeo = new THREE.RingGeometry(0.1, 0.4, 8, 1);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
        color: 0x1A0A00,
        roughness: 0.9,
        emissive: color,
        emissiveIntensity: 0.1
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    group.add(base);

    const coreGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.1, 8);
    coreGeo.translate(0, -0.05, 0);
    const coreMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8,
        roughness: 0.3
    });
    registerReactiveMaterial(coreMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const plumeCount = 50;
    const plumeGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(plumeCount * 3);
    const velocities = new Float32Array(plumeCount);

    for (let i = 0; i < plumeCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 0.2;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        velocities[i] = 0.5 + Math.random() * 0.5;
    }

    plumeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    plumeGeo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

    const plumeMat = new THREE.PointsMaterial({
        color: color,
        size: 0.15,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const plume = new THREE.Points(plumeGeo, plumeMat);
    plume.visible = false;
    group.add(plume);

    const light = new THREE.PointLight(color, 0, 5.0);
    light.position.y = 1;
    group.add(light);

    group.userData.animationType = 'geyserErupt';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'geyser';
    group.userData.plume = plume;
    group.userData.plumeLight = light;
    group.userData.coreMaterial = coreMat;
    group.userData.maxHeight = maxHeight;
    group.userData.eruptionStrength = 0;

    return attachReactivity(group);
}
