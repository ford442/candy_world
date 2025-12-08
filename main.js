
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, PointsNodeMaterial } from 'three/webgpu';
import { color, float, vec3, time, positionLocal, attribute, storage, uniform, uv } from 'three/tsl';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle, createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster, createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush, createPrismRoseBush, initGrassSystem, addGrassInstance, updateFoliageMaterials, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow } from './foliage.js';
import { createSky, uSkyTopColor, uSkyBottomColor } from './sky.js';
import { createStars, uStarPulse, uStarColor } from './stars.js';
import { AudioSystem } from './audio-system.js';

// --- Configuration ---
// --- Configuration ---
// Expanded Palette for the 4-Stage Cycle
const PALETTE = {
    day: {
        skyTop: new THREE.Color(0x87CEEB),    // Sky Blue
        skyBot: new THREE.Color(0xADD8E6),    // Light Blue
        fog: new THREE.Color(0xFFB6C1),    // Pastel Pink Fog
        sun: new THREE.Color(0xFFFFFF),    // White Sun
        amb: new THREE.Color(0xFFFFFF),    // Bright Ambient
        sunInt: 0.8,
        ambInt: 0.6
    },
    sunset: {
        skyTop: new THREE.Color(0x483D8B),    // Dark Slate Blue
        skyBot: new THREE.Color(0xFF4500),    // Orange Red
        fog: new THREE.Color(0xDB7093),    // Pale Violet Red
        sun: new THREE.Color(0xFF8C00),    // Dark Orange Sun (Golden Hour)
        amb: new THREE.Color(0x800000),    // Maroon Ambient
        sunInt: 0.5,
        ambInt: 0.4
    },
    night: {
        skyTop: new THREE.Color(0x020205),    // Near Black
        skyBot: new THREE.Color(0x050510),    // Deep Blue
        fog: new THREE.Color(0x050510),    // Deep Blue Fog
        sun: new THREE.Color(0x223355),    // Dim Blue Moon
        amb: new THREE.Color(0x050510),    // Very Dark Ambient
        sunInt: 0.1,                          // Moon brightness
        ambInt: 0.05
    },
    sunrise: {
        skyTop: new THREE.Color(0x40E0D0),    // Turquoise
        skyBot: new THREE.Color(0xFF69B4),    // Hot Pink
        fog: new THREE.Color(0xFFDAB9),    // Peach Puff Fog
        sun: new THREE.Color(0xFFD700),    // Gold Sun
        amb: new THREE.Color(0xFFB6C1),    // Pink Ambient
        sunInt: 0.6,
        ambInt: 0.5
    }
};

const CONFIG = {
    colors: {
        // Fallbacks
        ground: 0x98FB98,     // Pale Green
    }
};

const CYCLE_DURATION = 420; // 7 Minutes for a full 24h cycle

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
// Initial fog (Day settings) - ranges will be animated
// Initial fog (Day settings) - ranges will be animated
scene.fog = new THREE.Fog(PALETTE.day.fog, 20, 100);

// Sky
const sky = createSky();
scene.add(sky);

const stars = createStars();
scene.add(stars);

const audioSystem = new AudioSystem();
let isNight = false;
let dayNightFactor = 0.0;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
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
// --- Lighting ---
const ambientLight = new THREE.HemisphereLight(PALETTE.day.skyTop, CONFIG.colors.ground, 1.0);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(PALETTE.day.sun, 0.8);
sunLight.position.set(50, 80, 30);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
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
    drivableMushroomCap: createClayMaterial(0x00BFFF)
};

// --- Physics Data ---
const obstacles = [];

// --- Procedural Generation ---

// 1. Ground (Rolling Hills)
const groundGeo = new THREE.PlaneGeometry(300, 300, 128, 128);
const posAttribute = groundGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i);
    // Note: Plane is rotated, so 'y' in geometry is 'z' in world
    const zWorld = -y;
    const height = getGroundHeight(x, zWorld);
    posAttribute.setZ(i, height);
}
groundGeo.computeVertexNormals();
const ground = new THREE.Mesh(groundGeo, materials.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function getGroundHeight(x, z) {
    // Large rolling hills
    const h1 = Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2;
    // Small detailed bumps (Micro-terrain)
    const h2 = Math.sin(x * 0.2) * 0.3 + Math.cos(z * 0.15) * 0.3;
    return h1 + h2;
}

// 2. Objects Container
const worldGroup = new THREE.Group();
scene.add(worldGroup);

initGrassSystem(scene, 25000);

// 3. Trees
function createTree(x, z) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    const trunkH = 3 + Math.random() * 2;
    const trunkRadius = 0.5;
    const trunkGeo = new THREE.CylinderGeometry(0.3, trunkRadius, trunkH, 16);
    const trunk = new THREE.Mesh(trunkGeo, materials.trunk);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    const leavesR = 1.5 + Math.random();
    const leavesGeo = new THREE.SphereGeometry(leavesR, 32, 32);
    const matIndex = Math.floor(Math.random() * materials.leaves.length);
    const leaves = new THREE.Mesh(leavesGeo, materials.leaves[matIndex]);
    leaves.position.y = trunkH + leavesR * 0.8;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(leaves);

    worldGroup.add(group);
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: 0.8
    });
}

