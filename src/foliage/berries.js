import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    color, float, uniform, vec3, positionLocal, positionWorld,
    sin, cos, pow, mix, dot, time
} from 'three/tsl';
import { CandyPresets, uAudioLow, uTime } from './common.js';

// --- Reusable Scratch Variables ---
const _scratchWorldPos = new THREE.Vector3();

/**
 * Creates a "Heartbeat Gummy" TSL Material
 * @param {number} colorHex - Base color
 * @param {UniformNode} uGlowIntensity - Control uniform for external updates (weather/seasons)
 * @returns {MeshStandardNodeMaterial}
 */
function createHeartbeatMaterial(colorHex, uGlowIntensity) {
    // 1. Base Gummy Material (Translucent, SSS)
    const material = CandyPresets.Gummy(colorHex, {
        transmission: 0.6,
        thickness: 0.8,
        roughness: 0.2,
        ior: 1.4,
        subsurfaceStrength: 1.0, // Very juicy
        subsurfaceColor: colorHex
    });

    // 2. Heartbeat Logic (Vertex Displacement)
    // Calculate a unique phase based on world position so berries don't pulse in unison
    // We use a small coefficient so nearby berries are somewhat synced but not identical
    const phase = dot(positionWorld, vec3(0.5)).mul(5.0);

    // Heartbeat shape: sharper attack than a pure sine wave
    // sin(t)^4 gives a nice thump-thump
    const beatSpeed = float(8.0); // Fast beat
    const heartbeat = sin(uTime.mul(beatSpeed).add(phase)).pow(4.0);

    // Expansion factor: Base 1.0 + Audio Kick * Pulse
    // uAudioLow is 0..1 based on Kick Drum analysis
    const kickForce = uAudioLow.mul(0.25); // Max 25% expansion
    const scaleFactor = float(1.0).add(heartbeat.mul(kickForce));

    // Apply to vertex position (inflate from center)
    material.positionNode = positionLocal.mul(scaleFactor);

    // 3. Reactive Glow (Emissive)
    // Base Glow (Weather/DayNight) + Kick Flash
    const baseColor = color(colorHex);
    const flashColor = color(0xFFFFFF); // Flash white/bright on strong beats

    // Mix flash based on heartbeat strength
    const glowColor = mix(baseColor, flashColor, heartbeat.mul(uAudioLow).mul(0.5));

    // Final Intensity
    const totalIntensity = uGlowIntensity.add(heartbeat.mul(uAudioLow));

    material.emissiveNode = glowColor.mul(totalIntensity);

    return material;
}

/**
 * Create a cluster of berries/fruits with TSL "Juice"
 */
export function createBerryCluster(options = {}) {
    const count = options.count || 5;
    const colorHex = options.color || 0xFF6600;
    const baseGlow = options.baseGlow || 0.2;
    const size = options.size || 0.08;
    const shape = options.shape || 'sphere';

    const group = new THREE.Group();

    // Setup Geometry
    let geometry;
    if (shape === 'pear') {
        geometry = new THREE.SphereGeometry(size, 16, 16); // Increased polycount for smooth deformation
        geometry.scale(0.8, 1.3, 0.8);
    } else {
        geometry = new THREE.SphereGeometry(size, 24, 24); // Smooth for refraction
    }

    // Setup TSL Material with Cluster-Specific Uniform
    // We create one uniform per cluster to allow individual weather/season control
    const uClusterGlow = uniform(float(baseGlow));
    const material = createHeartbeatMaterial(colorHex, uClusterGlow);

    for (let i = 0; i < count; i++) {
        // Reuse the same material instance for performance (batching friendly)
        const berry = new THREE.Mesh(geometry, material);

        const phi = Math.acos(2 * (i / count) - 1);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const radius = 0.12;

        berry.position.set(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta) * 0.6,
            radius * Math.cos(phi)
        );

        const sizeVar = 0.8 + Math.random() * 0.4;
        berry.scale.setScalar(sizeVar);

        berry.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        // Tag for identification/physics
        berry.userData.isBerry = true;

        group.add(berry);
    }

    // Store data for systems
    group.userData.berries = group.children;
    group.userData.baseGlow = baseGlow;
    group.userData.weatherGlow = 0;
    group.userData.glowDecayRate = 0.01;
    group.userData.berryColor = colorHex;

    // Store the control uniform so we can update it later
    group.userData.uClusterGlow = uClusterGlow;

    return group;
}

/**
 * Update berry glow based on weather and audio
 * Optimized: Updates a single uniform value instead of looping over materials
 */
export function updateBerryGlow(berryCluster, weatherIntensity, audioData) {
    if (!berryCluster.userData.uClusterGlow) return;

    // Decay weather glow
    if (berryCluster.userData.weatherGlow > 0) {
        berryCluster.userData.weatherGlow -= berryCluster.userData.glowDecayRate;
        if (berryCluster.userData.weatherGlow < 0) berryCluster.userData.weatherGlow = 0;
    }

    // Calculate target intensity
    // Note: Audio pulse is now handled in TSL (GPU), so we just handle the base "Ambient" level here.
    const groove = audioData?.grooveAmount || 0;
    const baseGlow = berryCluster.userData.baseGlow;
    const weatherGlow = berryCluster.userData.weatherGlow + weatherIntensity; // Rain makes them glow

    // Add a bit of groove to the baseline intensity (breathing base)
    const targetIntensity = baseGlow + weatherGlow + (groove * 0.2);

    // Update the TSL Uniform
    berryCluster.userData.uClusterGlow.value = targetIntensity;
}

export function chargeBerries(berryCluster, chargeAmount) {
    if (!berryCluster.userData) return;
    berryCluster.userData.weatherGlow = Math.min(
        2.0,
        (berryCluster.userData.weatherGlow || 0) + chargeAmount
    );
}

