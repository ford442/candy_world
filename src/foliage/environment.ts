import * as THREE from 'three';
import { MeshStandardNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import { time, vec3, vec4, positionLocal, length, sin, cos, color as tslColor, attribute, float, uniform, mix, smoothstep, color, positionWorld, normalWorld, floor } from 'three/tsl';

// WGSL-compatible modulo: x - y * floor(x / y)
// Note: Converts inputs to float first since WGSL floor() only works on floats
const modFloat = (x: any, y: any) => {
    const xf = float(x);
    const yf = float(y);
    return xf.sub(yf.mul(xf.div(yf).floor()));
};
import { registerReactiveMaterial, attachReactivity, CandyPresets, uTime, uAudioLow, uAudioHigh, createJuicyRimLight, createSugarSparkle } from './index.ts';
import { uTwilight, uHorizonColor } from './sky.ts';

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
    const baseWaterColor = mix(deepColor, crestColor, normalizedHeight);

    // 🎨 PALETTE: Sunset Pink Blend
    // Mix the water color with the horizon color based on twilight, enhancing the pinkish glow during sunset/sunrise
    const sunsetTint = mix(baseWaterColor, uHorizonColor, uTwilight.mul(0.6));
    const waterColor = sunsetTint;

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
    const { color: hexColor = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 8, 8);

    // Base Gummy Material
    const mat = CandyPresets.Gummy(hexColor, { emissive: hexColor, emissiveIntensity: 0.8 });

    // --- PALETTE: TSL Audio-Reactive Juice ---
    // 1. Audio-Reactive Squash & Stretch (Heartbeat/jelly feel)
    // Pulse with the kick drum
    const squash = smoothstep(0.0, 1.0, uAudioLow).pow(float(2.0)).mul(0.4);
    const scaleY = float(1.0).sub(squash);
    const scaleXZ = float(1.0).add(squash.mul(0.5));

    // 2. Idle Float & Spin
    // Organic floating offset using world position to desync instances
    const phaseX = positionWorld.x.mul(0.5);
    const phaseZ = positionWorld.z.mul(0.5);
    const floatOffset = sin(uTime.mul(2.0).add(phaseX).add(phaseZ)).mul(0.1);

    const animatedPos = vec3(
        positionLocal.x.mul(scaleXZ),
        positionLocal.y.mul(scaleY),
        positionLocal.z.mul(scaleXZ)
    ).add(vec3(0.0, floatOffset, 0.0));
    mat.positionNode = animatedPos;

    // 3. Audio-Reactive Emissive Pulse & Rim Light
    // High frequency triggers bright flashes
    const baseGlowColor = tslColor(hexColor);
    // 🎨 PALETTE: Make flash non-linear so it pops more
    const flashIntensity = uAudioHigh.pow(float(1.5)).mul(2.5);
    const baseEmissive = baseGlowColor.mul(float(0.5).add(flashIntensity));

    // Juicy Rim Light for that "Neon/Bioluminescent" magic feel
    const rimLight = createJuicyRimLight(baseGlowColor, float(1.5), float(3.0), null);

    // 🎨 PALETTE: Add Sugar Sparkle for magical dust effect
    const sparkle = createSugarSparkle(normalWorld, float(25.0), float(0.2), float(2.0));

    mat.emissiveNode = baseEmissive.add(rimLight).add(sparkle);

    registerReactiveMaterial(mat);

    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    // CPU animation replaced by TSL positionNode for better performance and juice
    // orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    orb.userData.type = 'orb';

    const light = new THREE.PointLight(hexColor, 0.5, 4.0);
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

// Deprecated: createKickDrumGeyser has been replaced by KickDrumGeyserBatcher
// for zero-allocation performance at scale. It is removed from here to prevent duplicate implementation.
