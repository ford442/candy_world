import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer } from 'three/webgpu';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle, createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster, createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush } from './foliage.js';
import { createSky } from './sky.js';

// --- Configuration ---
const CONFIG = {
    colors: {
        sky: 0x87CEEB,        // Sky Blue
        ground: 0x98FB98,     // Pale Green
        fog: 0xFFB6C1,        // Light Pink fog
        light: 0xFFFFFF,
        ambient: 0xFFA07A     // Light Salmon
    }
};

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(CONFIG.colors.fog, 20, 100);

// Sky
const sky = createSky();
scene.add(sky);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
// Initial camera position (will be overridden by player logic, but good for initial frame)
camera.position.set(0, 5, 0);

// Check for WebGPU support
if (!WebGPU.isAvailable()) {
    const warning = WebGPU.getErrorMessage();
    document.body.appendChild(warning);
    throw new Error('WebGPU not supported');
}

const renderer = new WebGPURenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// --- Lighting ---
const ambientLight = new THREE.HemisphereLight(CONFIG.colors.sky, CONFIG.colors.ground, 1.0); // Increased intensity
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(CONFIG.colors.light, 0.8); // Decreased intensity
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 200;
sunLight.shadow.camera.left = -100;
sunLight.shadow.camera.right = 100;
sunLight.shadow.camera.top = 100;
sunLight.shadow.camera.bottom = -100;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// --- Materials ---
function createClayMaterial(color) {
    return new THREE.MeshStandardMaterial({
        color: color,
        metalness: 0.0,
        roughness: 0.8, // Matte surface
        flatShading: false,
    });
}

const materials = {
    ground: createClayMaterial(CONFIG.colors.ground),
    trunk: createClayMaterial(0x8B5A2B), // Brownish
    leaves: [
        createClayMaterial(0xFF69B4), // Hot Pink
        createClayMaterial(0x87CEEB), // Sky Blue
        createClayMaterial(0xDDA0DD), // Plum
        createClayMaterial(0xFFD700), // Gold
    ],
    mushroomStem: createClayMaterial(0xF5DEB3), // Wheat
    mushroomCap: [
        createClayMaterial(0xFF6347), // Tomato
        createClayMaterial(0xDA70D6), // Orchid
        createClayMaterial(0xFFA07A), // Light Salmon
    ],
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 }),
    mouth: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }),
    cloud: new THREE.MeshStandardMaterial({
        color: 0xFFFFFF,
        roughness: 0.3,
        transparent: true,
        opacity: 0.9
    }),
    // Add a new material for drivable mushrooms (e.g., bright blue)
    drivableMushroomCap: createClayMaterial(0x00BFFF) // Deep Sky Blue
};

// --- Physics Data ---
const obstacles = [];

// --- Procedural Generation ---

// 1. Ground (Rolling Hills)
const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
const posAttribute = groundGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i);
    // Simple sine waves for hills
    const z = Math.sin(x * 0.05) * 2 + Math.cos(y * 0.05) * 2;
    posAttribute.setZ(i, z);
}
groundGeo.computeVertexNormals();
const ground = new THREE.Mesh(groundGeo, materials.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Helper to get ground height at x, z
function getGroundHeight(x, z) {
    return Math.sin(x * 0.05) * 2 + Math.cos(-z * 0.05) * 2;
}

// 2. Objects Container
const worldGroup = new THREE.Group();
scene.add(worldGroup);

// 3. Trees
function createTree(x, z) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Trunk
    const trunkH = 3 + Math.random() * 2;
    const trunkRadius = 0.5; // Avg radius of base
    const trunkGeo = new THREE.CylinderGeometry(0.3, trunkRadius, trunkH, 16); // Increased segments
    const trunk = new THREE.Mesh(trunkGeo, materials.trunk);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    // Leaves (Spheres)
    const leavesR = 1.5 + Math.random();
    const leavesGeo = new THREE.SphereGeometry(leavesR, 32, 32); // Increased segments
    const matIndex = Math.floor(Math.random() * materials.leaves.length);
    const leaves = new THREE.Mesh(leavesGeo, materials.leaves[matIndex]);
    leaves.position.y = trunkH + leavesR * 0.8;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(leaves);

    worldGroup.add(group);

    // Add to obstacles for collision
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: 0.8 // Slightly larger than trunk
    });
}

