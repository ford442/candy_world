// src/foliage/clouds.js

import * as THREE from 'three';
import { color, uniform, mix, vec3, positionLocal, normalLocal, mx_noise_float, float, normalize, positionWorld, normalWorld, cameraPosition, dot, abs, sin, pow } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uTime, createRimLight, uAudioLow } from './common.ts';

// --- Global Uniforms (Driven by WeatherSystem) ---
// These are true TSL uniforms now
export const uCloudRainbowIntensity = uniform(0.0);
export const uCloudLightningStrength = uniform(0.0);
export const uCloudLightningColor = uniform(color(0xFFFFFF));

// --- Configuration ---
const puffGeometry = new THREE.IcosahedronGeometry(1, 1);

// Optimization: Shared scratch variables
const _scratchVec3 = new THREE.Vector3();
const _scratchObject3D = new THREE.Object3D();

// Helper: Create the TSL Material
// This gives us the "Matte White" look BUT with Emissive Lightning support
// 🎨 Palette Upgrade: Added Vertex Displacement (Fluff) and Rim Light (Silver Lining)
function createCloudMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: 0xffffff,     // Pure cotton white base
        roughness: 1.0,      // Completely matte (cotton)
        metalness: 0.0,
        flatShading: false,
    });

    // 1. Vertex Displacement (Breathing/Fluffiness + Bass Squish)
    // We scroll noise through the cloud to simulate slow internal convection
    const noiseScale = float(1.5);
    const noiseSpeed = float(0.15);
    const timeOffset = vec3(0.0, uTime.mul(noiseSpeed), 0.0);

    // Position-based noise
    const noisePos = positionLocal.mul(noiseScale).add(timeOffset);
    const fluffNoise = mx_noise_float(noisePos);

    // Displace along the normal vector
    // Squish on Beat: Multiply strength by (1 + Bass) to puff out
    const squishFactor = float(1.0).add(uAudioLow.mul(1.5)); // React to kick
    const displacementStrength = float(0.15).mul(squishFactor);

    material.positionNode = positionLocal.add(normalLocal.mul(fluffNoise.mul(displacementStrength)));

    // 2. Lighting Logic
    // Lightning: Existing logic (flash on beat/storm)
    const lightningGlow = uCloudLightningColor.mul(uCloudLightningStrength.mul(2.0));

    // Rim Light: New "Silver Lining" logic
    const rimColor = color(0xFFF8E7); // Cosmic Latte / Soft Cream
    const rimIntensity = float(0.4);
    const rimPower = float(1.5); // Soft falloff
    const rimEffect = createRimLight(rimColor, rimIntensity, rimPower);

    // Rainbow Sheen (Pearlescence)
    // Driven by uCloudRainbowIntensity (Melody/Highs)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = abs(dot(normalWorld, viewDir));
    const fresnel = float(1.0).sub(NdotV).pow(float(2.0)); // Broad fresnel for sheen

    const irisR = sin(fresnel.mul(10.0));
    const irisG = sin(fresnel.mul(10.0).add(2.0));
    const irisB = sin(fresnel.mul(10.0).add(4.0));
    const rainbowColor = vec3(irisR, irisG, irisB).mul(0.5).add(0.5);

    const rainbowSheen = rainbowColor.mul(uCloudRainbowIntensity).mul(fresnel);

    // Combine Emissive: Lightning + Rim + Rainbow
    material.emissiveNode = lightningGlow.add(rimEffect).add(rainbowSheen);

    return material;
}

const sharedCloudMaterial = createCloudMaterial();

export function createRainingCloud(options = {}) {
    // Map old API to new
    const { scale = 1.0, size = 1.0 } = options;
    const finalScale = scale * (typeof size === 'number' ? size : 1.0);
    return createCloud({ scale: finalScale });
}

