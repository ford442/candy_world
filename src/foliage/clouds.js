import * as THREE from 'three';
import { color, mix, positionLocal, float, time, sin, cos, vec3, uniform, smoothstep, normalLocal } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attachReactivity, generateNoiseTexture } from './common.js';

// --- Global Uniforms for Weather Effects ---
// We use globals so the weather system can drive the entire sky at once
export const uCloudRainbowIntensity = uniform(0.0);
export const uCloudLightningStrength = uniform(0.0);
export const uCloudLightningColor = uniform(color(0xFFFFFF));

export function createRainingCloud(options = {}) {
    const {
        color = null,
        rainIntensity = 30,
        shape = 'random',
        size = 1.0
    } = options;

    const group = new THREE.Group();

    const cloudColors = [
        0xF5F5F5, 0xFFE4E1, 0xE6E6FA, 0xB0C4DE, 0xFFC0CB, 0xDDA0DD, 0x98FB98
    ];

    const cloudColor = color !== null ? color : cloudColors[Math.floor(Math.random() * cloudColors.length)];
    // USE NEW MATERIAL (TSL driven)
    const cloudMat = createStormCloudMaterial(cloudColor);

    const shapeType = shape === 'random'
        ? ['fluffy', 'long', 'tall', 'puffy'][Math.floor(Math.random() * 4)]
        : shape;

    switch (shapeType) {
        case 'fluffy': {
            const sphereCount = 5 + Math.floor(Math.random() * 3);
            for (let i = 0; i < sphereCount; i++) {
                const r = (0.8 + Math.random() * 0.8) * size;
                const geo = new THREE.SphereGeometry(r, 16, 16);
                const sphere = new THREE.Mesh(geo, cloudMat);
                sphere.position.set(
                    (Math.random() - 0.5) * 2.5 * size,
                    (Math.random() - 0.3) * 1.0 * size,
                    (Math.random() - 0.5) * 1.5 * size
                );
                sphere.castShadow = true;
                group.add(sphere);
            }
            break;
        }
        case 'long': {
            for (let i = 0; i < 6; i++) {
                const r = (0.6 + Math.random() * 0.4) * size;
                const geo = new THREE.SphereGeometry(r, 16, 16);
                const sphere = new THREE.Mesh(geo, cloudMat);
                sphere.position.set(
                    (i - 2.5) * 1.2 * size,
                    (Math.random() - 0.5) * 0.5 * size,
                    (Math.random() - 0.5) * 0.8 * size
                );
                sphere.scale.set(1.3, 0.7, 1);
                sphere.castShadow = true;
                group.add(sphere);
            }
            break;
        }
        case 'tall': {
            const layers = 3;
            for (let layer = 0; layer < layers; layer++) {
                const count = 4 - layer;
                const layerY = layer * 1.2 * size;
                for (let i = 0; i < count; i++) {
                    const r = (1.0 - layer * 0.2 + Math.random() * 0.3) * size;
                    const geo = new THREE.SphereGeometry(r, 16, 16);
                    const sphere = new THREE.Mesh(geo, cloudMat);
                    const angle = (i / count) * Math.PI * 2;
                    const radius = (1.5 - layer * 0.4) * size;
                    sphere.position.set(
                        Math.cos(angle) * radius,
                        layerY,
                        Math.sin(angle) * radius
                    );
                    sphere.castShadow = true;
                    group.add(sphere);
                }
            }
            break;
        }
        case 'puffy': {
            const core = new THREE.Mesh(
                new THREE.SphereGeometry(1.5 * size, 16, 16),
                cloudMat
            );
            core.castShadow = true;
            group.add(core);

            for (let i = 0; i < 8; i++) {
                const r = (0.5 + Math.random() * 0.4) * size;
                const geo = new THREE.SphereGeometry(r, 12, 12);
                const sphere = new THREE.Mesh(geo, cloudMat);
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI * 0.6;
                sphere.position.set(
                    Math.sin(phi) * Math.cos(theta) * 1.4 * size,
                    Math.cos(phi) * 0.8 * size,
                    Math.sin(phi) * Math.sin(theta) * 1.4 * size
                );
                sphere.castShadow = true;
                group.add(sphere);
            }
            break;
        }
    }

    if (rainIntensity > 0) {
        const rainGeo = new THREE.BufferGeometry();
        const rainCount = rainIntensity;
        const positions = new Float32Array(rainCount * 3);
        for (let i = 0; i < rainCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 4 * size;
            positions[i * 3 + 1] = Math.random() * -2;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 4 * size;
        }
        rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
        const rain = new THREE.Points(rainGeo, rainMat);
        group.add(rain);
    }

    group.userData.animationType = rainIntensity > 0 ? 'rain' : 'cloudBob';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'cloud';
    group.userData.shapeType = shapeType;
    group.userData.cloudColor = cloudColor;
    group.userData.reactivityType = 'sky';

    // Explicitly tag as Sky object for upper-channel (drum) reactivity
    group.userData.reactivityType = 'sky';

    return attachReactivity(group);
}

export function createDecoCloud(options = {}) {
    return createRainingCloud({ ...options, rainIntensity: 0 });
}

// --- TSL Helpers ---
function getRainbowColor(pos, t) {
    // Scroll rainbow based on position and time
    const offset = pos.y.add(pos.x.mul(0.5)).add(t);
    const r = cos(offset.mul(6.28).add(0.0)).mul(0.5).add(0.5);
    const g = cos(offset.mul(6.28).add(0.33 * 6.28)).mul(0.5).add(0.5);
    const b = cos(offset.mul(6.28).add(0.67 * 6.28)).mul(0.5).add(0.5);
    return vec3(r, g, b);
}

function createStormCloudMaterial(baseColorHex) {
    if (!generateNoiseTexture()) return new THREE.MeshStandardMaterial({ color: baseColorHex });

    const material = new MeshStandardNodeMaterial({
        color: baseColorHex,
        roughness: 0.8,
        metalness: 0.1,
    });

    // 1. Rainbow Effect (melody/highs driven)
    const rainbowCol = getRainbowColor(positionLocal, time.mul(0.5));

    // 2. Lightning Effect (global flash)
    const lightningCol = uCloudLightningColor;

    const rainbowMix = rainbowCol.mul(uCloudRainbowIntensity);
    const lightningMix = lightningCol.mul(uCloudLightningStrength.mul(5.0)); // Super bright flash

    material.emissiveNode = rainbowMix.add(lightningMix);

    // Optionally add subtle normal perturb or rim lighting here

    return material;
}

// --- Falling Cloud Helpers ---
export function updateFallingClouds(dt, clouds, getGroundHeight) {
    for (let i = clouds.length - 1; i >= 0; i--) {
        const cloud = clouds[i];
        if (cloud.userData.isFalling) {
            // Apply Gravity
            cloud.userData.velocity.y -= 20.0 * dt; // Gravity
            
            // Move
            cloud.position.addScaledVector(cloud.userData.velocity, dt);
            cloud.rotation.z += dt; // Spin as it falls
            cloud.rotation.x += dt * 0.5;

            // Ground Collision
            const groundY = getGroundHeight(cloud.position.x, cloud.position.z);
            if (cloud.position.y < groundY - 2.0) {
                // Sunk into ground - Respawn elsewhere
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
    cloud.rotation.set(0, 0, 0);
    
    // Restore colors
    cloud.traverse(c => {
        if (c.isMesh) {
            if (c.material) {
                c.material.emissive.setHex(0x000000); // Or original color
                c.material.emissiveIntensity = 0.0;
            }
        }
    });
}