// 4. Fantasy Mushrooms with Faces
const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16); // Geometry for eyes

function createMushroom(x, z, options = {}) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Stem
    const stemH = 1.5 + Math.random();
    const stemR = 0.3 + Math.random() * 0.2;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16); // Increased segments
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const capR = stemR * 3 + Math.random();
    // Use Sphere but cut off bottom
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2); // Increased segments

    let capMaterial;
    let isDrivable = false;
    if (options.drivable) {
        capMaterial = materials.drivableMushroomCap;
        isDrivable = true;
    } else {
        const matIndex = Math.floor(Math.random() * materials.mushroomCap.length);
        capMaterial = materials.mushroomCap[matIndex];
    }
    const cap = new THREE.Mesh(capGeo, capMaterial);
    cap.position.y = stemH;

    // Face
    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);

    const leftEye = new THREE.Mesh(eyeGeo, materials.eye);
    leftEye.position.set(-0.15, 0.1, 0);
    const rightEye = new THREE.Mesh(eyeGeo, materials.eye);
    rightEye.position.set(0.15, 0.1, 0);

    const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
    const smile = new THREE.Mesh(smileGeo, materials.mouth);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.05, 0);

    faceGroup.add(leftEye, rightEye, smile);
    group.add(faceGroup);
    group.add(cap); // Add cap to group

    worldGroup.add(group);

    // Add to obstacles for collision
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 2
    });

    // Store for animation and driving
    return { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: isDrivable };
}

// 5. Clouds
const clouds = [];
function createCloud() {
    const group = new THREE.Group();
    // Position will be set by caller
    // Compose cloud of 3-5 spheres
    const blobs = 3 + Math.floor(Math.random() * 3);
    for(let i=0; i<blobs; i++) {
        const size = 2 + Math.random() * 2;
        const geo = new THREE.SphereGeometry(size, 16, 16);
        const mesh = new THREE.Mesh(geo, materials.cloud);
        mesh.position.set(
            (Math.random() - 0.5) * size * 1.5,
            (Math.random() - 0.5) * size * 0.5,
            (Math.random() - 0.5) * size * 1.5
        );
        group.add(mesh);
    }
    return group;
}

// --- Color Palettes (Expanded) ---
const FLOWER_COLORS = [0xFF69B4, 0xFFD700, 0x7FFFD4, 0xFF8C00, 0xDA70D6, 0x87CEFA, 0xFF6347, 0xBA55D3, 0xD8BFD8, 0xFFB7C5];
const GRASS_COLORS = [0x6B8E23, 0x9ACD32, 0x556B2F, 0x228B22, 0x32CD32, 0x00FA9A];
const TREE_COLORS = [0xFF69B4, 0xFFD700, 0xFF6347, 0xDA70D6, 0x87CEFA, 0x8A2BE2];
const SHRUB_COLORS = [0x32CD32, 0x228B22, 0x6B8E23, 0x9ACD32, 0x008080];
const PASTEL_COLORS = [0xFFB7C5, 0xE6E6FA, 0xADD8E6, 0x98FB98, 0xFFFFE0, 0xFFDAB9];

// 6. Foliage
const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);
const animatedFoliage = [];
const animatedObjects = []; // Mushrooms

// Max Object Limit to prevent infinite spawn crash
const MAX_OBJECTS = 2500;

function safeAddFoliage(obj, isObstacle = false, obstacleRadius = 1.0) {
    if (animatedFoliage.length > MAX_OBJECTS) return; // Hard Cap

    // Add to group or scene
    if (obj.parent !== worldGroup && obj.parent !== foliageGroup && obj.parent !== scene) {
        foliageGroup.add(obj);
    }

    animatedFoliage.push(obj);
    if (isObstacle) {
        obstacles.push({ position: obj.position.clone(), radius: obstacleRadius });
    }
}

// --- CLUSTERING SYSTEM ---

/**
 * Spawns a cluster of vegetation around a central point.
 */