export function createCloud(options = {}) {
    const {
        scale = 1.0,
        tier = 1,
        puffCount = 12 + Math.floor(Math.random() * 8)
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'cloud';
    group.userData.tier = tier;
    group.userData.isRainCloud = false;

    // ⚡ OPTIMIZATION: Use InstancedMesh for cloud puffs
    // This reduces draw calls from ~15 per cloud to 1 per cloud.
    // For 100 clouds, this saves ~1400 draw calls.
    const puffs = new THREE.InstancedMesh(puffGeometry, sharedCloudMaterial, puffCount);
    puffs.castShadow = true;
    puffs.receiveShadow = true;

    for (let i = 0; i < puffCount; i++) {
        const radiusSpread = (Math.random() * 2.5 + 0.5) * scale;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = radiusSpread * Math.sin(phi) * Math.cos(theta);
        const z = radiusSpread * Math.sin(phi) * Math.sin(theta);
        let y = radiusSpread * Math.cos(phi);

        y *= 0.6; // Flatten bottom

        _scratchObject3D.position.set(x, y, z);

        const distFromCenter = _scratchObject3D.position.length();
        const sizeBase = 1.0 - (distFromCenter / (3.5 * scale)) * 0.5;
        const puffScaleRandom = 0.5 + Math.random() * 1.0;
        const finalPuffScale = Math.max(0.2, sizeBase * puffScaleRandom * scale);

        _scratchObject3D.scale.setScalar(finalPuffScale);
        _scratchObject3D.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        _scratchObject3D.updateMatrix();

        puffs.setMatrixAt(i, _scratchObject3D.matrix);
    }

    // Explicitly compute bounding sphere for correct culling
    puffs.computeBoundingSphere();

    group.add(puffs);

    group.scale.set(1.4, 1.0, 1.2);
    group.userData.originalScale = group.scale.clone();
    group.userData.animOffset = Math.random() * 100;

    group.onAnimate = (delta, time) => {
        const t = time + group.userData.animOffset;
        group.position.y += Math.sin(t * 0.5) * 0.05 * delta;
        group.rotation.y += Math.cos(t * 0.1) * 0.02 * delta;
    };

    group.userData.onAnimate = group.onAnimate;

    return group;
}

export function createDecoCloud(options = {}) {
    return createCloud(options);
}

// Helper for 'falling clouds' physics logic
// --- NEW STEERING LOGIC ---

export function updateCloudAttraction(cloud, targetPos, dt) {
    if (!cloud || !targetPos) return;

    // ⚡ OPTIMIZATION: Use shared vector to avoid allocation
    // 1. Calculate Vector to Target
    const toTarget = _scratchVec3.subVectors(targetPos, cloud.position);

    // Flatten Y: Clouds should stay in the sky, just move over the target
    toTarget.y = 0;

    const distSq = toTarget.lengthSq();

    // 2. Movement Logic
    if (distSq > 1.0) {
        toTarget.normalize();

        // Acceleration: Clouds are heavy, they move deliberately
        const speed = 4.0;
        cloud.position.addScaledVector(toTarget, speed * dt);

        // Bank/Lean into the turn for visual flair
        const leanAmount = 0.1;
        cloud.rotation.z = -toTarget.x * leanAmount;
        cloud.rotation.x = toTarget.z * leanAmount;
    } else {
        // 3. Anchored State
        // Stop moving and level out
        cloud.rotation.z *= 0.95;
        cloud.rotation.x *= 0.95;

        // Snap X/Z to perfectly center over time
        cloud.position.x += (targetPos.x - cloud.position.x) * 2.0 * dt;
        cloud.position.z += (targetPos.z - cloud.position.z) * 2.0 * dt;
    }
}

export function isCloudOverTarget(cloud, targetPos, threshold = 3.0) {
    const dx = cloud.position.x - targetPos.x;
    const dz = cloud.position.z - targetPos.z;
    return (dx*dx + dz*dz) < (threshold * threshold);
}

export function updateFallingClouds(dt, clouds, getGroundHeight) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const cloud = clouds[i];
        if (cloud.userData.isFalling) {
            cloud.userData.velocity.y -= 20.0 * dt;
            cloud.position.addScaledVector(cloud.userData.velocity, dt);

            const groundY = getGroundHeight(cloud.position.x, cloud.position.z);
            if (cloud.position.y < groundY - 2.0) {
                respawnCloud(cloud);
            }
        }
    }
}

function respawnCloud(cloud) {
    cloud.userData.isFalling = false;
    cloud.position.set(
        (Math.random() - 0.5) * 200,
        40 + Math.random() * 20,
        (Math.random() - 0.5) * 200
    );
}
