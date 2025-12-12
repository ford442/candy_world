import * as THREE from 'three';
import { color, mix, positionLocal, normalWorld, float, time, sin, cos, vec3, uniform, attribute } from 'three/tsl';
import { PointsNodeMaterial } from 'three/webgpu';
import { freqToHue, isEmscriptenReady, fbm } from './wasm-loader.js';

// --- Helper: Rim Lighting Effect ---
function addRimLight(material, colorHex) {
    // Basic material doesn't support node mixing easily without setup, 
    // but MeshStandardMaterial does in WebGPU. 
    // This is a placeholder for the logic if we were using full TSL nodes.
    // For now, we rely on the standard lighting model + emissive.
}

// --- Materials for Foliage ---
// --- SHARED TEXTURES ---
let globalNoiseTexture = null;

function generateNoiseTexture() {
    if (globalNoiseTexture) return globalNoiseTexture;

    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const useWasm = isEmscriptenReady();

    for (let i = 0; i < size * size; i++) {
        const x = (i % size) / size;
        const y = Math.floor(i / size) / size;

        let n = 0;
        if (useWasm) {
            n = fbm(x * 4.0, y * 4.0, 4);
            n = n * 0.5 + 0.5;
        } else {
            n = Math.random();
        }

        const val = Math.floor(n * 255);
        data[i * 4] = val;
        data[i * 4 + 1] = val;
        data[i * 4 + 2] = val;
        data[i * 4 + 3] = 255;
    }

    globalNoiseTexture = new THREE.DataTexture(data, size, size);
    globalNoiseTexture.wrapS = THREE.RepeatWrapping;
    globalNoiseTexture.wrapT = THREE.RepeatWrapping;
    globalNoiseTexture.needsUpdate = true;
    return globalNoiseTexture;
}

function createClayMaterial(colorHex) {
    if (!globalNoiseTexture) generateNoiseTexture();
    return new THREE.MeshStandardMaterial({
        color: colorHex,
        metalness: 0.0,
        roughness: 0.8,
        flatShading: false,
        bumpMap: globalNoiseTexture,
        bumpScale: 0.02
    });
}

// --- Gradient Material using TSL (for smooth organic transitions) ---
import { MeshStandardNodeMaterial } from 'three/webgpu';

function createGradientMaterial(topColorHex, bottomColorHex, roughnessVal = 0.7) {
    const mat = new MeshStandardNodeMaterial();
    mat.roughness = roughnessVal;
    mat.metalness = 0;

    // Vertical gradient based on normalized local Y position
    // positionLocal.y ranges based on geometry, normalize to 0-1
    const h = positionLocal.y.add(0.5).clamp(0, 1); // Shift and clamp for typical centered geometry
    const topCol = color(topColorHex);
    const bottomCol = color(bottomColorHex);
    mat.colorNode = mix(bottomCol, topCol, h);

    return mat;
}

const foliageMaterials = {
    grass: createClayMaterial(0x7CFC00),
    flowerStem: createClayMaterial(0x228B22),
    flowerCenter: createClayMaterial(0xFFFACD),
    flowerPetal: [
        createClayMaterial(0xFF69B4),
        createClayMaterial(0xBA55D3),
        createClayMaterial(0x87CEFA),
    ],
    lightBeam: new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    }),
    // New Materials
    blackPlastic: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.1 }),
    lotusRing: createClayMaterial(0x222222), // Dark initially, lights up
    opticCable: new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.3,
        roughness: 0.1
    }),
    opticTip: new THREE.MeshBasicMaterial({ color: 0xFFFFFF }), // Pure light

    // Mushroom Materials (Consolidated from main.js)
    mushroomStem: createClayMaterial(0xF5DEB3), // Wheat
    mushroomCap: [
        createClayMaterial(0xFF6347), // Tomato
        createClayMaterial(0xDA70D6), // Orchid
        createClayMaterial(0xFFA07A), // Light Salmon
        createClayMaterial(0x00BFFF), // Deep Sky Blue (Drivable/Magic)
    ],
    mushroomGills: createClayMaterial(0x8B4513), // Saddle Brown
    mushroomSpots: createClayMaterial(0xFFFFFF), // White spots
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }),
};

export const reactiveMaterials = [];

function registerReactiveMaterial(mat) {
    if (reactiveMaterials.length < 500) { // Reduced from 3000 for better performance
        reactiveMaterials.push(mat);
    }
}

// Helper to pick random animation
function pickAnimation(types) {
    return types[Math.floor(Math.random() * types.length)];
}

// Helper Objects
const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);

// =============================================================================
// BERRY & FRUIT SYSTEM
// =============================================================================

/**
 * Create a cluster of berries/fruits with SSS materials
 * @param {object} options - Configuration
 * @param {number} options.count - Number of berries in cluster
 * @param {number} options.color - Base color hex
 * @param {number} options.baseGlow - Base emissive intensity
 * @param {number} options.size - Berry size multiplier
 * @param {string} options.shape - 'sphere' or 'pear'
 * @returns {THREE.Group}
 */
export function createBerryCluster(options = {}) {
    const count = options.count || 5;
    const color = options.color || 0xFF6600;
    const baseGlow = options.baseGlow || 0.2;
    const size = options.size || 0.08;
    const shape = options.shape || 'sphere';

    const group = new THREE.Group();

    // Geometry based on shape
    let geometry;
    if (shape === 'pear') {
        // Pear-shaped (elongated sphere)
        geometry = new THREE.SphereGeometry(size, 12, 16);
        geometry.scale(0.8, 1.3, 0.8);
    } else {
        geometry = new THREE.SphereGeometry(size, 16, 16);
    }

    // SSS Material for translucent glow
    const baseMaterial = new THREE.MeshPhysicalMaterial({
        color: color,
        roughness: 0.3,
        metalness: 0.0,
        transmission: 0.6,  // Translucency
        thickness: 0.4,     // SSS depth
        emissive: new THREE.Color(color),
        emissiveIntensity: baseGlow,
        clearcoat: 0.2,     // Slight waxy coating
    });

    // Create cluster in organic pattern
    for (let i = 0; i < count; i++) {
        const berry = new THREE.Mesh(geometry, baseMaterial.clone());

        // Position in cluster (roughly spherical arrangement)
        const phi = Math.acos(2 * (i / count) - 1);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i; // Golden ratio spiral
        const radius = 0.12;

        berry.position.set(
            radius * Math.sin(phi) * Math.cos(theta),
            radius * Math.sin(phi) * Math.sin(theta) * 0.6, // Flatter vertically
            radius * Math.cos(phi)
        );

        // Slight size variation
        const sizeVar = 0.8 + Math.random() * 0.4;
        berry.scale.setScalar(sizeVar);

        // Slight rotation for organic look
        berry.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI
        );

        group.add(berry);
    }

    // Store metadata for weather system
    group.userData.berries = group.children;
    group.userData.baseGlow = baseGlow;
    group.userData.weatherGlow = 0; // Accumulated glow from storms
    group.userData.glowDecayRate = 0.01;
    group.userData.berryColor = color;

    return group;
}

// --- Reusable Colors for Berry Updates (prevents GC pressure) ---
const _berryBaseColor = new THREE.Color(0x331100);
const _berryTargetColor = new THREE.Color();
const _berryCurrentColor = new THREE.Color();

/**
 * Update berry glow based on weather and audio
 * @param {THREE.Group} berryCluster - The berry cluster
 * @param {number} weatherIntensity - 0-2, accumulated from storms
 * @param {object} audioData - Current audio state
 */
export function updateBerryGlow(berryCluster, weatherIntensity, audioData) {
    if (!berryCluster.userData.berries) return;

    // Combine weather charge + audio reactivity
    const groove = audioData?.grooveAmount || 0;
    const totalGlow = weatherIntensity + groove * 0.5;
    const glowFactor = Math.max(0, Math.min(2, totalGlow));

    // Lerp color: dim (dark red/brown) -> bright (orange/yellow)
    // Reuse pooled colors to avoid per-frame allocation
    _berryTargetColor.setHex(berryCluster.userData.berryColor || 0xFF6600);
    _berryCurrentColor.copy(_berryBaseColor).lerp(_berryTargetColor, Math.min(1.0, glowFactor));

    berryCluster.userData.berries.forEach((berry, i) => {
        // Slight offset per berry for organic pulsing
        const offset = i * 0.1;
        const pulse = Math.sin((performance.now() * 0.001) + offset) * 0.1 + 1;

        berry.material.emissive.copy(_berryCurrentColor);
        berry.material.emissiveIntensity = berryCluster.userData.baseGlow * (1 + glowFactor) * pulse;

        // Also update color if supported
        berry.material.color.copy(_berryCurrentColor);
    });

    // Weather glow decays over time
    if (berryCluster.userData.weatherGlow > 0) {
        berryCluster.userData.weatherGlow -= berryCluster.userData.glowDecayRate;
    }
}

/**
 * Charge berries from storm/rain
 * @param {THREE.Group} berryCluster
 * @param {number} chargeAmount - How much to add (0-1 per storm event)
 */
export function chargeBerries(berryCluster, chargeAmount) {
    if (!berryCluster.userData) return;
    berryCluster.userData.weatherGlow = Math.min(
        2.0,
        (berryCluster.userData.weatherGlow || 0) + chargeAmount
    );
}

/**
 * Update berry size based on day/night cycle phase (Seasonal effect)
 * @param {THREE.Group} berryCluster - Berry cluster to update
 * @param {string} phase - Current cycle phase ('sunrise', 'day', 'sunset', 'dusk', 'deepNight', 'preDawn')
 * @param {number} phaseProgress - Progress within phase (0-1)
 */
export function updateBerrySeasons(berryCluster, phase, phaseProgress) {
    if (!berryCluster.userData.berries) return;

    // Store original scale if not already stored
    if (!berryCluster.userData.originalBerryScales) {
        berryCluster.userData.originalBerryScales = berryCluster.userData.berries.map(b => b.scale.x);
    }

    // Determine target scale multiplier based on phase
    let targetScale = 1.0;
    switch (phase) {
        case 'sunset':
            // Berries grow during harvest time (sunset)
            targetScale = 1.0 + phaseProgress * 0.3; // Up to 1.3x
            break;
        case 'dusk':
            targetScale = 1.3 - phaseProgress * 0.1; // 1.3 → 1.2
            break;
        case 'deepNight':
            // Berries shrink during deep night
            targetScale = 1.2 - phaseProgress * 0.4; // 1.2 → 0.8
            break;
        case 'preDawn':
            targetScale = 0.8 + phaseProgress * 0.2; // 0.8 → 1.0
            break;
        default:
            targetScale = 1.0;
    }

    // Apply scale to each berry
    berryCluster.userData.berries.forEach((berry, i) => {
        const origScale = berryCluster.userData.originalBerryScales[i];
        const newScale = origScale * targetScale;
        berry.scale.setScalar(newScale);
    });
}