function spawnCluster(cx, cz) {
    // Determine Biome / Theme for this cluster
    const typeRoll = Math.random();
    let count = 10 + Math.floor(Math.random() * 10);
    let radius = 15 + Math.random() * 10;

    // Cluster Types:
    // 1. Meadow (Grass + Flowers)
    // 2. Forest (Trees + Shrubs)
    // 3. Fantasy (Glowing, Mushrooms, Orbs)
    // 4. Bubble Grove (New Bubble Willows + Puffballs)
    // 5. Helix Garden (Helix Plants + Starflowers)

    if (typeRoll < 0.3) {
        // MEADOW
        for(let i=0; i<count*2; i++) { // Dense
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const y = getGroundHeight(x, z);

            if(Math.random() < 0.7) {
                const color = GRASS_COLORS[Math.floor(Math.random() * GRASS_COLORS.length)];
                const shape = Math.random() > 0.5 ? 'tall' : 'bushy';
                const grass = createGrass({color, shape});
                grass.position.set(x, y, z);
                safeAddFoliage(grass);
            } else {
                const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
                const shape = ['simple', 'multi', 'spiral'][Math.floor(Math.random() * 3)];
                const flower = createFlower({color, shape});
                flower.position.set(x, y, z);
                safeAddFoliage(flower);
            }
        }
    } else if (typeRoll < 0.5) {
        // FOREST
        count = 5 + Math.floor(Math.random() * 3);
        for(let i=0; i<count; i++) {
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);

            if (Math.random() < 0.4) {
                createTree(x, z); // Standard Tree
            } else {
                const color = TREE_COLORS[Math.floor(Math.random() * TREE_COLORS.length)];
                const tree = createFloweringTree({ color });
                tree.position.set(x, getGroundHeight(x,z), z);
                safeAddFoliage(tree, true, 1.5);
            }
        }
        // Undergrowth
        for(let i=0; i<count*2; i++) {
             const r = Math.random() * radius;
             const theta = Math.random() * Math.PI * 2;
             const x = cx + r * Math.cos(theta);
             const z = cz + r * Math.sin(theta);
             const color = SHRUB_COLORS[Math.floor(Math.random() * SHRUB_COLORS.length)];
             const shrub = createShrub({ color });
             shrub.position.set(x, getGroundHeight(x,z), z);
             safeAddFoliage(shrub, true, 0.8);
        }
    } else if (typeRoll < 0.7) {
        // FANTASY
        for(let i=0; i<count; i++) {
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);

            const subRoll = Math.random();
            if (subRoll < 0.3) {
                 const m = createMushroom(x, z);
                 animatedObjects.push(m);
            } else if (subRoll < 0.6) {
                 const patch = createGlowingFlowerPatch(x, z);
                 safeAddFoliage(patch);
            } else {
                 const cluster = createFloatingOrbCluster(x, z);
                 safeAddFoliage(cluster);
            }
        }
    } else if (typeRoll < 0.85) {
        // BUBBLE GROVE (New)
        // Bubble Willows + Puffballs
        for (let i=0; i<5; i++) { // Trees
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
            const tree = createBubbleWillow({ color });
            tree.position.set(x, getGroundHeight(x,z), z);
            safeAddFoliage(tree, true, 1.2);
        }
        for (let i=0; i<10; i++) { // Flowers
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
            const puff = createPuffballFlower({ color });
            puff.position.set(x, getGroundHeight(x,z), z);
            safeAddFoliage(puff);
        }
    } else {
        // HELIX GARDEN (New)
        for (let i=0; i<12; i++) {
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);

            if (Math.random() < 0.5) {
                const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
                const helix = createHelixPlant({ color });
                helix.position.set(x, getGroundHeight(x,z), z);
                safeAddFoliage(helix);
            } else {
                 const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
                 const sf = createStarflower({ color });
                 sf.position.set(x, getGroundHeight(x,z), z);
                 safeAddFoliage(sf);
            }
        }
        // Add a balloon bush or two
         for (let i=0; i<3; i++) {
            const r = Math.random() * radius;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const bb = createBalloonBush({ color: 0xFF4500 });
            bb.position.set(x, getGroundHeight(x,z), z);
            safeAddFoliage(bb, true, 1.0);
         }
    }
}