// 4. Mushrooms
const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);

function createMushroom(x, z, options = {}) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    const stemH = 1.5 + Math.random();
    const stemR = 0.3 + Math.random() * 0.2;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const capR = stemR * 3 + Math.random();
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);

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
    stem.add(faceGroup);
    group.add(cap);

    worldGroup.add(group);
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 2
    });

    // Randomize mushroom animation: wobble, bounce, or accordion
    const anims = ['wobble', 'bounce', 'accordion'];
    const chosenAnim = anims[Math.floor(Math.random() * anims.length)];
    group.userData.animationType = chosenAnim;
    // Mark type for specific logic in animateFoliage
    group.userData.type = 'mushroom';

    return { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: isDrivable };
}

// 5. Clouds
const clouds = [];
function createCloud() {
    const group = new THREE.Group();
    const blobs = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blobs; i++) {
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

// --- Color Palettes ---
const FLOWER_COLORS = [0xFF69B4, 0xFFD700, 0x7FFFD4, 0xFF8C00, 0xDA70D6, 0x87CEFA, 0xFF6347, 0xBA55D3, 0xD8BFD8, 0xFFB7C5];
const GRASS_COLORS = [0x6B8E23, 0x9ACD32, 0x556B2F, 0x228B22, 0x32CD32, 0x00FA9A];
const TREE_COLORS = [0xFF69B4, 0xFFD700, 0xFF6347, 0xDA70D6, 0x87CEFA, 0x8A2BE2];
const SHRUB_COLORS = [0x32CD32, 0x228B22, 0x6B8E23, 0x9ACD32, 0x008080];
const PASTEL_COLORS = [0xFFB7C5, 0xE6E6FA, 0xADD8E6, 0x98FB98, 0xFFFFE0, 0xFFDAB9];

const foliageGroup = new THREE.Group();
worldGroup.add(foliageGroup);
const animatedFoliage = [];
const animatedObjects = [];
const MAX_OBJECTS = 2500;

function safeAddFoliage(obj, isObstacle = false, obstacleRadius = 1.0) {
    if (animatedFoliage.length > MAX_OBJECTS) return;
    if (obj.parent !== worldGroup && obj.parent !== foliageGroup && obj.parent !== scene) {
        foliageGroup.add(obj);
    }
    animatedFoliage.push(obj);
    if (isObstacle) {
        obstacles.push({ position: obj.position.clone(), radius: obstacleRadius });
    }
}

// --- CLUSTERS ---
const CLUSTER_COUNT = 60;

for (let i = 0; i < CLUSTER_COUNT; i++) {
    const cx = (Math.random() - 0.5) * 260;
    const cz = (Math.random() - 0.5) * 260;
    const type = Math.random();

    // 1. SUBWOOFER SWAMP (Lotus + Willows)
    if (type < 0.2) {
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            // Hover lotus slightly above ground
            const lotus = createSubwooferLotus({ color: 0x2E8B57 });
            lotus.position.set(x, y + 0.5, z);
            safeAddFoliage(lotus);
        }
        for (let j = 0; j < 2; j++) {
            const x = cx + (Math.random() - 0.5) * 20;
            const z = cz + (Math.random() - 0.5) * 20;
            const y = getGroundHeight(x, z);
            const willow = createFiberOpticWillow();
            willow.position.set(x, y, z);
            safeAddFoliage(willow, true, 1.0);
        }
    }
    // 2. ACCORDION GROVE (Toy Trees)
    else if (type < 0.4) {
        for (let j = 0; j < 6; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const palm = createAccordionPalm({ color: 0xFF6347 });
            palm.position.set(x, y, z);
            safeAddFoliage(palm, true, 0.8);
        }
    }
    // 3. MEADOW (Grass + Flowers)
    else if (type < 0.7) {
        for (let j = 0; j < 150; j++) {
            const r = Math.random() * 10;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const y = getGroundHeight(x, z);
            addGrassInstance(x, y, z);
        }
        for (let j = 0; j < 8; j++) {
            const r = Math.random() * 8;
            const theta = Math.random() * Math.PI * 2;
            const x = cx + r * Math.cos(theta);
            const z = cz + r * Math.sin(theta);
            const y = getGroundHeight(x, z);
            const f = createFlower({ color: 0xFF69B4 });
            f.position.set(x, y, z);
            safeAddFoliage(f);
        }
    }
    // 4. WEIRD GARDEN (Puffballs + Prisms)
    else {
        for (let j = 0; j < 5; j++) {
            const x = cx + (Math.random() - 0.5) * 15;
            const z = cz + (Math.random() - 0.5) * 15;
            const y = getGroundHeight(x, z);
            const obj = Math.random() < 0.5 ? createPrismRoseBush() : createPuffballFlower();
            obj.position.set(x, y, z);
            safeAddFoliage(obj);
        }
    }
}