// =============================================================================
// FALLING BERRY PARTICLE SYSTEM (Storm Enhancement)
// =============================================================================

// Pool of falling berries for performance
let fallingBerryPool = [];
const MAX_FALLING_BERRIES = 50;
let fallingBerryGroup = null;

/**
 * Initialize the falling berry particle pool
 * @param {THREE.Scene} scene - Scene to add particles to
 */
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

/**
 * Spawn a falling berry at a position
 * @param {THREE.Vector3} position - World position to spawn at
 * @param {number} colorHex - Berry color
 */
export function spawnFallingBerry(position, colorHex = 0xFF6600) {
    // Find inactive berry in pool
    const berry = fallingBerryPool.find(b => !b.userData.active);
    if (!berry) return; // Pool exhausted

    berry.position.copy(position);
    berry.material.color.setHex(colorHex);
    berry.material.emissive.setHex(colorHex);
    berry.userData.velocity.set(
        (Math.random() - 0.5) * 2,
        -2 - Math.random() * 3, // Fall downward
        (Math.random() - 0.5) * 2
    );
    berry.userData.active = true;
    berry.userData.age = 0;
    berry.visible = true;
}

/**
 * Update all falling berries
 * @param {number} delta - Time delta
 */
export function updateFallingBerries(delta) {
    if (!fallingBerryGroup) return;

    const gravity = -9.8;
    const maxAge = 3.0; // 3 seconds max lifetime

    fallingBerryPool.forEach(berry => {
        if (!berry.userData.active) return;

        berry.userData.age += delta;

        // Apply gravity
        berry.userData.velocity.y += gravity * delta;

        // Update position
        berry.position.x += berry.userData.velocity.x * delta;
        berry.position.y += berry.userData.velocity.y * delta;
        berry.position.z += berry.userData.velocity.z * delta;

        // Fade out as it ages
        berry.material.opacity = 1.0 - (berry.userData.age / maxAge);

        // Deactivate if hit ground or too old
        if (berry.position.y < 0 || berry.userData.age > maxAge) {
            berry.userData.active = false;
            berry.visible = false;
        }
    });
}

/**
 * Shake berries loose from a cluster during storms
 * @param {THREE.Group} cluster - Berry cluster to shake
 * @param {number} intensity - Storm intensity (0-1)
 */
export function shakeBerriesLoose(cluster, intensity) {
    if (!cluster.userData.berries) return;

    cluster.userData.berries.forEach(berry => {
        // Random chance based on intensity
        if (Math.random() < intensity * 0.02) { // 2% chance per intensity unit
            const worldPos = new THREE.Vector3();
            berry.getWorldPosition(worldPos);
            spawnFallingBerry(worldPos, cluster.userData.berryColor || 0xFF6600);
        }
    });
}

/**
 * Check for player collision with falling berries and collect them
 * @param {THREE.Vector3} playerPos - Player world position
 * @param {number} collectRadius - Collection radius around player
 * @returns {number} Number of berries collected
 */
export function collectFallingBerries(playerPos, collectRadius = 1.0) {
    if (!fallingBerryPool) return 0;

    let collected = 0;
    const radiusSq = collectRadius * collectRadius;

    fallingBerryPool.forEach(berry => {
        if (!berry.userData.active) return;

        const distSq = berry.position.distanceToSquared(playerPos);
        if (distSq < radiusSq) {
            // Collect this berry
            berry.userData.active = false;
            berry.visible = false;
            collected++;
        }
    });

    return collected;
}

// --- Instancing System (Grass) ---
/**
 * Trigger growth (scale up) for structural plants
 * @param {Array<THREE.Group>} plants - List of plant groups
 * @param {number} intensity - Growth increment
 */
export function triggerGrowth(plants, intensity) {
    plants.forEach(plant => {
        // Only grow if below max scale
        if (!plant.userData.maxScale) {
            // Initialize max scale if not present (usually starts at 1.0 or random var)
            plant.userData.maxScale = plant.scale.x * 1.5;
        }

        if (plant.scale.x < plant.userData.maxScale) {
            const growthRate = intensity * 0.01;
            const newScale = plant.scale.x + growthRate;
            plant.scale.setScalar(newScale);
        }
    });
}

/**
 * Trigger bloom (scale up flower heads)
 * @param {Array<THREE.Group>} flowers - List of flower groups
 * @param {number} intensity - Bloom increment
 */
export function triggerBloom(flowers, intensity) {
    flowers.forEach(flower => {
        // Find flower center or petals to pulse
        // If it's a "Flower" type group, we can scale the whole thing or just the head
        // Let's scale slightly for a "breathing" effect or actual growth

        // Pulse glow if present
        if (flower.userData.isFlower) {
            const head = flower.children.find(c => c.children.find(sub => sub.name === 'flowerCenter'));
            // If layered flower, just scale the whole group slightly

            if (!flower.userData.maxBloom) {
                flower.userData.maxBloom = flower.scale.x * 1.3;
            }

            if (flower.scale.x < flower.userData.maxBloom) {
                const bloomRate = intensity * 0.02;
                flower.scale.addScalar(bloomRate);
            }
        }
    });
}

// --- Instancing System (Grass) ---
let grassMeshes = [];
const dummy = new THREE.Object3D();
// WebGPU uniform buffer limit is 64KB, each instance matrix is 64 bytes
// So max ~1000 instances per mesh to stay within limit
const MAX_PER_MESH = 1000;

export function initGrassSystem(scene, count = 20000) {
    grassMeshes = [];
    const height = 0.8;
    const geo = new THREE.BoxGeometry(0.05, height, 0.05);
    geo.translate(0, height / 2, 0); // Pivot at bottom

    // Grass Material with simple wind wobble in TSL
    const mat = new THREE.MeshStandardMaterial({
        color: 0x7CFC00,
        roughness: 0.8,
        metalness: 0.0
    });

    // TSL Wind Shader for Grass
    // We modify the vertex position based on time and world position
    const windSpeed = time.mul(2.0);
    const windWave = positionLocal.x.add(positionLocal.z).add(windSpeed).sin().mul(0.2);
    // Only sway the top of the blade (y > 0)
    // const sway = positionLocal.y.mul(windWave); // Unused variable warning fix? The user code computed it but didn't assign.
    // The user snippet said: "Applying TSL position modification is complex... we stick to static InstancedMesh... but we add Rim Light"

    addRimLight(mat, 0xAAFFAA);

    const meshCount = Math.ceil(count / MAX_PER_MESH);

    for (let i = 0; i < meshCount; i++) {
        const capacity = Math.min(MAX_PER_MESH, count - i * MAX_PER_MESH);
        const mesh = new THREE.InstancedMesh(geo, mat, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.receiveShadow = true;
        scene.add(mesh);
        grassMeshes.push(mesh);
    }

    return grassMeshes;
}

export function addGrassInstance(x, y, z) {
    const mesh = grassMeshes.find(m => m.count < m.instanceMatrix.count);
    if (!mesh) return;

    const index = mesh.count;

    dummy.position.set(x, y, z);
    dummy.rotation.y = Math.random() * Math.PI;
    // Scale variety
    const s = 0.8 + Math.random() * 0.4;
    dummy.scale.set(s, s, s);

    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.count++;
    mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Creates a blade of grass with variety.
 * Kept for backward compatibility if needed, but initGrassSystem is preferred for mass rendering.
 */
export function createGrass(options = {}) {
    const { color = 0x7CFC00, shape = 'tall' } = options;
    const material = createClayMaterial(color);
    let geo;
    if (shape === 'tall') {
        const height = 0.5 + Math.random();
        geo = new THREE.BoxGeometry(0.05, height, 0.05);
        geo.translate(0, height / 2, 0);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y > height * 0.5) {
                const bendFactor = (y - height * 0.5) / (height * 0.5);
                pos.setX(i, pos.getX(i) + bendFactor * 0.1);
            }
        }
    } else if (shape === 'bushy') {
        const height = 0.2 + Math.random() * 0.3;
        geo = new THREE.CylinderGeometry(0.1, 0.05, height, 8);
        geo.translate(0, height / 2, 0);
    }
    geo.computeVertexNormals();

    const blade = new THREE.Mesh(geo, material);
    blade.castShadow = true;
    blade.userData.type = 'grass';
    blade.userData.animationType = shape === 'tall' ? 'sway' : 'shiver';
    blade.userData.animationOffset = Math.random() * 10;
    return blade;
}

/**
 * Creates a detailed mushroom with gills and spots.
 * Supports 'regular' and 'giant' sizes.
 */
