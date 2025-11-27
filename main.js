import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
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
    })
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
function createMushroom(x, z) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Stem
    const stemH = 1.5 + Math.random();
    const stemR = 0.3 + Math.random() * 0.2;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16); // Increased segments
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const capR = stemR * 3 + Math.random();
    // Use Sphere but cut off bottom
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2); // Increased segments
    const matIndex = Math.floor(Math.random() * materials.mushroomCap.length);
    const cap = new THREE.Mesh(capGeo, materials.mushroomCap[matIndex]);
    cap.position.y = stemH; // Sit on top
    cap.castShadow = true;
    group.add(cap);

    // Face (on the Stem)
    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, stemH * 0.6, stemR * 0.95); // Front of stem

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.08, 8, 8);
    const leftEye = new THREE.Mesh(eyeGeo, materials.eye);
    leftEye.position.set(-0.15, 0.1, 0);
    const rightEye = new THREE.Mesh(eyeGeo, materials.eye);
    rightEye.position.set(0.15, 0.1, 0);

    // Smile (Torus)
    const smileGeo = new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI);
    const smile = new THREE.Mesh(smileGeo, materials.mouth);
    smile.rotation.z = Math.PI;
    smile.position.set(0, -0.05, 0);

    faceGroup.add(leftEye, rightEye, smile);
    group.add(faceGroup);

    worldGroup.add(group);

    // Add to obstacles for collision
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 2 // Collision against the stem area
    });

    // Store for animation
    return { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100 };
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

// --- Animation Loop ---
let prevTime = performance.now();