const rainingClouds = [];
for (let i = 0; i < 25; i++) {
    const isRaining = Math.random() > 0.6;
    const cloud = isRaining ? createRainingCloud({ rainIntensity: 100 }) : createCloud();
    cloud.position.set(
        (Math.random() - 0.5) * 200,
        25 + Math.random() * 10,
        (Math.random() - 0.5) * 200
    );
    scene.add(cloud);

    if (cloud.userData.animationType === 'rain') {
        animatedFoliage.push(cloud);
        rainingClouds.push(cloud);
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

document.addEventListener('contextmenu', event => event.preventDefault());

const musicUpload = document.getElementById('musicUpload');
if (musicUpload) {
    musicUpload.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            audioSystem.loadModule(e.target.files[0]);
        }
    });
    musicUpload.addEventListener('click', (e) => e.stopPropagation());
    const label = document.querySelector('label[for="musicUpload"]');
    if (label) label.addEventListener('click', (e) => e.stopPropagation());
}

const toggleDayNightBtn = document.getElementById('toggleDayNight');
if (toggleDayNightBtn) {
    toggleDayNightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isNight = !isNight;
    });
}

document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') keyStates.forward = true;
    if (e.code === 'KeyS') keyStates.backward = true;
    if (e.code === 'KeyA') keyStates.left = true;
    if (e.code === 'KeyD') keyStates.right = true;
    if (e.code === 'Space') keyStates.jump = true;
    // Manual toggle 'N' removed/deprecated in favor of auto-cycle, 
    // but kept as debug override if needed:
    // if(e.code === 'KeyN') isNight = !isNight; 
});

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
    if (event.button === 2) {
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
    acceleration: 20.0,
    gravity: 20.0,
    jumpStrength: 10.0,
    height: 1.8,
    radius: 0.5
};

// --- Vehicles ---
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

function createWaterfall(height, colorHex = 0x87CEEB) {
    const particleCount = 2000;
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

function createGiantMushroom(x, z, scale = 8) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    const stemH = (1.5 + Math.random()) * scale;
    const stemR = (0.3 + Math.random() * 0.2) * scale;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.castShadow = true;
    group.add(stem);

    const capR = stemR * 3 + Math.random() * scale;
    const capGeo = new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const matIndex = Math.floor(Math.random() * materials.mushroomCap.length);
    const capMaterial = materials.mushroomCap[matIndex];
    const cap = new THREE.Mesh(capGeo, capMaterial);
    cap.position.y = stemH;

    const faceGroup = new THREE.Group();
    faceGroup.position.set(0, stemH * 0.6, stemR * 0.95);
    faceGroup.scale.set(scale, scale, scale);

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
    obstacles.push({
        position: new THREE.Vector3(x, height, z),
        radius: stemR * 1.2
    });

    // Randomize giant mushroom animation too
    const anims = ['wobble', 'bounce', 'accordion'];
    const chosenAnim = anims[Math.floor(Math.random() * anims.length)];
    group.userData.animationType = chosenAnim;
    group.userData.type = 'mushroom';

    const giantMushroom = { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: false };
    animatedObjects.push(giantMushroom);
    animatedFoliage.push(group);
}