export function createMushroom(options = {}) {
    const {
        size = 'regular', // 'regular' or 'giant'
        scale = 1.0,
        colorIndex = -1 // -1 for random
    } = options;

    const group = new THREE.Group();
    const isGiant = size === 'giant';

    // Base dimensions
    const baseScale = isGiant ? 8.0 * scale : 1.0 * scale;
    const stemH = (1.0 + Math.random() * 0.5) * baseScale;
    const stemR = (0.15 + Math.random() * 0.1) * baseScale;
    const capR = stemR * (2.5 + Math.random()) * (isGiant ? 1.0 : 1.2);

    // 1. Stem (Curved Cylinder)
    // We use a LatheGeometry to create a slightly curved/bulbous stem for "Clay" look
    const stemPoints = [];
    for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const r = stemR * (1.0 - Math.pow(t - 0.3, 2) * 0.5); // Bulge near bottom
        const y = t * stemH;
        stemPoints.push(new THREE.Vector2(r, y));
    }
    const stemGeo = new THREE.LatheGeometry(stemPoints, 16);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.mushroomStem);
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);

    // 2. Cap (Sphere slice)
    const capGeo = new THREE.SphereGeometry(capR, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.8); // Increased segments for smooth cap
    // Determine Material and record colorIndex used
    let capMat;
    let chosenColorIndex;
    if (colorIndex >= 0 && colorIndex < foliageMaterials.mushroomCap.length) {
        chosenColorIndex = colorIndex;
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    } else {
        chosenColorIndex = Math.floor(Math.random() * foliageMaterials.mushroomCap.length);
        capMat = foliageMaterials.mushroomCap[chosenColorIndex];
    }

    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = stemH - (capR * 0.2); // Settle on top
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    // 3. Gills (Ribbed underside)
    // A cone/disc underneath with texture or ridges
    const gillGeo = new THREE.ConeGeometry(capR * 0.9, capR * 0.4, 24, 1, true); // Increased segments for smooth gills
    const gillMat = foliageMaterials.mushroomGills;
    const gill = new THREE.Mesh(gillGeo, gillMat);
    gill.position.y = stemH - (capR * 0.2);
    gill.rotation.x = Math.PI; // Face down
    group.add(gill);

    // 4. Spots (Detailed geometry)
    const spotCount = 3 + Math.floor(Math.random() * 5); // Reduced for performance
    const spotGeo = new THREE.SphereGeometry(capR * 0.15, 6, 6); // Reduced segments for performance
    const spotMat = foliageMaterials.mushroomSpots;

    // We place spots on the cap surface
    for (let i = 0; i < spotCount; i++) {
        // Random spherical coordinates on top hemisphere
        const u = Math.random();
        const v = Math.random() * 0.5; // Top half
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(1 - v); // Distribute towards top

        const x = Math.sin(phi) * Math.cos(theta) * capR;
        const y = Math.cos(phi) * capR;
        const z = Math.sin(phi) * Math.sin(theta) * capR;

        const spot = new THREE.Mesh(spotGeo, spotMat);
        // Position relative to cap center
        spot.position.set(x, y + stemH - (capR * 0.2), z);
        // Squash it flat
        spot.scale.set(1, 0.2, 1);
        spot.lookAt(0, stemH + capR, 0); // Orient outward roughly
        group.add(spot);
    }

    // 5. Face (Only for Giants)
    if (isGiant) {
        const faceGroup = new THREE.Group();
        faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);
        const faceScale = baseScale;
        faceGroup.scale.set(faceScale, faceScale, faceScale);

        const leftEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        leftEye.position.set(-0.15, 0.1, 0);
        const rightEye = new THREE.Mesh(eyeGeo, foliageMaterials.eye);
        rightEye.position.set(0.15, 0.1, 0);

        const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
        const smile = new THREE.Mesh(smileGeo, foliageMaterials.mouth);
        smile.rotation.z = Math.PI;
        smile.position.set(0, -0.05, 0);

        faceGroup.add(leftEye, rightEye, smile);
        group.add(faceGroup);
    }

    // 6. Glow (Bioluminescence)
    // 20% chance to be a "Glowing Mushroom" if regular, or always if specific type
    const isGlowing = Math.random() < 0.2;
    if (isGlowing) {
        const light = new THREE.PointLight(capMat.color, 1.0, 5.0);
        light.position.y = stemH;
        group.add(light);

        // Make cap emissive
        // We need to clone material to not make ALL mushrooms glow
        const glowMat = capMat.clone();
        glowMat.emissive = capMat.color;
        glowMat.emissiveIntensity = 0.5;
        cap.material = glowMat;
        registerReactiveMaterial(glowMat);
    }

    group.userData.animationType = pickAnimation(['wobble', 'bounce', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'mushroom';
    // Store chosen color index for wind-driven propagation and logic
    group.userData.colorIndex = typeof chosenColorIndex === 'number' ? chosenColorIndex : -1;

    return group;
}

/**
 * Creates a flower with variety.
 */
export function createFlower(options = {}) {
    const { color = null, shape = 'simple' } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 12); // Increased radial segments
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const head = new THREE.Group();
    head.position.y = stemHeight;
    group.add(head);

    const centerGeo = new THREE.SphereGeometry(0.1, 16, 16); // Increased segments for smooth center
    const center = new THREE.Mesh(centerGeo, foliageMaterials.flowerCenter);
    center.name = 'flowerCenter';
    head.add(center);

    // ADDED DETAIL: Stamens (reduced for performance)
    const stamenCount = 3; // Reduced from 5
    const stamenGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.15, 3); // Reduced segments
    stamenGeo.translate(0, 0.075, 0);
    const stamenMat = createClayMaterial(0xFFFF00);
    for (let i = 0; i < stamenCount; i++) {
        const stamen = new THREE.Mesh(stamenGeo, stamenMat);
        stamen.rotation.z = (Math.random() - 0.5) * 1.0;
        stamen.rotation.x = (Math.random() - 0.5) * 1.0;
        head.add(stamen);
    }

    let petalMat;
    if (color) {
        petalMat = createClayMaterial(color);
        registerReactiveMaterial(petalMat);
    } else {
        petalMat = foliageMaterials.flowerPetal[Math.floor(Math.random() * foliageMaterials.flowerPetal.length)];
    }

    if (shape === 'simple') {
        const petalCount = 5 + Math.floor(Math.random() * 2);
        const petalGeo = new THREE.IcosahedronGeometry(0.15, 0);
        petalGeo.scale(1, 0.5, 1);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
            petal.rotation.z = Math.PI / 4;
            head.add(petal);
        }
    } else if (shape === 'multi') {
        const petalCount = 8 + Math.floor(Math.random() * 4);
        const petalGeo = new THREE.SphereGeometry(0.12, 12, 12); // Increased segments
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 2;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(angle) * 0.2, Math.sin(i * 0.5) * 0.1, Math.sin(angle) * 0.2);
            head.add(petal);
        }
    } else if (shape === 'spiral') {
        const petalCount = 10;
        const petalGeo = new THREE.ConeGeometry(0.1, 0.2, 6);
        for (let i = 0; i < petalCount; i++) {
            const angle = (i / petalCount) * Math.PI * 4;
            const radius = 0.05 + (i / petalCount) * 0.15;
            const petal = new THREE.Mesh(petalGeo, petalMat);
            petal.position.set(Math.cos(angle) * radius, (i / petalCount) * 0.1, Math.sin(angle) * radius);
            petal.rotation.z = angle;
            head.add(petal);
        }
    } else if (shape === 'layered') {
        for (let layer = 0; layer < 2; layer++) { // Reduced from 3 for performance
            const petalCount = 5; // Reduced from 6
            const petalGeo = new THREE.IcosahedronGeometry(0.12, 0);
            petalGeo.scale(1, 0.5, 1);
            const layerColor = layer === 0 ? petalMat : createClayMaterial(color ? color + 0x111111 : 0xFFD700);
            if (layer !== 0) registerReactiveMaterial(layerColor);

            for (let i = 0; i < petalCount; i++) {
                const angle = (i / petalCount) * Math.PI * 2 + (layer * Math.PI / petalCount);
                const petal = new THREE.Mesh(petalGeo, layerColor);
                petal.position.set(
                    Math.cos(angle) * (0.15 + layer * 0.05),
                    layer * 0.05,
                    Math.sin(angle) * (0.15 + layer * 0.05)
                );
                petal.rotation.z = Math.PI / 4;
                head.add(petal);
            }
        }
    }

    if (Math.random() > 0.5) {
        const beamGeo = new THREE.ConeGeometry(0.1, 1, 8, 1, true);
        beamGeo.translate(0, 0.5, 0);
        const beamMat = foliageMaterials.lightBeam.clone();
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = stemHeight;
        beam.userData.isBeam = true;
        group.add(beam);
    }

    group.userData.animationOffset = Math.random() * 10;
    // VARIETY: Randomly choose between sway, wobble, or accordion for flowers
    group.userData.animationType = pickAnimation(['sway', 'wobble', 'accordion']);
    group.userData.type = 'flower';
    group.userData.isFlower = true;
    return group;
}

/**
 * Creates a flowering tree.
 */
export function createFloweringTree(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const trunkH = 3 + Math.random() * 2;
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkH, 16);
    // Use gradient material for trunk (dark base -> lighter top)
    const trunkMat = createGradientMaterial(0xA0724B, 0x6B4226, 0.8);
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    const bloomCount = 3 + Math.floor(Math.random() * 3); // Reduced for performance
    for (let i = 0; i < bloomCount; i++) {
        // COMPLEXITY: Blooms are now clusters of spheres, not just one
        const cluster = new THREE.Group();
        const subBlooms = 2 + Math.floor(Math.random() * 2); // Reduced for performance

        for (let j = 0; j < subBlooms; j++) {
            const bloomGeo = new THREE.SphereGeometry(0.4 + Math.random() * 0.3, 12, 12); // Increased segments
            const bloom = new THREE.Mesh(bloomGeo, bloomMat);
            bloom.position.set(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            );
            cluster.add(bloom);
        }

        cluster.position.set(
            (Math.random() - 0.5) * 2,
            trunkH + Math.random() * 1.5,
            (Math.random() - 0.5) * 2
        );
        group.add(cluster);
    }

    // Add berries to flowering trees (Magenta Pears)
    if (Math.random() > 0.4) { // 60% chance of berries
        const berries = createBerryCluster({
            color: 0xFF00AA, // Magenta
            count: 6 + Math.floor(Math.random() * 4),
            baseGlow: 0.3,
            shape: 'pear',
            size: 0.1
        });
        berries.position.set(
            (Math.random() - 0.5) * 1.5,
            trunkH + 1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(berries);
        group.userData.berries = berries; // Store reference
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
    return group;
}

/**
 * Creates a shrub with flowers.
 */
export function createShrub(options = {}) {
    const { color = 0x32CD32 } = options;
    const group = new THREE.Group();

    const baseGeo = new THREE.SphereGeometry(1 + Math.random() * 0.5, 16, 16);
    const base = new THREE.Mesh(baseGeo, createClayMaterial(color));
    base.position.y = 0.5;
    base.castShadow = true;
    group.add(base);

    const flowerMat = createClayMaterial(0xFF69B4);
    registerReactiveMaterial(flowerMat);

    const flowerCount = 2 + Math.floor(Math.random() * 2); // Reduced for performance
    for (let i = 0; i < flowerCount; i++) {
        const flowerGeo = new THREE.SphereGeometry(0.2, 6, 6); // Reduced segments
        const flower = new THREE.Mesh(flowerGeo, flowerMat);
        flower.position.set(
            (Math.random() - 0.5) * 1.5,
            1 + Math.random() * 0.5,
            (Math.random() - 0.5) * 1.5
        );
        group.add(flower);
    }

    // Add berries to shrubs (Orange Orbs)
    if (Math.random() > 0.5) { // 50% chance
        const berries = createBerryCluster({
            color: 0xFF6600, // Orange
            count: 4 + Math.floor(Math.random() * 3),
            baseGlow: 0.25,
            shape: 'sphere',
            size: 0.08
        });
        berries.position.set(
            (Math.random() - 0.5) * 1.2,
            1.2,
            (Math.random() - 0.5) * 1.2
        );
        group.add(berries);
        group.userData.berries = berries;
    }

    // VARIETY: Shrubs can bounce, shiver, or hop
    group.userData.animationType = pickAnimation(['bounce', 'shiver', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

/**
 * Creates a glowing flower with a light wash.
 */
export function createGlowingFlower(options = {}) {
    const { color = 0xFFD700, intensity = 1.5 } = options;
    const group = new THREE.Group();

    const stemHeight = 0.6 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemHeight, 6);
    stemGeo.translate(0, stemHeight / 2, 0);
    const stem = new THREE.Mesh(stemGeo, foliageMaterials.flowerStem);
    stem.castShadow = true;
    group.add(stem);

    const headGeo = new THREE.SphereGeometry(0.2, 8, 8); // Reduced segments for performance
    const headMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.8
    });
    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemHeight;
    group.add(head);

    const washGeo = new THREE.SphereGeometry(1.5, 8, 8); // Reduced segments for performance
    const wash = new THREE.Mesh(washGeo, foliageMaterials.lightBeam);
    wash.position.y = stemHeight;
    wash.userData.isWash = true;
    group.add(wash);

    // ADDED: Point Light
    const light = new THREE.PointLight(color, 0.5, 3.0);
    light.position.y = stemHeight;
    group.add(light);

    group.userData.animationType = 'glowPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createFloatingOrb(options = {}) {
    const { color = 0x87CEEB, size = 0.5 } = options;
    const geo = new THREE.SphereGeometry(size, 8, 8); // Reduced segments for performance
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 });
    registerReactiveMaterial(mat);

    const orb = new THREE.Mesh(geo, mat);
    orb.castShadow = true;
    orb.userData.animationType = 'float';
    orb.userData.animationOffset = Math.random() * 10;
    orb.userData.type = 'orb';

    // ADDED: Point Light
    const light = new THREE.PointLight(color, 0.5, 4.0);
    orb.add(light);

    return orb;
}

