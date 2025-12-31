// src/foliage/clouds.js
import * as THREE from 'three';

// --- Weather System Compatibility Exports ---
// We export these so src/systems/weather.js doesn't crash when trying to import them.
// Since we are switching to a simple matte material, we use standard JS objects
// to absorb the values from the weather system without visual effect (for now).
export const uCloudRainbowIntensity = { value: 0.0 };
export const uCloudLightningStrength = { value: 0.0 };
export const uCloudLightningColor = { value: new THREE.Color(0xFFFFFF) };

// --- Configuration ---
// Icosahedron looks slightly more natural/lumpy than a perfect Sphere for puffs.
const puffGeometry = new THREE.IcosahedronGeometry(1, 1); // Radius 1, Detail 1 (Low poly for performance)

// Define a clean, matte white material for clouds.
// High roughness = no shiny specular highlights (fixes "rainbow" issue)
const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,     // Pure cotton white
    roughness: 1.0,      // Completely matte
    metalness: 0.0,      // No metallic properties
    flatShading: false,  // Smooth shading for soft look
});

export function createRainingCloud(options = {}) {
    // Map old "createRainingCloud" to new clustered cloud
    // This maintains API compatibility with generation.ts
    const { scale = 1.0, size = 1.0 } = options;
    // Combine scale and size (legacy params)
    const finalScale = scale * (typeof size === 'number' ? size : 1.0);
    return createCloud({ scale: finalScale });
}

export function createCloud(options = {}) {
    const {
        scale = 1.0,
        tier = 1,
        // Increase puff count for complexity
        puffCount = 12 + Math.floor(Math.random() * 8)
    } = options;

    const group = new THREE.Group();
    group.userData.type = 'cloud';
    group.userData.tier = tier;
    group.userData.isRainCloud = false;

    // Generate the cloud by clustering "puffs" together
    for (let i = 0; i < puffCount; i++) {
        const puff = new THREE.Mesh(puffGeometry, cloudMaterial);

        // 1. Random Position relative to cloud center
        // We use spherical distribution to create a lump
        const radiusSpread = (Math.random() * 2.5 + 0.5) * scale;
        const theta = Math.random() * Math.PI * 2; // Angle around Y axis
        const phi = Math.acos(2 * Math.random() - 1); // Angle from up vector

        // Convert spherical to cartesian
        puff.position.set(
            radiusSpread * Math.sin(phi) * Math.cos(theta),
            radiusSpread * Math.sin(phi) * Math.sin(theta),
            radiusSpread * Math.cos(phi)
        );

        // Flatten the cluster slightly on the Y axis for a more cumulus shape
        puff.position.y *= 0.6;

        // 2. Vary Puff Size
        // Puffs closer to center tend to be larger
        const distFromCenter = puff.position.length();
        const sizeBase = 1.0 - (distFromCenter / (3.5 * scale)) * 0.5;
        const puffScaleRandom = 0.5 + Math.random() * 1.0;
        const finalPuffScale = Math.max(0.2, sizeBase * puffScaleRandom * scale);

        puff.scale.setScalar(finalPuffScale);

        // 3. Random Rotation for variety
        puff.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

        // Shadows add immense depth to clustered objects
        puff.castShadow = true;
        puff.receiveShadow = true;

        group.add(puff);
    }

    // Overall cloud shape adjustments
    group.scale.set(1.4, 1.0, 1.2);

    // Store original scale for animations
    group.userData.originalScale = group.scale.clone();
    // Unique offset for animation
    group.userData.animOffset = Math.random() * 100;

    // Animation function called by WeatherSystem
    // Use existing method signature
    group.onAnimate = (delta, time) => {
        // Gentle bobbing motion
        const t = time + group.userData.animOffset;
        group.position.y += Math.sin(t * 0.5) * 0.05 * delta;

        // Very slow drift rotation
        group.rotation.y += Math.cos(t * 0.1) * 0.02 * delta;
    };

    // Attach to group logic for WeatherSystem compatibility
    group.userData.onAnimate = group.onAnimate;

    return group;
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
