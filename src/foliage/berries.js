import * as THREE from 'three';

// --- Reusable Colors for Berry Updates ---
const _berryBaseColor = new THREE.Color(0x331100);
const _berryTargetColor = new THREE.Color();
const _berryCurrentColor = new THREE.Color();

/**
 * Create a cluster of berries/fruits with SSS materials
 */
export function createBerryCluster(options = {}) {
    const count = options.count || 5;
    const color = options.color || 0xFF6600;
    const baseGlow = options.baseGlow || 0.2;
    const size = options.size || 0.08;
    const shape = options.shape || 'sphere';

    const group = new THREE.Group();

    let geometry;
    if (shape === 'pear') {
        geometry = new THREE.SphereGeometry(size, 12, 16);
        geometry.scale(0.8, 1.3, 0.8);
    } else {
        geometry = new THREE.SphereGeometry(size, 16, 16);
    }

    const baseMaterial = new THREE.MeshPhysicalMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.0,
        transmission: 0.6,
        thickness: 0.4,
        emissive: new THREE.Color(color),
        emissiveIntensity: baseGlow,
        clearcoat: 0.2,
    });

    for (let i = 0; i < count; i++) {
        const berry = new THREE.Mesh(geometry, baseMaterial.clone());

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

        group.add(berry);
    }

    group.userData.berries = group.children;
    group.userData.baseGlow = baseGlow;
    group.userData.weatherGlow = 0;
    group.userData.glowDecayRate = 0.01;
    group.userData.berryColor = color;

    return group;
}

/**
 * Update berry glow based on weather and audio
 */
export function updateBerryGlow(berryCluster, weatherIntensity, audioData) {
    if (!berryCluster.userData.berries) return;

    const groove = audioData?.grooveAmount || 0;
    const totalGlow = weatherIntensity + groove * 0.5;
    const glowFactor = Math.max(0, Math.min(2, totalGlow));

    _berryTargetColor.setHex(berryCluster.userData.berryColor || 0xFF6600);
    _berryCurrentColor.copy(_berryBaseColor).lerp(_berryTargetColor, Math.min(1.0, glowFactor));

    berryCluster.userData.berries.forEach((berry, i) => {
        const offset = i * 0.1;
        const pulse = Math.sin((performance.now() * 0.001) + offset) * 0.1 + 1;

        berry.material.emissive.copy(_berryCurrentColor);
        berry.material.emissiveIntensity = berryCluster.userData.baseGlow * (1 + glowFactor) * pulse;
        berry.material.color.copy(_berryCurrentColor);
    });

    if (berryCluster.userData.weatherGlow > 0) {
        berryCluster.userData.weatherGlow -= berryCluster.userData.glowDecayRate;
    }
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

    if (!berryCluster.userData.originalBerryScales) {
        berryCluster.userData.originalBerryScales = berryCluster.userData.berries.map(b => b.scale.x);
    }

    let targetScale = 1.0;
    switch (phase) {
        case 'sunset':
            targetScale = 1.0 + phaseProgress * 0.3;
            break;
        case 'dusk':
            targetScale = 1.3 - phaseProgress * 0.1;
            break;
        case 'deepNight':
            targetScale = 1.2 - phaseProgress * 0.4;
            break;
        case 'preDawn':
            targetScale = 0.8 + phaseProgress * 0.2;
            break;
        default:
            targetScale = 1.0;
    }

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

export function initFallingBerries(scene) {
    fallingBerryGroup = new THREE.Group();
    fallingBerryGroup.name = 'fallingBerries';

    const berryGeo = new THREE.SphereGeometry(0.06, 8, 8);

    for (let i = 0; i < MAX_FALLING_BERRIES; i++) {
        const mat = new THREE.MeshStandardMaterial({
            color: 0xFF6600,
            emissive: 0xFF6600,
            emissiveIntensity: 0.5
        });
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
    berry.material.color.setHex(colorHex);
    berry.material.emissive.setHex(colorHex);
    berry.userData.velocity.set(
        (Math.random() - 0.5) * 2,
        -2 - Math.random() * 3,
        (Math.random() - 0.5) * 2
    );
    berry.userData.active = true;
    berry.userData.age = 0;
    berry.visible = true;
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

        berry.material.opacity = 1.0 - (berry.userData.age / maxAge);

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
            const worldPos = new THREE.Vector3();
            berry.getWorldPosition(worldPos);
            spawnFallingBerry(worldPos, cluster.userData.berryColor || 0xFF6600);
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