export function createVine(options = {}) {
    const { color = 0x228B22, length = 3 } = options;
    const group = new THREE.Group();

    for (let i = 0; i < length; i++) {
        const segmentGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8);
        const segment = new THREE.Mesh(segmentGeo, createClayMaterial(color));
        segment.position.y = i * 0.5;
        segment.rotation.z = Math.sin(i * 0.5) * 0.2;
        group.add(segment);
    }

    // VARIETY: Vine can standard sway or spiral wave
    group.userData.animationType = pickAnimation(['vineSway', 'spiralWave']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

export function createLeafParticle(options = {}) {
    const { color = 0x00ff00 } = options;
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(0.1, 0.1, 0, 0.2);
    leafShape.quadraticCurveTo(-0.1, 0.1, 0, 0);
    const geo = new THREE.ShapeGeometry(leafShape);
    const mat = createClayMaterial(color);
    const leaf = new THREE.Mesh(geo, mat);
    leaf.castShadow = true;
    return leaf;
}

export function createStarflower(options = {}) {
    const { color = 0xFF6EC7 } = options;
    const group = new THREE.Group();

    const stemH = 0.7 + Math.random() * 0.4;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, stemH, 6);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    const center = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), foliageMaterials.flowerCenter);
    center.position.y = stemH;
    group.add(center);

    const petalGeo = new THREE.ConeGeometry(0.09, 0.2, 6);
    const petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);

    const petalCount = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.16, stemH, Math.sin(angle) * 0.16);
        petal.rotation.x = Math.PI * 0.5;
        petal.rotation.z = angle;
        group.add(petal);
    }

    const beamGeo = new THREE.ConeGeometry(0.02, 8, 8, 1, true);
    beamGeo.translate(0, 4, 0);
    const beamMat = foliageMaterials.lightBeam.clone();
    beamMat.color.setHex(color);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = stemH;
    beam.userData.isBeam = true;
    group.add(beam);

    group.userData.animationType = 'spin';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'starflower';
    return group;
}

export function createBellBloom(options = {}) {
    const { color = 0xFFD27F } = options;
    const group = new THREE.Group();

    const stemH = 0.4 + Math.random() * 0.2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, stemH, 6), createClayMaterial(0x2E8B57));
    stem.castShadow = true;
    stem.position.y = 0;
    group.add(stem);

    const petalGeo = new THREE.ConeGeometry(0.12, 0.28, 10);
    const petalMat = createClayMaterial(color);
    registerReactiveMaterial(petalMat);

    const petals = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < petals; i++) {
        const p = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petals) * Math.PI * 2;
        p.position.set(Math.cos(angle) * 0.08, -0.08, Math.sin(angle) * 0.08);
        p.rotation.x = Math.PI;
        p.castShadow = true;
        group.add(p);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';
    return group;
}

export function createWisteriaCluster(options = {}) {
    const { color = 0xCFA0FF, strands = 4 } = options;
    const group = new THREE.Group();

    const bloomMat = createClayMaterial(color);
    registerReactiveMaterial(bloomMat);

    for (let s = 0; s < strands; s++) {
        const strand = new THREE.Group();
        const length = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < length; i++) {
            const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), createClayMaterial(0x2E8B57));
            seg.position.y = -i * 0.35;
            seg.rotation.z = Math.sin(i * 0.5) * 0.15;
            strand.add(seg);

            if (i > 0 && Math.random() > 0.6) {
                const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), bloomMat);
                b.position.y = seg.position.y - 0.1;
                b.position.x = (Math.random() - 0.5) * 0.06;
                b.position.z = (Math.random() - 0.5) * 0.06;
                strand.add(b);
            }
        }
        strand.position.x = (Math.random() - 0.5) * 0.6;
        strand.position.y = 0;
        group.add(strand);
    }

    group.userData.animationType = pickAnimation(['vineSway', 'spiralWave']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vine';
    return group;
}

export function createBubbleWillow(options = {}) {
    const { color = 0x8A2BE2 } = options;
    const group = new THREE.Group();

    const trunkH = 2.5 + Math.random();
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.6, trunkH, 16); // Increased segments
    const trunk = new THREE.Mesh(trunkGeo, createClayMaterial(0x5D4037));
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 4 + Math.floor(Math.random() * 2); // Reduced for performance
    const branchMat = createClayMaterial(color);
    registerReactiveMaterial(branchMat);

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        const length = 1.5 + Math.random();
        const capsuleGeo = new THREE.CapsuleGeometry(0.2, length, 8, 16);
        const capsule = new THREE.Mesh(capsuleGeo, branchMat);

        capsule.position.set(0.5, -length / 2, 0);
        capsule.rotation.z = -Math.PI / 6;

        branchGroup.add(capsule);
        group.add(branchGroup);
    }

    group.userData.animationType = 'gentleSway';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';
    return group;
}

export function createPuffballFlower(options = {}) {
    const { color = 0xFF69B4 } = options;
    const group = new THREE.Group();

    const stemH = 1.0 + Math.random() * 0.5;
    const stemGeo = new THREE.CylinderGeometry(0.1, 0.12, stemH, 8);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x6B8E23));
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const headR = 0.4 + Math.random() * 0.2;
    const headGeo = new THREE.SphereGeometry(headR, 8, 8); // Reduced segments for performance
    const headMat = createClayMaterial(color);
    registerReactiveMaterial(headMat);

    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = stemH;
    head.castShadow = true;
    group.add(head);

    const sporeCount = 4 + Math.floor(Math.random() * 4);
    const sporeGeo = new THREE.SphereGeometry(headR * 0.3, 8, 8);
    const sporeMat = createClayMaterial(color + 0x111111);
    registerReactiveMaterial(sporeMat);

    for (let i = 0; i < sporeCount; i++) {
        const spore = new THREE.Mesh(sporeGeo, sporeMat);
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const x = Math.sin(phi) * Math.cos(theta);
        const y = Math.sin(phi) * Math.sin(theta);
        const z = Math.cos(phi);

        spore.position.set(x * headR, stemH + y * headR, z * headR);
        group.add(spore);
    }

    group.userData.animationType = pickAnimation(['sway', 'accordion']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    // Trampoline properties - puffballs are bouncy!
    group.userData.isTrampoline = true;
    group.userData.bounceHeight = stemH; // Top of the puffball
    group.userData.bounceRadius = headR + 0.3; // Collision radius
    group.userData.bounceForce = 12 + Math.random() * 5; // Bounce strength

    return group;
}

