import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { WebGPURenderer } from 'three/webgpu';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud } from './foliage.js';
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
    const y = 20 + Math.random() * 10;
    const x = (Math.random() - 0.5) * 200;
    const z = (Math.random() - 0.5) * 200;
    group.position.set(x, y, z);

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

    scene.add(group);
    clouds.push({ mesh: group, speed: (Math.random() * 0.05) + 0.02 });
}

// --- Color Palettes ---
const FLOWER_COLORS = [0xFF69B4, 0xFFD700, 0x7FFFD4, 0xFF8C00, 0xDA70D6, 0x87CEFA, 0xFF6347, 0xBA55D3];
const GRASS_COLORS = [0x6B8E23, 0x9ACD32, 0x556B2F, 0x228B22, 0x32CD32];
const TREE_COLORS = [0xFF69B4, 0xFFD700, 0xFF6347, 0xDA70D6, 0x87CEFA];
const SHRUB_COLORS = [0x32CD32, 0x228B22, 0x6B8E23, 0x9ACD32];

// 6. Foliage
const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);
const animatedFoliage = [];

const flowerShapes = ['simple', 'multi', 'spiral', 'layered', 'bell'];
const grassShapes = ['tall', 'bushy'];

// Increase density: 400 -> 600
for (let i = 0; i < 600; i++) {
    const x = (Math.random() - 0.5) * 260;
    const z = (Math.random() - 0.5) * 260;
    const y = getGroundHeight(x, z);

    const rand = Math.random();
    if (rand < 0.38) {
        // Flower (now with new shapes)
        const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
        const shape = flowerShapes[Math.floor(Math.random() * flowerShapes.length)];
        const flower = createFlower({ color, shape });
        flower.position.set(x, y, z);
        foliageGroup.add(flower);
        animatedFoliage.push(flower);
    } else if (rand < 0.76) {
        // Grass
        const color = GRASS_COLORS[Math.floor(Math.random() * GRASS_COLORS.length)];
        const shape = grassShapes[Math.floor(Math.random() * grassShapes.length)];
        const grass = createGrass({ color, shape });
        grass.position.set(x, y, z);
        foliageGroup.add(grass);
        animatedFoliage.push(grass);
    } else if (rand < 0.88) {
        // Shrub
        const color = SHRUB_COLORS[Math.floor(Math.random() * SHRUB_COLORS.length)];
        const shrub = createShrub({ color });
        shrub.position.set(x, y, z);
        worldGroup.add(shrub);
        animatedFoliage.push(shrub);
        obstacles.push({ position: new THREE.Vector3(x, y, z), radius: 0.8 });
    } else if (rand < 0.94) {
        // New flowers (starflower / bell)
        const pick = Math.random();
        let nf;
        if (pick < 0.6) nf = createStarflower({ color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)] });
        else nf = createBellBloom({ color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)] });
        nf.position.set(x, y, z);
        foliageGroup.add(nf);
        animatedFoliage.push(nf);
    } else {
        // Wisteria clusters
        const w = createWisteriaCluster({ color: TREE_COLORS[Math.floor(Math.random() * TREE_COLORS.length)] });
        w.position.set(x, y + 1.0, z); // hang from above-ish
        worldGroup.add(w);
        animatedFoliage.push(w);
    }
}

// Flowering Trees: increase 25 -> 40
for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 260;
    const z = (Math.random() - 0.5) * 260;
    const y = getGroundHeight(x, z);
    const color = TREE_COLORS[Math.floor(Math.random() * TREE_COLORS.length)];
    const tree = createFloweringTree({ color });
    tree.position.set(x, y, z);
    worldGroup.add(tree);
    animatedFoliage.push(tree);
    obstacles.push({ position: new THREE.Vector3(x, y, z), radius: 1.5 });
}

// Regular Trees: increase 30 -> 50
for(let i=0; i<50; i++) {
    const x = (Math.random() - 0.5) * 260;
    const z = (Math.random() - 0.5) * 260;
    createTree(x, z);
}

// Mushrooms: increase 20 -> 30
const animatedObjects = [];
for(let i=0; i<30; i++) {
    const x = (Math.random() - 0.5) * 220;
    const z = (Math.random() - 0.5) * 220;
    const obj = createMushroom(x, z);
    animatedObjects.push(obj);
}

// Clouds: increase 15 -> 25
for(let i=0; i<25; i++) {
    const cloud = Math.random() > 0.5 ? createCloud() : createRainingCloud({ rainIntensity: 100 });
    cloud.position.set(
        (Math.random() - 0.5) * 100,
        20 + Math.random() * 10,
        (Math.random() - 0.5) * 100
    );
    scene.add(cloud);
    if (cloud.userData.animationType === 'rain') {
        animatedFoliage.push(cloud);
    } else {
        clouds.push({ mesh: cloud, speed: (Math.random() * 0.05) + 0.02 });
    }
}

// Glowing Flowers: 20 -> 30
for (let i = 0; i < 30; i++) {
    const x = (Math.random() - 0.5) * 300;
    const z = (Math.random() - 0.5) * 300;
    createGlowingFlowerPatch(x, z);
}

// Floating Orbs: 15 -> 25
for (let i = 0; i < 25; i++) {
    const x = (Math.random() - 0.5) * 300;
    const z = (Math.random() - 0.5) * 300;
    createFloatingOrbCluster(x, z);
}

// Vines: 10 -> 15
for (let i = 0; i < 15; i++) {
    const x = (Math.random() - 0.5) * 300;
    const z = (Math.random() - 0.5) * 300;
    createVineCluster(x, z);
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
        if (cloud.mesh.position.x > 100) {
            cloud.mesh.position.x = -100;
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