export function updateBerrySeasons(berryCluster, phase, phaseProgress) {
    if (!berryCluster.userData.berries) return;

    // Initialize original scales if missing
    if (!berryCluster.userData.originalBerryScales) {
        berryCluster.userData.originalBerryScales = berryCluster.userData.berries.map(b => b.scale.x);
    }

    let targetScale = 1.0;
    switch (phase) {
        case 'sunset':
            targetScale = 1.0 + phaseProgress * 0.3; // Plump up
            break;
        case 'dusk':
            targetScale = 1.3 - phaseProgress * 0.1;
            break;
        case 'deepNight':
            targetScale = 1.2 - phaseProgress * 0.4; // Shrivel slightly
            break;
        case 'preDawn':
            targetScale = 0.8 + phaseProgress * 0.2;
            break;
        default:
            targetScale = 1.0;
    }

    // TSL Note: positionNode modifies the vertex relative to the mesh scale.
    // So changing mesh.scale here still correctly sizes the berry.
    berryCluster.userData.berries.forEach((berry, i) => {
        const origScale = berryCluster.userData.originalBerryScales[i];
        const newScale = origScale * targetScale;
        berry.scale.setScalar(newScale);
    });
}

// --- Falling Berry Particle System ---
let fallingBerryPool = [];
const MAX_FALLING_BERRIES = 50;
let fallingBerryGroup = null;

// Shared material for falling berries
let sharedFallingMaterial = null;

export function initFallingBerries(scene) {
    fallingBerryGroup = new THREE.Group();
    fallingBerryGroup.name = 'fallingBerries';

    const berryGeo = new THREE.SphereGeometry(0.06, 16, 16);

    // Create a TSL material for falling berries
    // They are "active" so they should glow/pulse
    const uFallingGlow = uniform(float(0.8)); // Bright when falling
    sharedFallingMaterial = createHeartbeatMaterial(0xFF6600, uFallingGlow);

    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        // We clone the material only to set individual colors if needed,
        // but for now we share it to be efficient.
        // Actually, spawnFallingBerry allows changing color.
        // To support dynamic colors with TSL without creating 50 materials,
        // we should ideally use an instance color or a uniform.
        // For simplicity in this polish pass, we'll clone per particle or limit colors.

        // Let's create a clone per berry to allow unique colors via TSL?
        // No, standard TSL material.colorNode = color(...)
        // If we want to change color at runtime, we need a uniform OR update the node.

        // Optimized: Create one material per pool item.
        // This is 50 materials. Totally fine for WebGPU.
        const uColor = uniform(color(0xFF6600));
        const mat = createHeartbeatMaterial(0xFF6600, uFallingGlow);
        mat.colorNode = uColor; // Override color with uniform
        mat.userData.uColor = uColor; // Store reference

        const berry = new THREE.Mesh(berryGeo, mat);
        berry.visible = false;
        berry.userData.velocity = new THREE.Vector3();
        berry.userData.active = false;
        berry.userData.age = 0;

        fallingBerryGroup.add(berry);
        fallingBerryPool.push(berry);
    }

    scene.add(fallingBerryGroup);
}

export function spawnFallingBerry(position, colorHex = 0xFF6600) {
    const berry = fallingBerryPool.find(b => !b.userData.active);
    if (!berry) return;

    berry.position.copy(position);

    // Update TSL Uniform for color
    if (berry.material.userData.uColor) {
        berry.material.userData.uColor.value.setHex(colorHex);
    }

    berry.userData.velocity.set(
        (Math.random() - 0.5) * 2,
        -2 - Math.random() * 3,
        (Math.random() - 0.5) * 2
    );
    berry.userData.active = true;
    berry.userData.age = 0;
    berry.visible = true;

    // Reset opacity (handled via scale or transmission in TSL?)
    // Our TSL Gummy material handles transparency via transmission.
    // For fading out, we might want to shrink them.
    berry.scale.setScalar(1.0);
}

export function updateFallingBerries(delta) {
    if (!fallingBerryGroup) return;

    const gravity = -9.8;
    const maxAge = 3.0;

    fallingBerryPool.forEach(berry => {
        if (!berry.userData.active) return;

        berry.userData.age += delta;
        berry.userData.velocity.y += gravity * delta;

        berry.position.x += berry.userData.velocity.x * delta;
        berry.position.y += berry.userData.velocity.y * delta;
        berry.position.z += berry.userData.velocity.z * delta;

        // Shrink as they age/die
        const lifeLeft = 1.0 - (berry.userData.age / maxAge);
        berry.scale.setScalar(lifeLeft);

        if (berry.position.y < 0 || berry.userData.age > maxAge) {
            berry.userData.active = false;
            berry.visible = false;
        }
    });
}

export function shakeBerriesLoose(cluster, intensity) {
    if (!cluster.userData.berries) return;

    cluster.userData.berries.forEach(berry => {
        if (Math.random() < intensity * 0.02) {
            berry.getWorldPosition(_scratchWorldPos);
            // Use the cluster's color
            spawnFallingBerry(_scratchWorldPos, cluster.userData.berryColor || 0xFF6600);
        }
    });
}

export function collectFallingBerries(playerPos, collectRadius = 1.0) {
    if (!fallingBerryPool) return 0;

    let collected = 0;
    const radiusSq = collectRadius * collectRadius;

    fallingBerryPool.forEach(berry => {
        if (!berry.userData.active) return;

        const distSq = berry.position.distanceToSquared(playerPos);
        if (distSq < radiusSq) {
            berry.userData.active = false;
            berry.visible = false;
            collected++;
        }
    });

    return collected;
}