// Generate the world using Clusters
const CLUSTER_COUNT = 60; // How many patches
for (let i=0; i<CLUSTER_COUNT; i++) {
    const cx = (Math.random() - 0.5) * 260;
    const cz = (Math.random() - 0.5) * 260;
    spawnCluster(cx, cz);
}

// Clouds: increase 15 -> 25
const rainingClouds = [];

for(let i=0; i<25; i++) {
    const isRaining = Math.random() > 0.6; // More chance of rain
    const cloud = isRaining ? createRainingCloud({ rainIntensity: 100 }) : createCloud();
    cloud.position.set(
        (Math.random() - 0.5) * 200,
        25 + Math.random() * 10,
        (Math.random() - 0.5) * 200
    );
    scene.add(cloud);

    if (cloud.userData.animationType === 'rain') {
        animatedFoliage.push(cloud);
        rainingClouds.push(cloud); // Track for logic
    } else {
        clouds.push({ mesh: cloud, speed: (Math.random() * 0.05) + 0.02 });
    }
}

// --- Player & Input Logic ---

const controls = new PointerLockControls(camera, document.body);

const instructions = document.getElementById('instructions');

instructions.addEventListener('click', function () {
    controls.lock();
});

controls.addEventListener('lock', function () {
    instructions.style.display = 'none';
});

controls.addEventListener('unlock', function () {
    instructions.style.display = 'flex';
});

// Prevent context menu (Right Click)
document.addEventListener('contextmenu', event => event.preventDefault());

const keyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false
};

const onKeyDown = function (event) {
    if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
        event.preventDefault();
    }
    switch (event.code) {
        case 'KeyW':
            break;
        case 'KeyA': keyStates.left = true; break;
        case 'KeyS': keyStates.backward = true; break;
        case 'KeyD': keyStates.right = true; break;
        case 'Space': keyStates.jump = true; break;
        case 'ControlLeft':
        case 'ControlRight':
            keyStates.sneak = true;
            event.preventDefault();
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            keyStates.sprint = true;
            break;
    }
};

const onKeyUp = function (event) {
    switch (event.code) {
        case 'KeyW':
            break;
        case 'KeyA': keyStates.left = false; break;
        case 'KeyS': keyStates.backward = false; break;
        case 'KeyD': keyStates.right = false; break;
        case 'Space': keyStates.jump = false; break;
        case 'ControlLeft':
        case 'ControlRight':
            keyStates.sneak = false;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            keyStates.sprint = false;
            break;
    }
};

const onMouseDown = function (event) {
    if (event.button === 2) { // Right Click
        keyStates.forward = true;
    }
};

const onMouseUp = function (event) {
    if (event.button === 2) {
        keyStates.forward = false;
    }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
document.addEventListener('mousedown', onMouseDown);
document.addEventListener('mouseup', onMouseUp);


const player = {
    velocity: new THREE.Vector3(),
    direction: new THREE.Vector3(),
    sneakSpeed: 10.0,
    runSpeed: 30.0,
    sprintSpeed: 50.0,
    currentSpeed: 30.0,
    acceleration: 20.0, // Rate of speed change
    gravity: 20.0, // "Little floaty"
    jumpStrength: 10.0,
    height: 1.8, // Eye level
    radius: 0.5
};

// --- Driving Drivable Mushrooms ---
let drivingMushroom = null;
let previousCameraPosition = null;

function findNearestDrivableMushroom() {
    let minDist = Infinity;
    let nearest = null;
    const camPos = camera.position;
    animatedObjects.forEach(obj => {
        if (obj.type === 'mushroom' && obj.drivable) {
            const mPos = obj.mesh.position;
            const dx = camPos.x - mPos.x;
            const dz = camPos.z - mPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < minDist) {
                minDist = dist;
                nearest = obj;
            }
        }
    });
    return nearest;
}

function startDrivingMushroom(mushroom) {
    drivingMushroom = mushroom;
    previousCameraPosition = camera.position.clone();
    camera.position.copy(mushroom.mesh.position);
}

function stopDrivingMushroom() {
    if (previousCameraPosition) {
        camera.position.copy(previousCameraPosition);
    }
    drivingMushroom = null;
}

// Add keybinding to toggle driving mode (e.g., 'M')
document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM') {
        if (drivingMushroom) {
            stopDrivingMushroom();
        } else {
            const nearest = findNearestDrivableMushroom();
            if (nearest) {
                startDrivingMushroom(nearest);
            }
        }
    }
});

