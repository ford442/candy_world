// src/foliage/clouds.js

import * as THREE from 'three';
import { color, uniform, mix, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

// --- Global Uniforms (Driven by WeatherSystem) ---
// These are true TSL uniforms now
export const uCloudRainbowIntensity = uniform(0.0);
export const uCloudLightningStrength = uniform(0.0);
export const uCloudLightningColor = uniform(color(0xFFFFFF));

// --- Configuration ---
const puffGeometry = new THREE.IcosahedronGeometry(1, 1);

// Helper: Create the TSL Material
// This gives us the "Matte White" look BUT with Emissive Lightning support
function createCloudMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: 0xffffff,     // Pure cotton white base
        roughness: 1.0,      // Completely matte (cotton)
        metalness: 0.0,
        flatShading: false,
    });

    // TSL Logic:
    // Emission = Lightning Color * Lightning Strength
    // This allows the cloud to glow with the Note Color on the beat
    const lightningGlow = uCloudLightningColor.mul(uCloudLightningStrength.mul(2.0)); // Boosted intensity

    // We can also mix in a bit of rainbow if desired, but let's keep it clean for now:
    material.emissiveNode = lightningGlow;

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

    // Generate the cloud by clustering "puffs"
    for (let i = 0; i < puffCount; i++) {
        // Use the TSL Material
        const puff = new THREE.Mesh(puffGeometry, sharedCloudMaterial);

        const radiusSpread = (Math.random() * 2.5 + 0.5) * scale;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        puff.position.set(
            radiusSpread * Math.sin(phi) * Math.cos(theta),
            radiusSpread * Math.sin(phi) * Math.sin(theta),
            radiusSpread * Math.cos(phi)
        );

        puff.position.y *= 0.6; // Flatten bottom

        const distFromCenter = puff.position.length();
        const sizeBase = 1.0 - (distFromCenter / (3.5 * scale)) * 0.5;
        const puffScaleRandom = 0.5 + Math.random() * 1.0;
        const finalPuffScale = Math.max(0.2, sizeBase * puffScaleRandom * scale);

        puff.scale.setScalar(finalPuffScale);
        puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

        puff.castShadow = true;
        puff.receiveShadow = true;

        group.add(puff);
    }

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
