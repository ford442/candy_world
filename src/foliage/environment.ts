import * as THREE from 'three';
import { MeshStandardNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import { time, vec3, positionLocal, length, sin, cos, color as tslColor, attribute, float, uniform, mix, smoothstep, color } from 'three/tsl';
import { registerReactiveMaterial, attachReactivity, CandyPresets, uTime, uAudioLow, uAudioHigh, createJuicyRimLight } from './common.ts';
import { uTwilight } from './sky.ts';

export interface FloatingOrbOptions {
    color?: number;
    size?: number;
}

export interface KickDrumGeyserOptions {
    color?: number;
    maxHeight?: number;
}

export function createMelodyLake(width = 200, depth = 200) {
    const geo = new THREE.PlaneGeometry(width, depth, 64, 64);
    geo.rotateX(-Math.PI / 2);

    const mat = new MeshStandardNodeMaterial({
        roughness: 0.1,
        metalness: 0.5,
        transparent: true,
        opacity: 0.8,
    });

    const pos = positionLocal;
    const dist = length(pos.xz);

    // 🎨 PALETTE: Audio-Reactive Waves
    // Bass (uAudioLow) drives the height of the waves, creating a pulsing ocean
    const bassPulse = float(1.0).add(uAudioLow.mul(1.5));

    // Complex, overlapping sine waves for a more natural, fluid look
    const ripplePhase = dist.mul(0.5).sub(uTime.mul(2.0));
    const ripple = sin(ripplePhase).mul(0.2).mul(bassPulse);

    const wavePhaseX = pos.x.mul(0.2).add(uTime);
    const wavePhaseZ = pos.z.mul(0.2).add(uTime.mul(0.8));
    const wave = sin(wavePhaseX).mul(cos(wavePhaseZ)).mul(0.5).mul(bassPulse);

    const totalWaveHeight = ripple.add(wave);

    mat.positionNode = vec3(pos.x, pos.y.add(totalWaveHeight), pos.z);

    // 🎨 PALETTE: Bioluminescent / Neon Depth Colors
    // The crests of the waves glow bright cyan/neon, the troughs are deep blue
    const normalizedHeight = smoothstep(float(-0.5), float(0.8), totalWaveHeight);

    const deepColor = color(0x0A2E3F); // Deep water
    const crestColor = color(0x00FFFF); // Neon Cyan crests

    // Mix color based on wave height
    const waterColor = mix(deepColor, crestColor, normalizedHeight);
    mat.colorNode = waterColor;

    // 🎨 PALETTE: Audio-Reactive Emissive Glow (Highs/Melody)
    // When the melody hits (uAudioHigh), the wave crests sparkle and glow
    const audioGlow = uAudioHigh.mul(normalizedHeight).mul(2.0);

    // Add a juicy rim light that reacts to the music and stands out at night
    const rimLight = createJuicyRimLight(waterColor, float(1.5), float(4.0), null);

    // Combine base glow, audio response, rim light, and boost at night (uTwilight)
    const baseGlow = crestColor.mul(normalizedHeight).mul(0.3);
    const nightBoost = uTwilight.mul(0.5);

    mat.emissiveNode = baseGlow.add(audioGlow).add(rimLight).mul(float(1.0).add(nightBoost));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.userData.type = 'lake';

    return mesh;
}

export function createFloatingOrb(options: FloatingOrbOptions = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 8, 8);
    const mat = CandyPresets.Gummy(color, { emissive: color, emissiveIntensity: 0.8 });
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

export function createFloatingOrbCluster(x: number, z: number) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 5, z);
    for (let i = 0; i < 3; i++) {
        const orb = createFloatingOrb();
        orb.position.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        cluster.add(orb);
    }
    return cluster;
}

export function createKickDrumGeyser(options: KickDrumGeyserOptions = {}) {
    const { color = 0xFF4500, maxHeight = 5.0 } = options;
    const group = new THREE.Group();

    const baseGeo = new THREE.RingGeometry(0.1, 0.4, 8, 1);
    baseGeo.rotateX(-Math.PI / 2);
    const baseMat = CandyPresets.Clay(0x1A0A00, {
        roughness: 0.9,
        emissive: color,
        emissiveIntensity: 0.1
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    group.add(base);

    const coreGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.1, 8);
    coreGeo.translate(0, -0.05, 0);
    const coreMat = CandyPresets.Gummy(color, {
        roughness: 0.3,
        emissive: color,
        emissiveIntensity: 0.8
    });
    registerReactiveMaterial(coreMat);
    const core = new THREE.Mesh(coreGeo, coreMat);
    group.add(core);

    const plumeCount = 50;
    const plumeGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(plumeCount * 3);
    const normals = new Float32Array(plumeCount * 3);
    const velocities = new Float32Array(plumeCount);

    for (let i = 0; i < plumeCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 0.2;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.2;

        // Dummy normal
        normals[i * 3] = 0; normals[i * 3 + 1] = 1; normals[i * 3 + 2] = 0;

        velocities[i] = 0.5 + Math.random() * 0.5;
    }

    plumeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    plumeGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    plumeGeo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 1));

    const uEruptionStrength = uniform(float(0.0));

    const plumeMat = new PointsNodeMaterial({
        color: color,
        size: 0.15,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // ⚡ OPTIMIZATION: TSL Node for Plume Animation
    const velocityAttr = attribute('velocity', 'float');
    const yOffset = uTime.mul(velocityAttr).mul(5.0).mod(float(maxHeight));

    // Add jitter
    const jitterX = sin(uTime.mul(10.0).add(velocityAttr.mul(100.0))).mul(0.1);
    const jitterZ = cos(uTime.mul(12.0).add(velocityAttr.mul(100.0))).mul(0.1);

    const activeMaxH = float(maxHeight).mul(uEruptionStrength);

    // Scale height by eruption strength, and loop within active height
    const finalY = yOffset.mul(uEruptionStrength);

    plumeMat.positionNode = vec3(
        positionLocal.x.add(jitterX).mul(uEruptionStrength),
        finalY,
        positionLocal.z.add(jitterZ).mul(uEruptionStrength)
    );

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
    group.userData.uEruptionStrength = uEruptionStrength;

    return attachReactivity(group);
}