// --- Cloud Helicopter Control ---
let cloudHelicopter = null;
let cloudIsRaining = false;
let previousCameraPositionCloud = null;

function summonCloudHelicopter() {
    if (!cloudHelicopter) {
        cloudHelicopter = createCloud();
        cloudHelicopter.position.set(camera.position.x, camera.position.y + 10, camera.position.z);
        scene.add(cloudHelicopter);
        previousCameraPositionCloud = camera.position.clone();
        camera.position.copy(cloudHelicopter.position);
    }
}

function dismissCloudHelicopter() {
    if (cloudHelicopter) {
        scene.remove(cloudHelicopter);
        cloudHelicopter = null;
        cloudIsRaining = false;
        if (previousCameraPositionCloud) {
            camera.position.copy(previousCameraPositionCloud);
        }
    }
}

function toggleCloudRain() {
    cloudIsRaining = !cloudIsRaining;
}

// Keybindings: 'C' to summon/dismiss, 'R' to toggle rain
document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyC') {
        if (cloudHelicopter) {
            dismissCloudHelicopter();
        } else {
            summonCloudHelicopter();
        }
    }
    if (event.code === 'KeyR' && cloudHelicopter) {
        toggleCloudRain();
    }
});

// --- NEW FEATURE: Overgrown Rain Zone & King Mushroom ---

// 1. Custom Waterfall Particle System
function createWaterfall(height, color = 0x87CEEB) {
    const particleCount = 1500; // Dense stream
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount); // Individual speeds

    for (let i = 0; i < particleCount; i++) {
        // Spawn at top (0,0,0) with slight spread for "stream" width
        positions[i * 3] = (Math.random() - 0.5) * 2.0; // X spread
        positions[i * 3 + 1] = Math.random() * -height; // Initial Y spread down the fall
        positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0; // Z spread

        speeds[i] = 0.5 + Math.random() * 0.5; // Random fall speed
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));

    const mat = new THREE.PointsMaterial({
        color: color,
        size: 0.4,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending // Makes water look shiny
    });

    const waterfall = new THREE.Points(geo, mat);
    waterfall.userData = {
        animationType: 'waterfall',
        fallHeight: height
    };
    return waterfall;
}

// 2. Animation Logic for Waterfall (To be called in loop)
function updateWaterfall(waterfall) {
    const positions = waterfall.geometry.attributes.position.array;
    const speeds = waterfall.geometry.attributes.speed.array;
    const height = waterfall.userData.fallHeight;

    for (let i = 0; i < waterfall.geometry.attributes.position.count; i++) {
        // Move Y down
        positions[i * 3 + 1] -= speeds[i];

        // Reset if it hits the bottom
        if (positions[i * 3 + 1] < -height) {
            positions[i * 3 + 1] = 0; // Back to top
            // Reshuffle X/Z slightly for turbulence
            positions[i * 3] = (Math.random() - 0.5) * 2.0;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
        }
    }
    waterfall.geometry.attributes.position.needsUpdate = true;
}

// 3. A specialized function to create Giant Mushrooms with correct physics
function createGiantMushroom(x, z, scale = 8) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Stem
    const stemH = (1.5 + Math.random()) * scale;
    const stemR = (0.3 + Math.random() * 0.2) * scale;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const capR = stemR * 3 + Math.random() * scale;
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);

    const matIndex = Math.floor(Math.random() * materials.mushroomCap.length);
    const capMaterial = materials.mushroomCap[matIndex];

    const cap = new THREE.Mesh(capGeo, capMaterial);
    cap.position.y = stemH;

    // Face (Scaled)
    const faceGroup = new THREE.Group();
    // Adjust face position based on new scale
    faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);
    faceGroup.scale.set(scale, scale, scale); // Scale the face features

    const leftEye = new THREE.Mesh(eyeGeo, materials.eye);
    leftEye.position.set(-0.15, 0.1, 0);
    const rightEye = new THREE.Mesh(eyeGeo, materials.eye);
    rightEye.position.set(0.15, 0.1, 0);

    const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
    const smile = new THREE.Mesh(smileGeo, materials.mouth);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.05, 0);

    faceGroup.add(leftEye, rightEye, smile);
    group.add(faceGroup);
    group.add(cap);

    worldGroup.add(group);

    // IMPORTANT: Add a larger collision obstacle
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 1.2 // Adjusted to "somewhere between" strict and soft
    });

    // Add to animated objects so it might bounce or look alive
    const giantMushroom = { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: false };
    animatedObjects.push(giantMushroom);
}