export function createHelixPlant(options = {}) {
    const { color = 0x00FA9A } = options;
    const group = new THREE.Group();

    class SpiralCurve extends THREE.Curve {
        constructor(scale = 1) {
            super();
            this.scale = scale;
        }
        getPoint(t, optionalTarget = new THREE.Vector3()) {
            const tx = Math.cos(t * Math.PI * 4) * 0.2 * t * this.scale;
            const ty = t * 2.0 * this.scale;
            const tz = Math.sin(t * Math.PI * 4) * 0.2 * t * this.scale;
            return optionalTarget.set(tx, ty, tz);
        }
    }

    const path = new SpiralCurve(1.0 + Math.random() * 0.5);
    const tubeGeo = new THREE.TubeGeometry(path, 20, 0.08, 8, false);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    const mesh = new THREE.Mesh(tubeGeo, mat);
    mesh.castShadow = true;
    group.add(mesh);

    const tipGeo = new THREE.SphereGeometry(0.15, 8, 8);
    const tipMat = new THREE.MeshStandardMaterial({
        color: 0xFFFFFF, emissive: 0xFFFACD, emissiveIntensity: 0.5, roughness: 0.5
    });
    registerReactiveMaterial(tipMat);

    const tip = new THREE.Mesh(tipGeo, tipMat);
    const endPoint = path.getPoint(1);
    tip.position.copy(endPoint);
    group.add(tip);

    group.userData.animationType = pickAnimation(['spring', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

export function createBalloonBush(options = {}) {
    const { color = 0xFF4500 } = options;
    const group = new THREE.Group();

    const sphereCount = 5 + Math.floor(Math.random() * 5);
    const mat = createClayMaterial(color);
    registerReactiveMaterial(mat);

    for (let i = 0; i < sphereCount; i++) {
        const r = 0.3 + Math.random() * 0.4;
        const geo = new THREE.SphereGeometry(r, 16, 16);
        const mesh = new THREE.Mesh(geo, mat);

        mesh.position.set(
            (Math.random() - 0.5) * 0.8,
            r + (Math.random()) * 0.8,
            (Math.random() - 0.5) * 0.8
        );
        mesh.castShadow = true;
        group.add(mesh);
    }

    group.userData.animationType = pickAnimation(['bounce', 'accordion', 'hop']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'shrub';
    return group;
}

export function createRainingCloud(options = {}) {
    const {
        color = null, // null = random color
        rainIntensity = 30,
        shape = 'random', // 'fluffy', 'long', 'tall', 'random'
        size = 1.0
    } = options;

    const group = new THREE.Group();

    // Cloud color palette
    const cloudColors = [
        0xF5F5F5, // White
        0xFFE4E1, // Misty Rose  
        0xE6E6FA, // Lavender
        0xB0C4DE, // Light Steel Blue
        0xFFC0CB, // Pink
        0xDDA0DD, // Plum
        0x98FB98  // Pale Green
    ];

    const cloudColor = color !== null ? color : cloudColors[Math.floor(Math.random() * cloudColors.length)];
    const cloudMat = createClayMaterial(cloudColor);

    // Determine cloud shape
    const shapeType = shape === 'random'
        ? ['fluffy', 'long', 'tall', 'puffy'][Math.floor(Math.random() * 4)]
        : shape;

    // Create cloud based on shape
    switch (shapeType) {
        case 'fluffy': {
            // Classic fluffy cloud with 5-7 spheres
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
            // Elongated wispy cloud
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
            // Towering cumulus style
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
            // Dense, rounded cloud
            const core = new THREE.Mesh(
                new THREE.SphereGeometry(1.5 * size, 16, 16),
                cloudMat
            );
            core.castShadow = true;
            group.add(core);

            // Add bumps
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

    // Add rain particles
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

    return group;
}

/**
 * Creates a decorative cloud without rain (for sky decoration)
 */
export function createDecoCloud(options = {}) {
    return createRainingCloud({ ...options, rainIntensity: 0 });
}


export function createWaterfall(height, colorHex = 0x87CEEB) {
    const particleCount = 500; // Reduced from 2000 for better performance
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    const offsets = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 2.0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
        speeds[i] = 1.0 + Math.random() * 2.0;
        offsets[i] = Math.random() * height;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

    const mat = new PointsNodeMaterial({
        color: colorHex,
        size: 0.4,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });

    const aSpeed = attribute('aSpeed', 'float');
    const aOffset = attribute('aOffset', 'float');
    const uSpeed = uniform(1.0);
    mat.uSpeed = uSpeed;

    const t = time.mul(uSpeed);
    const fallHeight = float(height);
    const currentDist = aOffset.add(aSpeed.mul(t));
    const modDist = currentDist.mod(fallHeight);
    const newY = modDist.negate();

    mat.positionNode = vec3(
        positionLocal.x,
        newY,
        positionLocal.z
    );

    const waterfall = new THREE.Points(geo, mat);
    waterfall.userData = { animationType: 'gpuWaterfall' };
    return waterfall;
}

export function createGlowingFlowerPatch(x, z) {
    const patch = new THREE.Group();
    patch.position.set(x, 0, z);
    for (let i = 0; i < 5; i++) {
        const gf = createGlowingFlower();
        gf.position.set(Math.random() * 2 - 1, 0, Math.random() * 2 - 1);
        patch.add(gf);
    }
    return patch;
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

export function createVineCluster(x, z) {
    const cluster = new THREE.Group();
    cluster.position.set(x, 0, z);
    for (let i = 0; i < 3; i++) {
        const vine = createVine();
        vine.position.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        cluster.add(vine);
    }
    return cluster;
}

export function createPrismRoseBush(options = {}) {
    const group = new THREE.Group();

    const stemsMat = createClayMaterial(0x5D4037);
    const baseHeight = 1.0 + Math.random() * 0.5;

    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, baseHeight, 8);
    trunkGeo.translate(0, baseHeight / 2, 0);
    const trunk = new THREE.Mesh(trunkGeo, stemsMat);
    trunk.castShadow = true;
    group.add(trunk);

    const branchCount = 3 + Math.floor(Math.random() * 3);
    const roseColors = [0xFF0055, 0xFFAA00, 0x00CCFF, 0xFF00FF, 0x00FF88];

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = baseHeight * 0.8;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;
        branchGroup.rotation.z = Math.PI / 4;

        const branchLen = 0.8 + Math.random() * 0.5;
        const branchGeo = new THREE.CylinderGeometry(0.08, 0.1, branchLen, 6);
        branchGeo.translate(0, branchLen / 2, 0);
        const branch = new THREE.Mesh(branchGeo, stemsMat);
        branchGroup.add(branch);

        const roseGroup = new THREE.Group();
        roseGroup.position.y = branchLen;

        const color = roseColors[Math.floor(Math.random() * roseColors.length)];
        const petalMat = new THREE.MeshStandardMaterial({
            color: color,
            roughness: 0.7,
            emissive: 0x000000,
            emissiveIntensity: 0.0
        });
        registerReactiveMaterial(petalMat);

        const outerGeo = new THREE.TorusKnotGeometry(0.25, 0.08, 64, 8, 2, 3);
        const outer = new THREE.Mesh(outerGeo, petalMat);
        outer.scale.set(1, 0.6, 1);
        roseGroup.add(outer);

        const innerGeo = new THREE.SphereGeometry(0.15, 8, 8); // Reduced segments for performance
        const inner = new THREE.Mesh(innerGeo, petalMat);
        inner.position.y = 0.05;
        roseGroup.add(inner);

        const washGeo = new THREE.SphereGeometry(1.2, 8, 8); // Reduced segments for performance
        const washMat = foliageMaterials.lightBeam.clone();
        washMat.color.setHex(color);
        const wash = new THREE.Mesh(washGeo, washMat);
        wash.userData.isWash = true;
        roseGroup.add(wash);

        branchGroup.add(roseGroup);
        group.add(branchGroup);
    }

    group.userData.animationType = pickAnimation(['sway', 'wobble']);
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'flower';

    return group;
}

/**
 * 1. The Subwoofer Lotus
 * Hovering lily pad that acts as a speaker cone.
 */
export function createSubwooferLotus(options = {}) {
    const { color = 0x2E8B57 } = options;
    const group = new THREE.Group();

    // The Pad (Speaker Cone)
    const padGeo = new THREE.CylinderGeometry(1.5, 0.2, 0.5, 16);
    padGeo.translate(0, 0.25, 0); // Pivot at bottom
    const padMat = createClayMaterial(color);
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.castShadow = true;
    pad.receiveShadow = true;

    // Add "Equalizer" Rings on top
    const ringMat = foliageMaterials.lotusRing.clone(); // Clone to animate independently
    ringMat.emissive.setHex(0x000000);
    // We register it specially to handle manually in updateFoliageMaterials
    pad.userData.ringMaterial = ringMat;

    for (let i = 1; i <= 3; i++) {
        const ringGeo = new THREE.TorusGeometry(i * 0.3, 0.05, 8, 24);
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.51; // Sit just on top
        pad.add(ring);
    }

    group.add(pad);

    group.userData.animationType = 'speakerPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'lotus';

    return group;
}

/**
 * 2. The Accordion Palm
 * Pleated trunk that stretches.
 */
export function createAccordionPalm(options = {}) {
    const { color = 0xFFD700 } = options;
    const group = new THREE.Group();

    const trunkHeight = 3.0;
    const segments = 10;
    const trunkGroup = new THREE.Group(); // Separate group for scaling

    const pleatGeo = new THREE.TorusGeometry(0.3, 0.15, 8, 16);
    const pleatMat = createClayMaterial(0x8B4513); // Brown wood

    for (let i = 0; i < segments; i++) {
        const pleat = new THREE.Mesh(pleatGeo, pleatMat);
        pleat.rotation.x = Math.PI / 2;
        pleat.position.y = i * (trunkHeight / segments);
        // Alternate colors for "Barber pole" effect
        if (i % 2 === 0) {
            pleat.material = createClayMaterial(0xA0522D);
        }
        trunkGroup.add(pleat);
    }
    group.add(trunkGroup);

    // Leaves on top
    const leafCount = 6;
    const leafGeo = new THREE.CylinderGeometry(0.05, 0.1, 1.5, 8);
    leafGeo.translate(0, 0.75, 0); // Pivot at base
    const leafMat = createClayMaterial(color);
    registerReactiveMaterial(leafMat);

    const headGroup = new THREE.Group();
    headGroup.position.y = trunkHeight;
    trunkGroup.add(headGroup); // Attach to trunk so it moves up/down

    for (let i = 0; i < leafCount; i++) {
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.rotation.z = Math.PI / 3;
        leaf.rotation.y = (i / leafCount) * Math.PI * 2;
        headGroup.add(leaf);
    }

    group.userData.animationType = 'accordionStretch';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tree';

    // Store reference to trunk for animation
    group.userData.trunk = trunkGroup;

    return group;
}

/**
 * 3. The Fiber-Optic Weeping Willow
 * Glowing cables that whip around.
 */
export function createFiberOpticWillow(options = {}) {
    const { color = 0xFFFFFF } = options;
    const group = new THREE.Group();

    // Trunk
    const trunkH = 2.5 + Math.random();
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.4, trunkH, 12),
        createClayMaterial(0x222222) // Dark trunk to contrast lights
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    group.add(trunk);

    // Cable Branches
    const branchCount = 8; // Reduced from 12 for performance
    const cableMat = foliageMaterials.opticCable;

    // Each tip needs a unique material to flash independently? 
    // For performance, we'll share one reactive material for tips
    const tipMat = foliageMaterials.opticTip.clone();
    registerReactiveMaterial(tipMat); // Will pulse with music

    for (let i = 0; i < branchCount; i++) {
        const branchGroup = new THREE.Group();
        branchGroup.position.y = trunkH * 0.9;
        branchGroup.rotation.y = (i / branchCount) * Math.PI * 2;

        // The "Cable" (Curve approximated by thin cylinder segments)
        // A simple hanging cylinder that we will rotate
        const len = 1.5 + Math.random();
        const cableGeo = new THREE.CylinderGeometry(0.02, 0.02, len, 4);
        cableGeo.translate(0, -len / 2, 0); // Hang down
        const cable = new THREE.Mesh(cableGeo, cableMat);

        // Rotate out slightly
        cable.rotation.z = Math.PI / 4;

        // The Glowing Tip
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), tipMat);
        tip.position.y = -len;
        cable.add(tip);

        branchGroup.add(cable);
        group.add(branchGroup);
    }

    group.userData.animationType = 'fiberWhip';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'willow';

    return group;
}

/**
 * 4. Vibrato Violets
 * Bioluminescent flowers with vibrating membrane petals that shake with audio vibrato.
 * From plan.md Category 1: Melodic Flora
 */
export function createVibratoViolet(options = {}) {
    const { color = 0x8A2BE2, intensity = 1.0 } = options; // Blue Violet default
    const group = new THREE.Group();

    // Stem
    const stemH = 0.5 + Math.random() * 0.3;
    const stemGeo = new THREE.CylinderGeometry(0.03, 0.04, stemH, 8);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    // Flower head group (will vibrate)
    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    // Center - bioluminescent core
    const centerGeo = new THREE.SphereGeometry(0.08, 12, 12);
    const centerMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.8 * intensity,
        roughness: 0.3
    });
    registerReactiveMaterial(centerMat);
    const center = new THREE.Mesh(centerGeo, centerMat);
    headGroup.add(center);

    // Membrane petals (thin, translucent, will vibrate)
    const petalCount = 5;
    const petalGeo = new THREE.CircleGeometry(0.15, 8);
    const petalMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.4 * intensity,
        roughness: 0.4,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
    });
    registerReactiveMaterial(petalMat);

    for (let i = 0; i < petalCount; i++) {
        const petal = new THREE.Mesh(petalGeo, petalMat);
        const angle = (i / petalCount) * Math.PI * 2;
        petal.position.set(Math.cos(angle) * 0.12, 0, Math.sin(angle) * 0.12);
        petal.rotation.x = -Math.PI / 2 + Math.random() * 0.3;
        petal.rotation.z = angle;
        petal.userData.vibratoPhase = Math.random() * Math.PI * 2;
        headGroup.add(petal);
    }

    // Add a subtle point light for glow
    const light = new THREE.PointLight(color, 0.3 * intensity, 2.0);
    light.position.y = 0;
    headGroup.add(light);

    group.userData.animationType = 'vibratoShake';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'vibratoViolet';
    group.userData.headGroup = headGroup;

    return group;
}

