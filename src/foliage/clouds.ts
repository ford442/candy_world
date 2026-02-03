// src/foliage/clouds.ts

import * as THREE from 'three';
import { cloudBatcher, uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor, sharedCloudMaterial } from './cloud-batcher.ts';

// Re-export for compatibility with weather.ts
export { uCloudRainbowIntensity, uCloudLightningStrength, uCloudLightningColor, sharedCloudMaterial };

// Optimization: Shared scratch variables
const _scratchVec3 = new THREE.Vector3();

export interface CloudOptions {
    scale?: number;
    size?: number; // legacy alias for scale multiplier
    tier?: number;
    puffCount?: number;
}

// Wrapper for createCloud
export function createRainingCloud(options: CloudOptions = {}): THREE.Group {
    const { scale = 1.0, size = 1.0 } = options;
    const finalScale = scale * (typeof size === 'number' ? size : 1.0);
    return createCloud({ scale: finalScale });
}

export function createCloud(options: CloudOptions = {}): THREE.Group {
    const {
        scale = 1.0,
        tier = 1,
        puffCount = 12 + Math.floor(Math.random() * 8)
    } = options;

    // ⚡ OPTIMIZATION: Cloud is now a Logic Object (Proxy)
    // The visuals are handled by CloudBatcher (1 Draw Call for all clouds)
    const group = new THREE.Group();
    group.userData.type = 'cloud';
    group.userData.tier = tier;
    group.userData.isRainCloud = false;

    // Store Scale for Batcher
    group.userData.originalScale = new THREE.Vector3(1.4, 1.0, 1.2);
    group.scale.copy(group.userData.originalScale);

    group.userData.animOffset = Math.random() * 100;

    // Animation Logic (Called by Batcher or Physics)
    // @ts-ignore
    group.onAnimate = (delta: number, time: number) => {
        const t = time + group.userData.animOffset;
        // Float animation logic
        // We modify the group's local transform, which the Batcher then reads
        group.position.y += Math.sin(t * 0.5) * 0.05 * delta;
        group.rotation.y += Math.cos(t * 0.1) * 0.02 * delta;
    };
    group.userData.onAnimate = (group as any).onAnimate;

    // Register with Batcher on Placement (World Generation)
    group.userData.onPlacement = () => {
        cloudBatcher.register(group, { scale, puffCount });
    };

    return group;
}

export function createDecoCloud(options: CloudOptions = {}): THREE.Group {
    return createCloud(options);
}

// Helper for 'falling clouds' physics logic
// --- NEW STEERING LOGIC ---

export function updateCloudAttraction(cloud: THREE.Object3D, targetPos: THREE.Vector3, dt: number): void {
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

export function isCloudOverTarget(cloud: THREE.Object3D, targetPos: THREE.Vector3, threshold: number = 3.0): boolean {
    const dx = cloud.position.x - targetPos.x;
    const dz = cloud.position.z - targetPos.z;
    return (dx*dx + dz*dz) < (threshold * threshold);
}

export function updateFallingClouds(dt: number, clouds: THREE.Object3D[], getGroundHeight: (x: number, z: number) => number): void {
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

function respawnCloud(cloud: THREE.Object3D): void {
    cloud.userData.isFalling = false;
    cloud.position.set(
        (Math.random() - 0.5) * 200,
        40 + Math.random() * 20,
        (Math.random() - 0.5) * 200
    );
}