// 4. Helper for Giant Rain Cloud (Manual scaling to keep rain drops normal size)
function createGiantRainCloud(options = {}) {
    const { color = 0x555555, rainIntensity = 200 } = options;
    const group = new THREE.Group();

    // Giant Cloud Body (Scaled geometry radius, standard is 1.5, giant is 4.5)
    const cloudGeo = new THREE.SphereGeometry(4.5, 32, 32);
    const cloudMat = materials.cloud.clone(); // Use existing cloud material
    cloudMat.color.setHex(color);
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.castShadow = true;
    group.add(cloud);

    // Rain Particles (Scaled spread, standard is 3.0, giant is 9.0)
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainIntensity * 3);
    for (let i = 0; i < rainIntensity; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 9.0; // x spread
        positions[i * 3 + 1] = Math.random() * -6.0; // y spread
        positions[i * 3 + 2] = (Math.random() - 0.5) * 9.0; // z spread
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Use normal size for droplets
    const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
    const rain = new THREE.Points(rainGeo, rainMat);
    group.add(rain);

    group.userData.animationType = 'rain';
    return group;
}

// 5. The King Mushroom with Pool and Waterfall
function spawnKingMushroomZone(cx, cz) {
    console.log(`Spawning King Mushroom at ${cx}, ${cz}`);

    // A. The Giant Mushroom Structure
    const scale = 12;
    const stemH = 2.5 * scale; // Tall stem
    const stemR = 0.4 * scale;
    const capR = 1.5 * scale; // Wide cap

    const group = new THREE.Group();
    group.position.set(cx, getGroundHeight(cx, cz), cz);

    // Stem
    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 32),
        materials.mushroomStem
    );
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.mushroomCap[0] // Red/Tomato cap
    );
    cap.position.y = stemH;
    group.add(cap);

    // B. The Pool of Water (On top of cap)
    const poolGeo = new THREE.CylinderGeometry(capR * 0.8, capR * 0.8, 0.5, 32);
    const poolMat = new THREE.MeshStandardMaterial({
        color: 0x0099FF,
        roughness: 0.1,
        metalness: 0.5
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.y = stemH + (capR * 0.2); // Sits slightly embedded in top
    group.add(pool);

    // C. The Waterfall
    // Calculate edge position
    const waterfallOffset = capR * 0.8;
    const waterfall = createWaterfall(stemH); // Height matches stem
    // Position at the edge of the pool
    waterfall.position.set(0, stemH + 0.5, waterfallOffset);
    group.add(waterfall);

    // Add collision for the King Mushroom
    obstacles.push({ position: group.position.clone(), radius: stemR * 1.2 });
    scene.add(group);

    // Register Waterfall for Logic
    // We treat it like a "cloud" so it causes growth, and "foliage" so it gets updated
    animatedFoliage.push(waterfall);

    // Hack: Add the waterfall WORLD position to rainingClouds so plants grow near the base
    // Since waterfall is in a group, we need a proxy object representing the "Splash Zone"
    const splashZone = new THREE.Object3D();
    splashZone.position.set(cx, 0, cz + waterfallOffset); // Base of waterfall
    splashZone.userData = { animationType: 'rain' }; // Tag for growth logic
    rainingClouds.push(splashZone);

    // D. Surround with Giant Plants (The "Jungle")
    for(let i=0; i<20; i++) {
        const r = 15 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);

        // Random Giant Plant
        const type = Math.random();
        let plant;
        if (type < 0.33) plant = createBubbleWillow({ color: 0xDA70D6 });
        else if (type < 0.66) plant = createHelixPlant({ color: 0x7FFFD4 });
        else plant = createStarflower({ color: 0xFFD700 });

        const pScale = 4 + Math.random() * 4;
        plant.position.set(x, getGroundHeight(x, z), z);
        plant.scale.set(pScale, pScale, pScale);

        safeAddFoliage(plant, true, 1.0 * pScale);
    }
}