async function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;
    prevTime = time;

    if (controls.isLocked) {

        // 1. Speed Management (Acceleration/Deceleration)
        const targetSpeed = keyStates.sprint
            ? player.sprintSpeed
            : (keyStates.sneak ? player.sneakSpeed : player.runSpeed);
        if (player.currentSpeed < targetSpeed) {
            player.currentSpeed = Math.min(targetSpeed, player.currentSpeed + player.acceleration * delta);
        } else if (player.currentSpeed > targetSpeed) {
            player.currentSpeed = Math.max(targetSpeed, player.currentSpeed - player.acceleration * delta);
        }


        // 2. Movement Logic
        player.velocity.x -= player.velocity.x * 10.0 * delta;
        player.velocity.z -= player.velocity.z * 10.0 * delta;
        player.velocity.y -= player.gravity * delta; // Gravity

        player.direction.z = Number(keyStates.forward) - Number(keyStates.backward);
        player.direction.x = Number(keyStates.right) - Number(keyStates.left);
        player.direction.normalize(); // Ensure consistent speed in diagonals

        if (keyStates.forward || keyStates.backward) {
            player.velocity.z -= player.direction.z * player.currentSpeed * delta;
        }
        if (keyStates.left || keyStates.right) {
            player.velocity.x -= player.direction.x * player.currentSpeed * delta;
        }

        // Apply movement
        controls.moveRight(-player.velocity.x * delta);
        controls.moveForward(-player.velocity.z * delta);

        // 2. Ground Collision & Jumping
        const camPos = camera.position;
        const groundY = getGroundHeight(camPos.x, camPos.z);
        const playerBottom = camPos.y - player.height;

        if (playerBottom <= groundY) {
            // Landed
            player.velocity.y = Math.max(0, player.velocity.y);
            camPos.y = groundY + player.height;

            // Allow Jump
            if (keyStates.jump) {
                player.velocity.y = player.jumpStrength;
            }
        }

        camPos.y += player.velocity.y * delta;

        // 3. Object Collision (Simple Cylinder push)
        for(let obj of obstacles) {
            const dx = camPos.x - obj.position.x;
            const dz = camPos.z - obj.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const minDist = obj.radius + player.radius;

            if (dist < minDist) {
                // Collision detected, push back
                const overlap = minDist - dist;
                const pushX = dx / dist * overlap;
                const pushZ = dz / dist * overlap;

                camPos.x += pushX;
                camPos.z += pushZ;
            }
        }

    } // End if Locked

    // 4. Object Animations
    const t = time * 0.001;

    // Animate Mushrooms (Bounce)
    animatedObjects.forEach(obj => {
        if (obj.type === 'mushroom') {
            obj.mesh.scale.y = 1 + Math.sin(t * 3 + obj.offset) * 0.05;
            obj.mesh.rotation.z = Math.sin(t * 2 + obj.offset) * 0.05;
        }
    });

    // Animate Foliage
    animatedFoliage.forEach(foliage => {
        animateFoliage(foliage, t);
    });

    // Animate Clouds
    clouds.forEach(cloud => {
        cloud.mesh.position.x += cloud.speed;
        if (cloud.mesh.position.x > 120) {
            cloud.mesh.position.x = -120;
        }
    });

    // Animate Raining Clouds (drift slowly)
    rainingClouds.forEach(cloud => {
        cloud.position.x += 0.01;
        if (cloud.position.x > 120) cloud.position.x = -120;

        // --- RAIN LOGIC ---
        // 1. Grow Plants under rain
        // 2. Spawn new plants occasionally

        // Optimization: Don't check every frame against every plant.
        // Just pick a few random samples or check bounding box.
        // For simplicity: Check distance to a few random foliage items per frame.

        // A. Growth
        // Pick 5 random foliage items to check
        for(let k=0; k<5; k++) {
            if (animatedFoliage.length === 0) break;
            const idx = Math.floor(Math.random() * animatedFoliage.length);
            const plant = animatedFoliage[idx];

            // ignore clouds themselves
            if (plant.userData.animationType === 'rain') continue;

            const dx = plant.position.x - cloud.position.x;
            const dz = plant.position.z - cloud.position.z;
            if (dx*dx + dz*dz < 25) { // Radius 5 (squared 25)
                 // Grow!
                 if (plant.scale.y < 2.0) { // Max scale cap
                     plant.scale.multiplyScalar(1.002);
                 }
            }
        }

        // B. Spawn (Chance: 1 in 60 frames approx)
        if (Math.random() < 0.02) {
             const offsetR = Math.random() * 4; // Under cloud radius
             const offsetTheta = Math.random() * Math.PI * 2;
             const sx = cloud.position.x + offsetR * Math.cos(offsetTheta);
             const sz = cloud.position.z + offsetR * Math.sin(offsetTheta);
             const sy = getGroundHeight(sx, sz);

             // Spawn a baby plant!
             const types = [createGrass, createFlower, createPuffballFlower, createMushroom];
             // Note: createMushroom returns wrapper object, others return Group/Mesh

             if (Math.random() < 0.2) {
                 // Mushroom special case
                 const m = createMushroom(sx, sz);
                 animatedObjects.push(m);
             } else {
                 const picker = Math.floor(Math.random() * 3); // 0, 1, 2
                 let baby;
                 if (picker === 0) baby = createGrass({ color: GRASS_COLORS[0] });
                 else if (picker === 1) baby = createFlower({ color: FLOWER_COLORS[0] });
                 else baby = createPuffballFlower({ color: FLOWER_COLORS[1] });

                 baby.position.set(sx, sy, sz);
                 baby.scale.set(0.1, 0.1, 0.1); // Start tiny

                 safeAddFoliage(baby);
             }
        }
    });

    await renderer.renderAsync(scene, camera);
}

// Resize Handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Add rainbow-leaf thrower functionality
const rainbowColors = [0xFF0000, 0xFF7F00, 0xFFFF00, 0x00FF00, 0x0000FF, 0x4B0082, 0x9400D3]; // Red, Orange, Yellow, Green, Blue, Indigo, Violet
document.addEventListener('click', (event) => {
    if (event.button === 0) { // Left click
        const color = rainbowColors[Math.floor(Math.random() * rainbowColors.length)];
        const leaf = createLeafParticle({ color });
        leaf.position.set(camera.position.x, camera.position.y, camera.position.z);
        leaf.userData.animationType = 'float';
        scene.add(leaf);
        animatedFoliage.push(leaf);
    }
});

animate();