/**
 * 5. Tremolo Tulips
 * Tall bell flowers that pulse scale and opacity with audio tremolo.
 * From plan.md Category 1: Melodic Flora
 */
export function createTremoloTulip(options = {}) {
    const { color = 0xFF6347, size = 1.0 } = options; // Tomato color default
    const group = new THREE.Group();

    // Stem
    const stemH = (0.8 + Math.random() * 0.4) * size;
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.06, stemH, 8);
    stemGeo.translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, createClayMaterial(0x228B22));
    stem.castShadow = true;
    group.add(stem);

    // Bell-shaped flower head (will pulse)
    const headGroup = new THREE.Group();
    headGroup.position.y = stemH;
    group.add(headGroup);

    // Bell geometry - inverted cone
    const bellGeo = new THREE.CylinderGeometry(0.2 * size, 0.05 * size, 0.25 * size, 12, 1, true);
    bellGeo.translate(0, -0.125 * size, 0);
    const bellMat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.3,
        roughness: 0.5,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide
    });
    registerReactiveMaterial(bellMat);
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.rotation.x = Math.PI; // Flip to face down
    headGroup.add(bell);

    // Inner vortex light (stores/expels energy per plan.md)
    const vortexGeo = new THREE.SphereGeometry(0.08 * size, 8, 8);
    const vortexMat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending
    });
    const vortex = new THREE.Mesh(vortexGeo, vortexMat);
    vortex.position.y = -0.1 * size;
    headGroup.add(vortex);
    group.userData.vortex = vortex;

    // Rim lighting effect - subtle glow ring
    const rimGeo = new THREE.TorusGeometry(0.2 * size, 0.02, 8, 16);
    const rimMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02 * size;
    headGroup.add(rim);

    group.userData.animationType = 'tremeloPulse';
    group.userData.animationOffset = Math.random() * 10;
    group.userData.type = 'tremoloTulip';
    group.userData.headGroup = headGroup;
    group.userData.bellMaterial = bellMat;

    return group;
}

/**
 * 6. Kick-Drum Geysers
 * Fissures that vent gas/plasma with force scaled by kick drum velocity.
 * From plan.md Category 2: Rhythmic Structures
 */