// 6. The Zone Generator
function spawnOvergrownZone(cx, cz) {
    console.log(`Spawning Overgrown Zone at ${cx}, ${cz}`);
    const radius = 50; // Large area

    // A. Permanent Heavy Rain Cloud
    // We create a cluster of rain clouds to cover the area
    for(let i=0; i<3; i++) {
        // Use custom giant cloud creator instead of scaling
        const cloud = createGiantRainCloud({ rainIntensity: 200, color: 0x555555 });
        cloud.position.set(
            cx + (Math.random()-0.5)*30,
            60 + Math.random()*10,
            cz + (Math.random()-0.5)*30
        );
        scene.add(cloud);
        // Add to animation loop so rain works
        animatedFoliage.push(cloud);
    }

    // B. Giant Mushrooms (The "Hills")
    for(let i=0; i<15; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);

        // Massive scale between 8x and 15x
        createGiantMushroom(x, z, 8 + Math.random() * 7);
    }

    // C. Giant Foliage
    for(let i=0; i<30; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        const y = getGroundHeight(x, z);

        const type = Math.random();
        let plant;
        let scale;

        if (type < 0.4) {
            // Giant Helix Plant
            plant = createHelixPlant({ color: 0x00FF00 }); // Neon Green
            scale = 5 + Math.random() * 5;
        } else if (type < 0.7) {
            // Giant Starflower
            plant = createStarflower({ color: 0xFF00FF }); // Magenta
            scale = 4 + Math.random() * 4;
        } else {
            // Giant Bubble Willow
            plant = createBubbleWillow({ color: 0x00BFFF });
            scale = 3 + Math.random() * 3;
        }

        plant.position.set(x, y, z);
        plant.scale.set(scale, scale, scale);

        // Add to world with approximated collision radius (base radius * scale)
        safeAddFoliage(plant, true, 1.0 * scale);
    }
}

// 7. Call the functions to place it in the world
spawnOvergrownZone(-100, -100);
spawnKingMushroomZone(-100, -100);


// --- Loop ---
const clock = new THREE.Clock();

