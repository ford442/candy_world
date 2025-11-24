import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { WebGPURenderer } from 'three/webgpu';

// --- Configuration ---
const CONFIG = {
    colors: {
        sky: 0xB0E0E6,        // Powder Blue
        ground: 0xB8F0A8,     // Pastel Mint Green
        fog: 0xFFD1DC,        // Pastel Pink fog
        light: 0xFFFFFF,
        ambient: 0xFFE4E1     // Misty Rose
    }
};

// --- Scene Setup ---
const canvas = document.querySelector('#glCanvas');
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.sky);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 20, 100);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 15, 40);

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

// --- Controls ---
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent going under ground
controls.minDistance = 5;
controls.maxDistance = 100;

// --- Lighting ---
const ambientLight = new THREE.HemisphereLight(CONFIG.colors.sky, CONFIG.colors.ground, 0.6);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(CONFIG.colors.light, 1.5);
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
function createCandyMaterial(color) {
    return new THREE.MeshPhysicalMaterial({
        color: color,
        metalness: 0.0,
        roughness: 0.2,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
    });
}

const materials = {
    ground: new THREE.MeshStandardMaterial({
        color: CONFIG.colors.ground,
        roughness: 0.8,
        flatShading: false
    }),
    trunk: createCandyMaterial(0x8B5A2B), // Brownish
    leaves: [
        createCandyMaterial(0xFF69B4), // Hot Pink
        createCandyMaterial(0x87CEEB), // Sky Blue
        createCandyMaterial(0xDDA0DD), // Plum
        createCandyMaterial(0xFFD700), // Gold
    ],
    mushroomStem: createCandyMaterial(0xFFFFF0), // Ivory
    mushroomCap: [
        createCandyMaterial(0xFF0000), // Red
        createCandyMaterial(0x9932CC), // Dark Orchid
        createCandyMaterial(0xFF4500), // Orange Red
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

// --- Procedural Generation ---

// 1. Ground (Rolling Hills)
const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
const posAttribute = groundGeo.attributes.position;
for (let i = 0; i < posAttribute.count; i++) {
    const x = posAttribute.getX(i);
    const y = posAttribute.getY(i); // This is actually Z in world space initially before rotation, but Plane lies on XY usually? No, standard is XY.
    // We will rotate -90 X later, so let's perturb Z (which becomes height Y)
    // Actually PlaneGeometry is on XY plane.

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
    return Math.sin(x * 0.05) * 2 + Math.cos(-z * 0.05) * 2; // Note: z coordinate is y in plane geo logic
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
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, trunkH, 8);
    const trunk = new THREE.Mesh(trunkGeo, materials.trunk);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    // Leaves (Spheres)
    const leavesR = 1.5 + Math.random();
    const leavesGeo = new THREE.SphereGeometry(leavesR, 16, 16);
    const matIndex = Math.floor(Math.random() * materials.leaves.length);
    const leaves = new THREE.Mesh(leavesGeo, materials.leaves[matIndex]);
    leaves.position.y = trunkH + leavesR * 0.8;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    group.add(leaves);

    worldGroup.add(group);
}

// 4. Fantasy Mushrooms with Faces
function createMushroom(x, z) {
    const height = getGroundHeight(x, z);
    const group = new THREE.Group();
    group.position.set(x, height, z);

    // Stem
    const stemH = 1.5 + Math.random();
    const stemR = 0.3 + Math.random() * 0.2;
    const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 10);
    const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
    stem.position.y = stemH / 2;
    stem.castShadow = true;
    group.add(stem);

    // Cap
    const capR = stemR * 3 + Math.random();
    // Use Sphere but cut off bottom
    const capGeo = new THREE.SphereGeometry(capR, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2);
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

    // Animate rotation slightly for "looking"
    faceGroup.lookAt(camera.position.x, faceGroup.position.y, camera.position.z); // Initial look (will fix later if needed)

    worldGroup.add(group);

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

// Populate World
for(let i=0; i<30; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    createTree(x, z);
}

const animatedObjects = [];
for(let i=0; i<20; i++) {
    const x = (Math.random() - 0.5) * 180;
    const z = (Math.random() - 0.5) * 180;
    const obj = createMushroom(x, z);
    animatedObjects.push(obj);
}

for(let i=0; i<15; i++) {
    createCloud();
}

// --- Animation Loop ---
async function animate(time) {
    requestAnimationFrame(animate);

    const t = time * 0.001;

    controls.update();

    // Animate Mushrooms (Bounce)
    animatedObjects.forEach(obj => {
        if (obj.type === 'mushroom') {
            obj.mesh.scale.y = 1 + Math.sin(t * 3 + obj.offset) * 0.05;
            obj.mesh.rotation.z = Math.sin(t * 2 + obj.offset) * 0.05;
        }
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

animate(0);