export function createKickDrumGeyser(options = {}) {
    const { color = 0xFF4500, maxHeight = 5.0 } = options; // Orange-red default
    const group = new THREE.Group();

    // Base fissure (crack in ground)
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

    // Glowing inner core
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

    // Plume particle system (will be animated)
    const plumeCount = 50;
    const plumeGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(plumeCount * 3);
    const velocities = new Float32Array(plumeCount);

    for (let i = 0; i < plumeCount; i++) {
        // Start at base
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
    plume.visible = false; // Start hidden, show on kick
    group.add(plume);

    // Point light for eruption glow
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
    group.userData.eruptionStrength = 0; // Current eruption power (0-1)

    return group;
}

// --- UPDATED ANIMATION LOGIC ---
// freqToHue is now imported from wasm-loader.js (WASM with JS fallback)


/**
 * Apply wet surface effects to materials during rain/storm
 * @param {THREE.Material} material - Material to modify
 * @param {number} wetAmount - Wetness factor (0-1)
 */
function applyWetEffect(material, wetAmount) {
    // Store original values on first application
    if (material.userData.dryRoughness === undefined) {
        material.userData.dryRoughness = material.roughness;
        material.userData.dryMetalness = material.metalness || 0;
        material.userData.dryColor = material.color.clone();
    }
    
    // Wet surfaces are more reflective (lower roughness)
    const targetRoughness = THREE.MathUtils.lerp(material.userData.dryRoughness, 0.2, wetAmount);
    material.roughness = targetRoughness;
    
    // Slight metallic sheen when wet
    const targetMetalness = THREE.MathUtils.lerp(material.userData.dryMetalness, 0.15, wetAmount);
    if (material.metalness !== undefined) {
        material.metalness = targetMetalness;
    }
    
    // Darken color when wet
    if (material.color) {
        const darkColor = material.userData.dryColor.clone().multiplyScalar(1 - wetAmount * 0.3);
        material.color.lerp(darkColor, 0.1); // Smooth transition
    }
}

/**
 * Update materials based on weather state
 * @param {Array} materials - Array of materials to update
 * @param {string} weatherState - Current weather state ('clear', 'rain', 'storm')
 * @param {number} weatherIntensity - Weather intensity (0-1)
 */
export function updateMaterialsForWeather(materials, weatherState, weatherIntensity) {
    materials.forEach(mat => {
        if (!mat || !mat.isMaterial) return;
        
        let wetAmount = 0;
        
        if (weatherState === 'rain') {
            wetAmount = weatherIntensity * 0.5; // 0 to 0.5
        } else if (weatherState === 'storm') {
            wetAmount = weatherIntensity * 0.8; // 0 to 0.8
        }
        
        applyWetEffect(mat, wetAmount);
    });
}

export function updateFoliageMaterials(audioData, isNight, weatherState = null, weatherIntensity = 0) {
    if (!audioData) return;

    if (isNight) {
        const channels = audioData.channelData;
        if (!channels || channels.length === 0) return;

        // 1. Generic Reactive Materials (Petals, Willow Tips)
        reactiveMaterials.forEach((mat, i) => {
            const chIndex = (i % 4) + 1; // Cycle through melody channels
            const ch = channels[Math.min(chIndex, channels.length - 1)];

            if (ch && ch.freq > 0) {
                const hue = freqToHue(ch.freq);
                const color = new THREE.Color().setHSL(hue, 1.0, 0.6);
                if (mat.isMeshBasicMaterial) {
                    mat.color.lerp(color, 0.3); // Willow tips are basic
                } else {
                    mat.emissive.lerp(color, 0.3);
                }
            }
            // Flash on trigger
            const intensity = 0.2 + (ch?.volume || 0) + (ch?.trigger || 0) * 2.0;
            if (mat.isMeshBasicMaterial) {
                // Basic materials don't have emissive intensity, modulate color brightness
                // This is a hack for the willow tips
            } else {
                mat.emissiveIntensity = intensity;
            }
        });

    } else {
        // Reset Day State
        reactiveMaterials.forEach(mat => {
            if (mat.emissive) {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
            }
        });
    }
    
    // Apply weather effects to all reactive materials
    if (weatherState && weatherIntensity > 0) {
        updateMaterialsForWeather(reactiveMaterials, weatherState, weatherIntensity);
    }
}

export function animateFoliage(foliageObject, time, audioData, isDay, isDeepNight = false) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType;

    // Deep Night Sleep Logic
    if (isDeepNight) {
        // Special Glowing Flowers stay awake and active
        const isNightFlower = foliageObject.userData.type === 'flower' && foliageObject.userData.animationType === 'glowPulse';

        if (!isNightFlower) {
            // Everything else sleeps (slow shiver)
            // Use calcShiver or JS equivalent
            // calcShiver(t, speed, amount)
            const sleepSpeed = 0.5;
            const sleepAmount = 0.02;
            const shiver = Math.sin(time * sleepSpeed + offset) * sleepAmount;

            foliageObject.rotation.z = shiver;
            foliageObject.rotation.x = shiver * 0.5;

            // Return early - no audio reactivity during sleep
            return;
        }
    }

    // Audio Data
    let kick = 0, groove = 0, beatPhase = 0, leadVol = 0;
    if (audioData) {
        kick = audioData.kickTrigger || 0;
        groove = audioData.grooveAmount || 0;
        beatPhase = audioData.beatPhase || 0;
        leadVol = audioData.channelData?.[2]?.volume || 0;
    }

    const isActive = !isDay; // Most new anims are cooler at night
    const intensity = isActive ? (1.0 + groove * 5.0) : 0.2;
    const animTime = time + beatPhase;

    // --- 1. Speaker Pulse (Subwoofer Lotus) ---
    if (type === 'speakerPulse') {
        // Float hover
        foliageObject.position.y = (foliageObject.userData.originalY || 0) + Math.sin(time + offset) * 0.2;

        // Pump on Kick
        const pump = kick * 0.5; // 0..0.5
        const pad = foliageObject.children[0];
        if (pad) {
            pad.scale.set(1.0 + pump * 0.2, 1.0 - pump * 0.5, 1.0 + pump * 0.2);

            // Light up rings if night
            if (isActive && pad.userData.ringMaterial) {
                const ringMat = pad.userData.ringMaterial;
                // Red/Orange glow for bass
                const glow = pump * 5.0;
                ringMat.emissive.setHSL(0.0 + pump * 0.2, 1.0, 0.5);
                ringMat.emissiveIntensity = glow;
            }
        }
    }

    // --- 2. Accordion Stretch (Accordion Palm) ---
    else if (type === 'accordionStretch') {
        const trunkGroup = foliageObject.userData.trunk;
        if (trunkGroup) {
            // Stretch on beat phase
            // beatPhase goes 0..1. We want a stretch at the start.
            const stretch = 1.0 + Math.max(0, Math.sin(animTime * 10 + offset)) * 0.3 * intensity;
            trunkGroup.scale.y = stretch;
            // Squash width to preserve volume
            const width = 1.0 / Math.sqrt(stretch);
            trunkGroup.scale.x = width;
            trunkGroup.scale.z = width;
        }
    }

    // --- 3. Fiber Whip (Willow) ---
    else if (type === 'fiberWhip') {
        // Sway gently base
        foliageObject.rotation.y = Math.sin(time * 0.5 + offset) * 0.1;

        // Whip branches on Lead Volume
        const whip = leadVol * 2.0; // 0..2.0
        foliageObject.children.forEach((branchGroup, i) => {
            if (branchGroup === foliageObject.children[0]) return; // Skip trunk

            // Whip calculation
            const childOffset = i * 0.5;
            const cable = branchGroup.children[0];

            // Standard Sway
            let rotZ = Math.PI / 4 + Math.sin(time * 2 + childOffset) * 0.1;

            // Add Whip
            if (isActive) {
                rotZ += Math.sin(time * 10 + childOffset) * whip;
                // Add color to tip if we can access it
                const tip = cable.children[0];
                if (tip) {
                    // Random tip flicker
                    tip.visible = Math.random() < (0.5 + whip);
                }
            }

            if (cable) cable.rotation.z = rotZ;
        });
    }

    // --- KEEP EXISTING ANIMATIONS ---
    else if (type === 'bounce') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(animTime * 3 + offset) * 0.1 * intensity;
        if (isActive && kick > 0.1) foliageObject.position.y += kick * 0.2;
    }
    else if (type === 'sway') {
        foliageObject.rotation.z = Math.sin(time + offset) * 0.1 * intensity;
    }
    else if (type === 'wobble') {
        foliageObject.rotation.x = Math.sin(animTime * 3 + offset) * 0.15 * intensity;
        foliageObject.rotation.z = Math.cos(animTime * 3 + offset) * 0.15 * intensity;
    }
    else if (type === 'accordion') {
        // Fallback if trunk group not set (e.g. mushrooms)
        const target = foliageObject.userData.trunk || foliageObject;
        const stretch = 1.0 + Math.max(0, Math.sin(animTime * 10 + offset)) * 0.3 * intensity;
        target.scale.y = stretch;
        // Squash width if it's the accordion tree trunk, otherwise maybe just stretch y
        if (foliageObject.userData.trunk) {
            const w = 1.0 / Math.sqrt(stretch);
            target.scale.x = w;
            target.scale.z = w;
        }
    }
    else if (type === 'hop') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        const hopTime = animTime * 4 + offset;
        const bounce = Math.max(0, Math.sin(hopTime)) * 0.3 * intensity;
        foliageObject.position.y = y + bounce;
        if (isActive && kick > 0.1) foliageObject.position.y += kick * 0.15;
    }
    else if (type === 'shiver') {
        const shiver = Math.sin(animTime * 20 + offset) * 0.05 * intensity;
        foliageObject.rotation.z = shiver;
        foliageObject.rotation.x = shiver * 0.5;
    }
    else if (type === 'spring') {
        const springTime = animTime * 5 + offset;
        foliageObject.scale.y = 1.0 + Math.sin(springTime) * 0.1 * intensity;
        foliageObject.scale.x = 1.0 - Math.sin(springTime) * 0.05 * intensity;
        foliageObject.scale.z = 1.0 - Math.sin(springTime) * 0.05 * intensity;
    }
    else if (type === 'gentleSway') {
        foliageObject.rotation.z = Math.sin(time * 0.5 + offset) * 0.05 * intensity;
    }
    else if (type === 'vineSway') {
        foliageObject.rotation.z = Math.sin(time * 1.5 + offset) * 0.2 * intensity;
        foliageObject.rotation.x = Math.cos(time * 1.2 + offset) * 0.1 * intensity;
    }
    else if (type === 'spiralWave') {
        foliageObject.children.forEach((child, i) => {
            child.rotation.y = Math.sin(time * 2 + offset + i * 0.5) * 0.3 * intensity;
        });
    }
    else if (type === 'float') {
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 2 + offset) * 0.5 * intensity;
    }
    else if (type === 'spin') {
        foliageObject.rotation.y += 0.01 * intensity;
    }
    else if (type === 'glowPulse') {
        // Material pulsing is handled in updateFoliageMaterials
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 2 + offset) * 0.1;
    }
    else if (type === 'rain') {
        // Animate rain particles
        const rainChild = foliageObject.children.find(c => c.type === 'Points');
        if (rainChild && rainChild.geometry && rainChild.geometry.attributes.position) {
            const positions = rainChild.geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                positions[i + 1] -= 0.1;
                if (positions[i + 1] < -6) positions[i + 1] = 0;
            }
            rainChild.geometry.attributes.position.needsUpdate = true;
        }
        // Also bob the cloud gently
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 0.3 + offset) * 0.2;
    }
    else if (type === 'cloudBob') {
        // Gentle bobbing for decorative clouds
        const y = foliageObject.userData.originalY ?? foliageObject.position.y;
        foliageObject.userData.originalY = y;
        foliageObject.position.y = y + Math.sin(time * 0.5 + offset) * 0.3;
        // Slight rotation drift
        foliageObject.rotation.y = Math.sin(time * 0.2 + offset * 0.5) * 0.05;
    }

    // --- 4. Vibrato Shake (Vibrato Violets) ---
    else if (type === 'vibratoShake') {
        const headGroup = foliageObject.userData.headGroup;
        if (headGroup) {
            // Get vibrato effect from audio channels
            // Effect code 4xx in MOD files maps to activeEffect: 1 in audio-system.js
            let vibratoAmount = 0;
            if (audioData && audioData.channelData) {
                for (const ch of audioData.channelData) {
                    if (ch.activeEffect === 1) { // 4xx Vibrato → activeEffect: 1
                        vibratoAmount = Math.max(vibratoAmount, ch.effectValue || 0);
                    }
                }
            }
            // Also react to general audio activity
            vibratoAmount = Math.max(vibratoAmount, groove * 0.5);

            // High-frequency shake for membrane petals
            const shakeSpeed = 25 + vibratoAmount * 50;
            const shakeAmount = 0.02 + vibratoAmount * 0.15;
            
            headGroup.children.forEach((child, i) => {
                if (i === 0) return; // Skip center
                const phase = child.userData.vibratoPhase || (i * 0.5);
                child.rotation.x = -Math.PI / 2 + Math.sin(time * shakeSpeed + phase) * shakeAmount;
                child.rotation.y = Math.cos(time * shakeSpeed * 0.7 + phase) * shakeAmount * 0.5;
            });

            // Gentle sway for whole head
            headGroup.rotation.z = Math.sin(time * 2 + offset) * 0.05 * intensity;
        }
    }

    // --- 5. Tremolo Pulse (Tremolo Tulips) ---
    else if (type === 'tremeloPulse') {
        const headGroup = foliageObject.userData.headGroup;
        const bellMat = foliageObject.userData.bellMaterial;
        const vortex = foliageObject.userData.vortex;

        // Get tremolo effect from audio channels
        // Effect code 7xx in MOD files maps to activeEffect: 3 in audio-system.js
        let tremoloAmount = 0;
        if (audioData && audioData.channelData) {
            for (const ch of audioData.channelData) {
                if (ch.activeEffect === 3) { // 7xx Tremolo → activeEffect: 3
                    tremoloAmount = Math.max(tremoloAmount, ch.effectValue || 0);
                }
            }
        }
        // Also react to beat phase
        tremoloAmount = Math.max(tremoloAmount, Math.sin(beatPhase * Math.PI * 2) * 0.3);

        if (headGroup) {
            // Pulse scale with tremolo
            const pulseSpeed = 8 + tremoloAmount * 15;
            const pulseAmount = 0.1 + tremoloAmount * 0.3;
            const pulse = 1.0 + Math.sin(time * pulseSpeed + offset) * pulseAmount;
            
            headGroup.scale.set(pulse, pulse, pulse);
            
            // Pulse opacity
            if (bellMat) {
                bellMat.opacity = 0.7 + Math.sin(time * pulseSpeed + offset) * 0.2 * intensity;
                bellMat.emissiveIntensity = 0.3 + tremoloAmount * 0.7;
            }

            // Vortex interior pulses inversely (stores energy at min, expels at max)
            if (vortex) {
                vortex.scale.setScalar(1.0 - Math.sin(time * pulseSpeed + offset) * 0.4);
                vortex.material.opacity = 0.3 + Math.sin(time * pulseSpeed + offset + Math.PI) * 0.4;
            }
        }

        // Gentle sway
        foliageObject.rotation.z = Math.sin(time + offset) * 0.03 * intensity;
    }

    // --- 6. Geyser Eruption (Kick-Drum Geysers) ---
    else if (type === 'geyserErupt') {
        const plume = foliageObject.userData.plume;
        const plumeLight = foliageObject.userData.plumeLight;
        const coreMat = foliageObject.userData.coreMaterial;
        const maxHeight = foliageObject.userData.maxHeight || 5.0;

        // Eruption triggered by kick drum
        const kickThreshold = 0.3;
        let eruptionStrength = foliageObject.userData.eruptionStrength || 0;

        if (kick > kickThreshold) {
            // Trigger eruption based on kick strength
            eruptionStrength = Math.min(1.0, eruptionStrength + kick * 0.5);
        } else {
            // Decay eruption
            eruptionStrength = Math.max(0, eruptionStrength - 0.03);
        }
        foliageObject.userData.eruptionStrength = eruptionStrength;

        // Show/hide plume based on eruption
        if (plume) {
            plume.visible = eruptionStrength > 0.05;

            if (plume.visible && plume.geometry.attributes.position) {
                const positions = plume.geometry.attributes.position.array;
                const velocities = plume.geometry.attributes.velocity.array;
                const currentMaxH = maxHeight * eruptionStrength;

                for (let i = 0; i < positions.length / 3; i++) {
                    const idx = i * 3;
                    const vel = velocities[i];

                    // Move particles upward
                    positions[idx + 1] += vel * eruptionStrength * 0.3;

                    // Add horizontal spread at height
                    const heightRatio = positions[idx + 1] / currentMaxH;
                    positions[idx] += (Math.random() - 0.5) * 0.02 * heightRatio;
                    positions[idx + 2] += (Math.random() - 0.5) * 0.02 * heightRatio;

                    // Reset if too high
                    if (positions[idx + 1] > currentMaxH || positions[idx + 1] < 0) {
                        positions[idx] = (Math.random() - 0.5) * 0.2;
                        positions[idx + 1] = 0;
                        positions[idx + 2] = (Math.random() - 0.5) * 0.2;
                    }
                }
                plume.geometry.attributes.position.needsUpdate = true;
            }

            // Update plume material opacity
            plume.material.opacity = 0.5 + eruptionStrength * 0.5;
        }

        // Update light intensity
        if (plumeLight) {
            plumeLight.intensity = eruptionStrength * 2.0;
            plumeLight.position.y = 1 + eruptionStrength * maxHeight * 0.3;
        }

        // Core glow pulses with eruption
        if (coreMat) {
            coreMat.emissiveIntensity = 0.3 + eruptionStrength * 1.5 + Math.sin(time * 20) * 0.2 * eruptionStrength;
        }
    }
}