async function animate() {
    const delta = clock.getDelta();
    const t = clock.getElapsedTime();

    // Player Physics & Movement
    if (controls.isLocked) {
        // Speed determination
        let targetSpeed = player.runSpeed;
        if (keyStates.sneak) targetSpeed = player.sneakSpeed;
        if (keyStates.sprint) targetSpeed = player.sprintSpeed;

        // Smooth speed transition
        if (player.currentSpeed < targetSpeed) player.currentSpeed += player.acceleration * delta;
        if (player.currentSpeed > targetSpeed) player.currentSpeed -= player.acceleration * delta;

        player.velocity.x -= player.velocity.x * 10.0 * delta;
        player.velocity.z -= player.velocity.z * 10.0 * delta;
        player.velocity.y -= player.gravity * delta;

        player.direction.z = Number(keyStates.forward) - Number(keyStates.backward);
        player.direction.x = Number(keyStates.right) - Number(keyStates.left);
        player.direction.normalize();

        if (keyStates.forward || keyStates.backward) player.velocity.z -= player.direction.z * player.currentSpeed * delta;
        if (keyStates.left || keyStates.right) player.velocity.x -= player.direction.x * player.currentSpeed * delta;

        if (keyStates.jump) {
             // Simple jump check (grounded)
             if (camera.position.y <= getGroundHeight(camera.position.x, camera.position.z) + player.height + 0.5) {
                  player.velocity.y = player.jumpStrength;
             }
        }

        if (!drivingMushroom && !cloudHelicopter) {
            controls.moveRight(-player.velocity.x * delta);
            controls.moveForward(-player.velocity.z * delta);
            camera.position.y += player.velocity.y * delta;

            // Ground Collision
            const groundY = getGroundHeight(camera.position.x, camera.position.z);
            if (camera.position.y < groundY + player.height) {
                player.velocity.y = 0;
                camera.position.y = groundY + player.height;
            }
        }
    }

    // Logic for Vehicles (driving/helicopter)
    if (drivingMushroom) {
        let moveSpeed = 10 * delta;
        let moveX = 0, moveZ = 0;
        if (keyStates.forward) moveZ -= moveSpeed;
        if (keyStates.backward) moveZ += moveSpeed;
        if (keyStates.left) moveX -= moveSpeed;
        if (keyStates.right) moveX += moveSpeed;

        // Update mushroom position
        drivingMushroom.mesh.position.x += moveX;
        drivingMushroom.mesh.position.z += moveZ;

        // Keep camera on mushroom
        camera.position.copy(drivingMushroom.mesh.position);

        // Keep mushroom above ground
        const groundY = getGroundHeight(drivingMushroom.mesh.position.x, drivingMushroom.mesh.position.z);
        drivingMushroom.mesh.position.y = groundY;
    }

    if (cloudHelicopter) {
        let moveSpeed = 15 * delta;
        let moveX = 0, moveY = 0, moveZ = 0;
        if (keyStates.forward) moveZ -= moveSpeed;
        if (keyStates.backward) moveZ += moveSpeed;
        if (keyStates.left) moveX -= moveSpeed;
        if (keyStates.right) moveX += moveSpeed;
        if (keyStates.jump) moveY += moveSpeed;
        if (keyStates.sneak) moveY -= moveSpeed;

        cloudHelicopter.position.x += moveX;
        cloudHelicopter.position.y += moveY;
        cloudHelicopter.position.z += moveZ;
        camera.position.copy(cloudHelicopter.position);
    }

    // Animate Foliage
    animatedFoliage.forEach(foliage => {
        // Check for our new custom waterfall type
        if (foliage.userData.animationType === 'waterfall') {
            updateWaterfall(foliage);
        } else {
            // Default behavior for everything else
            animateFoliage(foliage, t);
        }
    });

    // Animate Clouds
    clouds.forEach(cloud => {
        cloud.mesh.position.x += cloud.speed;
        if (cloud.mesh.position.x > 120) {
            cloud.mesh.position.x = -120;
        }
    });

    // Animate Raining Clouds
    rainingClouds.forEach(cloud => {
        cloud.position.x += 0.01;
        if (cloud.position.x > 120) cloud.position.x = -120;

        // Rain Logic (Growth & Spawning)
        // Check if rain is active (for player cloud) or always for auto-clouds
        // Note: auto-clouds are always raining in this setup

        if (cloudIsRaining || cloud.userData.animationType === 'rain') {
             // 1. Growth
             for(let k=0; k<5; k++) {
                if (animatedFoliage.length === 0) break;
                const idx = Math.floor(Math.random() * animatedFoliage.length);
                const plant = animatedFoliage[idx];

                if (plant.userData.animationType === 'rain') continue;

                const dx = plant.position.x - cloud.position.x;
                const dz = plant.position.z - cloud.position.z;
                if (dx*dx + dz*dz < 25) {
                     if (plant.scale.y < 2.0) {
                         plant.scale.multiplyScalar(1.002);
                     }
                }
             }

             // 2. Spawn
             if (Math.random() < 0.02) {
                 const offsetR = Math.random() * 4;
                 const offsetTheta = Math.random() * Math.PI * 2;
                 const sx = cloud.position.x + offsetR * Math.cos(offsetTheta);
                 const sz = cloud.position.z + offsetR * Math.sin(offsetTheta);
                 const sy = getGroundHeight(sx, sz);

                 if (Math.random() < 0.2) {
                     const m = createMushroom(sx, sz);
                     animatedObjects.push(m);
                 } else {
                     const picker = Math.floor(Math.random() * 3);
                     let baby;
                     if (picker === 0) baby = createGrass({ color: GRASS_COLORS[0] });
                     else if (picker === 1) baby = createFlower({ color: FLOWER_COLORS[0] });
                     else baby = createPuffballFlower({ color: FLOWER_COLORS[1] });

                     baby.position.set(sx, sy, sz);
                     baby.scale.set(0.1, 0.1, 0.1);
                     safeAddFoliage(baby);
                 }
             }
        }
    });

    await renderer.renderAsync(scene, camera);
}

// Start Animation Loop
renderer.setAnimationLoop(animate);

// Resize Handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