function createGiantRainCloud(options = {}) {
    const { color = 0x555555, rainIntensity = 200 } = options;
    const group = new THREE.Group();

    const cloudGeo = new THREE.SphereGeometry(4.5, 32, 32);
    const cloudMat = materials.cloud.clone();
    cloudMat.color.setHex(color);
    const cloud = new THREE.Mesh(cloudGeo, cloudMat);
    cloud.castShadow = true;
    group.add(cloud);

    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainIntensity * 3);
    for (let i = 0; i < rainIntensity; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 9.0;
        positions[i * 3 + 1] = Math.random() * -6.0;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 9.0;
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 });
    const rain = new THREE.Points(rainGeo, rainMat);
    group.add(rain);

    group.userData.animationType = 'rain';
    return group;
}

function spawnKingMushroomZone(cx, cz) {
    const scale = 12;
    const stemH = 2.5 * scale;
    const stemR = 0.4 * scale;
    const capR = 1.5 * scale;

    const group = new THREE.Group();
    group.position.set(cx, getGroundHeight(cx, cz), cz);

    const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 32),
        materials.mushroomStem
    );
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    const cap = new THREE.Mesh(
        new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2),
        materials.mushroomCap[0]
    );
    cap.position.y = stemH;
    group.add(cap);

    const poolGeo = new THREE.CylinderGeometry(capR * 0.8, capR * 0.8, 0.5, 32);
    const poolMat = new THREE.MeshStandardMaterial({
        color: 0x0099FF,
        roughness: 0.1,
        metalness: 0.5
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.position.y = stemH + (capR * 0.2);
    group.add(pool);

    const waterfallOffset = capR * 0.8;
    const waterfall = createWaterfall(stemH);
    waterfall.position.set(0, stemH + 0.5, waterfallOffset);
    group.add(waterfall);

    obstacles.push({ position: group.position.clone(), radius: stemR * 1.2 });
    scene.add(group);
    animatedFoliage.push(waterfall);

    window.kingMushroomCap = cap;
    window.kingWaterfall = waterfall;

    const splashZone = new THREE.Object3D();
    splashZone.position.set(cx, 0, cz + waterfallOffset);
    splashZone.userData = { animationType: 'rain' };
    rainingClouds.push(splashZone);

    for (let i = 0; i < 20; i++) {
        const r = 15 + Math.random() * 30;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);

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

function spawnOvergrownZone(cx, cz) {
    const radius = 50;
    for (let i = 0; i < 3; i++) {
        const cloud = createGiantRainCloud({ rainIntensity: 200, color: 0x555555 });
        cloud.position.set(
            cx + (Math.random() - 0.5) * 30,
            60 + Math.random() * 10,
            cz + (Math.random() - 0.5) * 30
        );
        scene.add(cloud);
        animatedFoliage.push(cloud);
    }

    for (let i = 0; i < 15; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        createGiantMushroom(x, z, 8 + Math.random() * 7);
    }

    for (let i = 0; i < 30; i++) {
        const r = Math.random() * radius;
        const theta = Math.random() * Math.PI * 2;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        const y = getGroundHeight(x, z);

        const type = Math.random();
        let plant;
        let scale;

        if (type < 0.4) {
            plant = createHelixPlant({ color: 0x00FF00 });
            scale = 5 + Math.random() * 5;
        } else if (type < 0.7) {
            plant = createStarflower({ color: 0xFF00FF });
            scale = 4 + Math.random() * 4;
        } else {
            plant = createBubbleWillow({ color: 0x00BFFF });
            scale = 3 + Math.random() * 3;
        }

        plant.position.set(x, y, z);
        plant.scale.set(scale, scale, scale);
        safeAddFoliage(plant, true, 1.0 * scale);
    }
}

spawnOvergrownZone(-100, -100);
spawnKingMushroomZone(-100, -100);



// --- HELPER: Cycle Interpolation ---
// Smoothly blends between 4 sets of colors based on progress (0..1)
function getCycleState(progress) {
    // Schedule:
    // 0.00 - 0.40: DAY
    // 0.40 - 0.50: SUNSET (Day -> Sunset)
    // 0.50 - 0.55: DUSK (Sunset -> Night)
    // 0.55 - 0.90: NIGHT
    // 0.90 - 1.00: SUNRISE (Night -> Sunrise -> Day)

    // We'll perform manual LERP here for control
    let state = {};

    if (progress < 0.40) {
        // Full Day
        return PALETTE.day;
    } else if (progress < 0.50) {
        // Day -> Sunset
        const t = (progress - 0.40) / 0.10;
        return lerpPalette(PALETTE.day, PALETTE.sunset, t);
    } else if (progress < 0.55) {
        // Sunset -> Night
        const t = (progress - 0.50) / 0.05;
        return lerpPalette(PALETTE.sunset, PALETTE.night, t);
    } else if (progress < 0.90) {
        // Full Night
        return PALETTE.night;
    } else {
        // Night -> Sunrise -> Day
        // Split last 10% into two 5% chunks
        if (progress < 0.95) {
            const t = (progress - 0.90) / 0.05;
            return lerpPalette(PALETTE.night, PALETTE.sunrise, t);
        } else {
            const t = (progress - 0.95) / 0.05;
            return lerpPalette(PALETTE.sunrise, PALETTE.day, t);
        }
    }
}

function lerpPalette(p1, p2, t) {
    return {
        skyTop: p1.skyTop.clone().lerp(p2.skyTop, t),
        skyBot: p1.skyBot.clone().lerp(p2.skyBot, t),
        fog: p1.fog.clone().lerp(p2.fog, t),
        sun: p1.sun.clone().lerp(p2.sun, t),
        amb: p1.amb.clone().lerp(p2.amb, t),
        sunInt: THREE.MathUtils.lerp(p1.sunInt, p2.sunInt, t),
        ambInt: THREE.MathUtils.lerp(p1.ambInt, p2.ambInt, t)
    };
}

// --- ANIMATION LOOP ---
const clock = new THREE.Clock();
let audioState = null;

function animate() {
    const delta = clock.getDelta();
    const t = clock.getElapsedTime();

    audioState = audioSystem.update();

    // --- DAY/NIGHT CYCLE ---
    const cycleTime = t % CYCLE_DURATION;
    const progress = cycleTime / CYCLE_DURATION; // 0.0 to 1.0

    // Logic Switch for "Is Night" behavior (dancing lights)
    isNight = (progress > 0.50 && progress < 0.95);

    // Get Interpolated Colors
    const currentState = getCycleState(progress);

    // Apply to Scene
    uSkyTopColor.value.copy(currentState.skyTop);
    uSkyBottomColor.value.copy(currentState.skyBot);
    scene.fog.color.copy(currentState.fog);

    // Dynamic Fog Distance (Close in at night/sunset, far at day)
    let targetNear = 20;
    let targetFar = 100;
    if (isNight) {
        targetNear = 5;
        targetFar = 40;
    } else if (progress > 0.40 && progress < 0.55) { // Sunset/Dusk
        targetNear = 10;
        targetFar = 60;
    }

    // Lerp fog distance smoothly (dampened)
    scene.fog.near += (targetNear - scene.fog.near) * delta * 0.5;
    scene.fog.far += (targetFar - scene.fog.far) * delta * 0.5;

    // Apply Lighting
    sunLight.color.copy(currentState.sun);
    sunLight.intensity = currentState.sunInt;

    ambientLight.color.copy(currentState.amb); // Color shift for reflections!
    ambientLight.intensity = currentState.ambInt;

    // Stars only visible at night/dusk
    let starOpacity = 0;
    if (progress > 0.50 && progress < 0.95) starOpacity = 1; // Night
    else if (progress > 0.45 && progress <= 0.50) starOpacity = (progress - 0.45) / 0.05; // Fade In
    else if (progress >= 0.95) starOpacity = 1.0 - (progress - 0.95) / 0.05; // Fade Out

    if (stars.material) stars.material.opacity = starOpacity;

    // --- Audio Reactivity ---
    updateFoliageMaterials(audioState, isNight);
    animatedFoliage.forEach(f => animateFoliage(f, t, audioState, !isNight));

    // --- Player Movement ---
    if (controls.isLocked) {
        player.velocity.x -= player.velocity.x * 10.0 * delta;
        player.velocity.z -= player.velocity.z * 10.0 * delta;
        player.velocity.y -= player.gravity * delta;

        const direction = new THREE.Vector3();
        direction.z = Number(keyStates.forward) - Number(keyStates.backward);
        direction.x = Number(keyStates.right) - Number(keyStates.left);
        direction.normalize();

        if (keyStates.forward || keyStates.backward) player.velocity.z -= direction.z * player.speed * delta;
        if (keyStates.left || keyStates.right) player.velocity.x -= direction.x * player.speed * delta;

        controls.moveRight(-player.velocity.x * delta);
        controls.moveForward(-player.velocity.z * delta);

        const groundY = getGroundHeight(camera.position.x, camera.position.z);
        if (camera.position.y < groundY + 1.8) {
            camera.position.y = groundY + 1.8;
            player.velocity.y = 0;
            if (keyStates.jump) player.velocity.y = 10;
        } else {
            camera.position.y += player.velocity.y * delta;
        }
    }

    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});