// =============================================================================
// FIREFLY PARTICLE SYSTEM (Deep Night Enhancement)
// =============================================================================

/**
 * Creates a firefly particle system for Deep Night ambiance
 * @param {number} count - Number of fireflies
 * @param {number} areaSize - Size of spawn area
 * @returns {THREE.Points}
 */
export function createFireflies(count = 80, areaSize = 100) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        // Random position in area, near ground
        positions[i * 3] = (Math.random() - 0.5) * areaSize;
        positions[i * 3 + 1] = 0.5 + Math.random() * 4; // 0.5 to 4.5 units high
        positions[i * 3 + 2] = (Math.random() - 0.5) * areaSize;

        // Random phase offset for asynchronous blinking
        phases[i] = Math.random() * Math.PI * 2;

        // Random blink speed
        speeds[i] = 0.5 + Math.random() * 1.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    // TSL-based material with blinking effect
    const mat = new PointsNodeMaterial({
        size: 0.2,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    // Blink pattern: sin wave with phase offset, clamped to create on/off effect
    const phaseAttr = attribute('phase');
    const speedAttr = attribute('speed');
    const blink = sin(time.mul(speedAttr).add(phaseAttr));

    // Sharp blink: only glow when sin > 0.7
    const glowIntensity = blink.sub(0.7).max(0.0).mul(3.33); // 0 to 1

    // Warm yellow-green firefly color
    const fireflyColor = mix(
        color(0x88FF00), // Green
        color(0xFFFF00), // Yellow
        glowIntensity
    );

    mat.colorNode = fireflyColor.mul(glowIntensity.add(0.1)); // Always slightly visible
    mat.opacityNode = glowIntensity.add(0.05).min(1.0);

    const fireflies = new THREE.Points(geo, mat);
    fireflies.userData.isFireflies = true;
    fireflies.visible = false; // Start hidden, show during Deep Night

    return fireflies;
}

/**
 * Update firefly positions for gentle drifting motion
 * @param {THREE.Points} fireflies - The firefly particle system
 * @param {number} time - Current time
 * @param {number} delta - Time delta
 */
export function updateFireflies(fireflies, time, delta) {
    if (!fireflies || !fireflies.visible) return;

    const positions = fireflies.geometry.attributes.position.array;
    const phases = fireflies.geometry.attributes.phase.array;

    for (let i = 0; i < positions.length / 3; i++) {
        const idx = i * 3;
        const phase = phases[i];

        // Gentle drift using sin/cos
        const driftX = Math.sin(time * 0.3 + phase) * 0.02;
        const driftY = Math.cos(time * 0.5 + phase * 1.3) * 0.01;
        const driftZ = Math.sin(time * 0.4 + phase * 0.7) * 0.02;

        positions[idx] += driftX;
        positions[idx + 1] += driftY;
        positions[idx + 2] += driftZ;

        // Keep within bounds (wrap around)
        if (positions[idx] > 50) positions[idx] = -50;
        if (positions[idx] < -50) positions[idx] = 50;
        if (positions[idx + 1] < 0.3) positions[idx + 1] = 0.3;
        if (positions[idx + 1] > 5) positions[idx + 1] = 5;
        if (positions[idx + 2] > 50) positions[idx + 2] = -50;
        if (positions[idx + 2] < -50) positions[idx + 2] = 50;
    }

    fireflies.geometry.attributes.position.needsUpdate = true;
}
// =============================================================================
// VINE SWINGING PHYSICS
// =============================================================================

export class VineSwing {
    constructor(vineMesh, length = 8) {
        this.vine = vineMesh;
        this.anchorPoint = vineMesh.position.clone(); // Mesh origin is top
        this.length = length;
        this.isPlayerAttached = false;
        this.swingAngle = 0;
        this.swingAngularVel = 0;
        this.swingPlane = new THREE.Vector3(1, 0, 0);
        this.rotationAxis = new THREE.Vector3(0, 0, 1);
        this.defaultDown = new THREE.Vector3(0, -1, 0);
    }

    update(player, delta, inputState) {
        const gravity = 20.0;
        const damping = 0.99;

        // Physics Update
        const angularAccel = (-gravity / this.length) * Math.sin(this.swingAngle);
        this.swingAngularVel += angularAccel * delta;
        this.swingAngularVel *= damping;

        // Player Input (Pump the swing)
        if (this.isPlayerAttached && inputState) {
            if (inputState.forward) {
                this.swingAngularVel += 2.0 * delta * Math.cos(this.swingAngle);
            } else if (inputState.backward) {
                this.swingAngularVel -= 2.0 * delta * Math.cos(this.swingAngle);
            }
        }

        this.swingAngle += this.swingAngularVel * delta;

        // Determine Position
        // Vertical drop/rise
        const dy = -Math.cos(this.swingAngle) * this.length;
        // Horizontal displacement
        const dh = Math.sin(this.swingAngle) * this.length;

        // Target World Position
        const targetPos = this.anchorPoint.clone();
        targetPos.y += dy;
        targetPos.addScaledVector(this.swingPlane, dh);

        // Apply to Player
        if (this.isPlayerAttached) {
            player.position.copy(targetPos);
            // Optional: Rotate player to face swing direction?
            // player.lookAt(targetPos.clone().add(this.swingPlane));

            // Sync velocity for smooth release
            // We approximate velocity vector from angular velocity
            // This isn't perfect "physics" state for Three.js velocity,
            // but we calc it on detach.
        }

        // Apply to Vine Mesh (Visuals)
        const dir = new THREE.Vector3().subVectors(targetPos, this.anchorPoint).normalize();
        this.vine.quaternion.setFromUnitVectors(this.defaultDown, dir);
    }

    attach(player, playerVelocity) {
        this.isPlayerAttached = true;

        // 1. Determine Swing Plane from Entry Velocity
        const horizVel = new THREE.Vector3(playerVelocity.x, 0, playerVelocity.z);
        if (horizVel.lengthSq() > 1.0) {
            this.swingPlane.copy(horizVel.normalize());
        } else {
            // Default to direction from anchor to player if stationary
            const toPlayer = new THREE.Vector3().subVectors(player.position, this.anchorPoint);
            toPlayer.y = 0;
            if (toPlayer.lengthSq() > 0.1) {
                this.swingPlane.copy(toPlayer.normalize());
            }
        }

        // 2. Determine Initial Angle
        // Project current player position onto the swing plane arc to prevent snapping
        const toPlayer = new THREE.Vector3().subVectors(player.position, this.anchorPoint);
        const dy = toPlayer.y;
        const dh = toPlayer.dot(this.swingPlane);
        this.swingAngle = Math.atan2(dh, -dy);

        // 3. Transfer Velocity (Conserve momentum)
        // Tangential velocity component
        // v_tangent = v_linear dot tangent_vector
        // tangent vector at angle theta is (cos theta, sin theta) relative to (horiz, vert)
        const cosA = Math.cos(this.swingAngle);
        const sinA = Math.sin(this.swingAngle);

        // Player V projected onto plane
        const vH = horizVel.length() * (playerVelocity.dot(this.swingPlane) > 0 ? 1 : -1);
        const vY = playerVelocity.y;

        // Tangent vec roughly: H component is cosA, Y component is sinA
        const vTangential = vH * cosA + vY * sinA;

        this.swingAngularVel = vTangential / this.length;
    }

    detach(player) {
        this.isPlayerAttached = false;

        // Convert angular velocity to linear velocity
        const tangentVel = this.swingAngularVel * this.length;
        const cosA = Math.cos(this.swingAngle);
        const sinA = Math.sin(this.swingAngle);

        // Tangent direction vectors
        const vH = tangentVel * cosA;
        const vY = tangentVel * sinA;

        player.velocity.x = this.swingPlane.x * vH;
        player.velocity.z = this.swingPlane.z * vH;
        player.velocity.y = vY;

        // Small jump boost for better feel
        player.velocity.y += 5.0;

        // Prevent immediate re-attach
        return Date.now();
    }
}

export function createSwingableVine(options = {}) {
    const { length = 12, color = 0x2E8B57 } = options;
    const group = new THREE.Group();

    // Visuals: Segmented Vine
    const segmentCount = 8;
    const segLen = length / segmentCount;

    // We create a container that will rotate.
    // The "group" is the anchor object (placed at top).
    // But we need the mesh to be pivotable.
    // VineSwing rotates 'this.vine', which is 'group'.

    // Main stem
    for (let i = 0; i < segmentCount; i++) {
        const geo = new THREE.CylinderGeometry(0.15, 0.12, segLen, 6);
        geo.translate(0, -segLen/2, 0); // Pivot at top of segment

        const mat = createClayMaterial(color); // Use helper from file scope?
        // Note: createClayMaterial is internal to foliage.js but this code is appended.
        // It is defined in previous scope.

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = -i * segLen;

        // Random twist
        mesh.rotation.z = (Math.random() - 0.5) * 0.1;
        mesh.rotation.x = (Math.random() - 0.5) * 0.1;

        group.add(mesh);

        // Add leaves occasionally
        if (Math.random() > 0.4) {
             const leaf = createLeafParticle({ color: 0x32CD32 });
             leaf.position.y = -segLen * 0.5;
             leaf.position.x = 0.1;
             leaf.rotation.z = Math.PI / 4;
             mesh.add(leaf);
        }
    }

    // Hitbox marker (visual aid for debugging, invisible normally)
    const hitGeo = new THREE.CylinderGeometry(0.5, 0.5, length, 8);
    hitGeo.translate(0, -length/2, 0);
    const hitMat = new THREE.MeshBasicMaterial({ color: 0xFFFF00, wireframe: true, visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.userData.isVineHitbox = true;
    group.add(hitbox);

    group.userData.type = 'vine';
    group.userData.isSwingable = true;
    group.userData.vineLength = length;

    return group;
}
