/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js';
import { WebGPURenderer, PointsNodeMaterial } from 'three/webgpu';
import { color, float, vec3, time, positionLocal, attribute, storage, uniform, uv } from 'three/tsl';
import { createFlower, createGrass, createFloweringTree, createShrub, animateFoliage, createGlowingFlower, createFloatingOrb, createVine, createStarflower, createBellBloom, createWisteriaCluster, createRainingCloud, createLeafParticle, createGlowingFlowerPatch, createFloatingOrbCluster, createVineCluster, createBubbleWillow, createPuffballFlower, createHelixPlant, createBalloonBush, createPrismRoseBush, initGrassSystem, addGrassInstance, updateFoliageMaterials } from '@/foliage';
import { createSky, uSkyTopColor, uSkyBottomColor } from '@/sky';
import { createStars, uStarPulse, uStarColor } from '@/stars';
import { AudioSystem } from '@/audio-system';

async function loadScript(src: string) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

(async () => {
  try {
    await loadScript('./assets/libopenmpt.js');
    main();
  } catch (e) {
    console.error(e);
  }
})();

async function main() {
  // --- Configuration ---
  const CONFIG = {
      colors: {
          sky: 0x87CEEB,
          ground: 0x98FB98,
          fog: 0xFFB6C1,
          light: 0xFFFFFF,
          ambient: 0xFFA07A
      }
  };

  // --- Scene Setup ---
  const canvas = document.querySelector('#glCanvas') as HTMLCanvasElement;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(CONFIG.colors.fog, 20, 100);

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
  const ambientLight = new THREE.HemisphereLight(CONFIG.colors.sky, CONFIG.colors.ground, 1.0);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(CONFIG.colors.light, 0.8);
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
  function createClayMaterial(colorHex: number) {
      return new THREE.MeshStandardMaterial({
          color: colorHex,
          metalness: 0.0,
          roughness: 0.8,
          flatShading: false
      });
  }

  const materials = {
      ground: createClayMaterial(CONFIG.colors.ground),
      trunk: createClayMaterial(0x8B5A2B),
      leaves: [
          createClayMaterial(0xFF69B4),
          createClayMaterial(0x87CEEB),
          createClayMaterial(0xDDA0DD),
          createClayMaterial(0xFFD700),
      ],
      mushroomStem: createClayMaterial(0xF5DEB3),
      mushroomCap: [
          createClayMaterial(0xFF6347),
          createClayMaterial(0xDA70D6),
          createClayMaterial(0xFFA07A),
      ],
      eye: new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1 }),
      mouth: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 }),
      cloud: new THREE.MeshStandardMaterial({ color: 0xFFFFFF, roughness: 0.3, transparent: true, opacity: 0.9 }),
      drivableMushroomCap: createClayMaterial(0x00BFFF)
  };

  // --- Physics Data ---
  const obstacles: Array<{ position: THREE.Vector3; radius: number }> = [];

  // --- Procedural Generation ---

  // 1. Ground (Rolling Hills)
  const groundGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
  const posAttribute = groundGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < posAttribute.count; i++) {
      const x = posAttribute.getX(i);
      const y = posAttribute.getY(i);
      const z = Math.sin(x * 0.05) * 2 + Math.cos(y * 0.05) * 2;
      posAttribute.setZ(i, z);
  }
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, materials.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function getGroundHeight(x: number, z: number) {
      return Math.sin(x * 0.05) * 2 + Math.cos(-z * 0.05) * 2;
  }

  // 2. Objects Container
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  // Initialize Instancing (Grass)
  initGrassSystem(scene, 10000);

  // 3. Trees
  function createTree(x: number, z: number) {
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
      obstacles.push({ position: new THREE.Vector3(x, height, z), radius: 0.8 });
  }

  // 4. Fantasy Mushrooms with Faces
  const eyeGeo = new THREE.SphereGeometry(0.05, 16, 16);

  function createMushroom(x: number, z: number, options: any = {}) {
      const height = getGroundHeight(x, z);
      const group = new THREE.Group();
      group.position.set(x, height, z);

      const stemH = 1.5 + Math.random();
      const stemR = 0.3 + Math.random() * 0.2;
      const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
      const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
      stem.castShadow = true;
      stem.position.y = stemH / 2;
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
      group.add(faceGroup);
      group.add(cap);

      worldGroup.add(group);
      obstacles.push({ position: new THREE.Vector3(x, height, z), radius: stemR * 2 });
      return { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: isDrivable } as any;
  }

  // 5. Clouds
  const clouds: Array<{ mesh: THREE.Object3D; speed: number }> = [];
  function createCloud() {
      const group = new THREE.Group();
      const blobs = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < blobs; i++) {
          const size = 2 + Math.random() * 2;
          const geo = new THREE.SphereGeometry(size, 16, 16);
          const mesh = new THREE.Mesh(geo, materials.cloud);
          mesh.position.set((Math.random() - 0.5) * size * 1.5, (Math.random() - 0.5) * size * 0.5, (Math.random() - 0.5) * size * 1.5);
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
  const animatedFoliage: THREE.Object3D[] = [];
  const animatedObjects: any[] = [];
  const MAX_OBJECTS = 2500;

  function safeAddFoliage(obj: THREE.Object3D, isObstacle = false, obstacleRadius = 1.0) {
      if (animatedFoliage.length > MAX_OBJECTS) return;
      if (obj.parent !== worldGroup && obj.parent !== foliageGroup && obj.parent !== scene) {
          foliageGroup.add(obj);
      }
      animatedFoliage.push(obj);
      if (isObstacle) obstacles.push({ position: obj.position.clone() as THREE.Vector3, radius: obstacleRadius });
  }

  function spawnCluster(cx: number, cz: number) {
      const typeRoll = Math.random();
      let count = 10 + Math.floor(Math.random() * 10);
      let radius = 15 + Math.random() * 10;
      if (typeRoll < 0.3) {
          for (let i = 0; i < count * 2; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const y = getGroundHeight(x, z);
              if (Math.random() < 0.7) addGrassInstance(x, y, z);
              else {
                  const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
                  const shape = ['simple', 'multi', 'spiral'][Math.floor(Math.random() * 3)];
                  const flower = createFlower({ color, shape });
                  flower.position.set(x, y, z);
                  safeAddFoliage(flower);
              }
          }
      } else if (typeRoll < 0.5) {
          count = 5 + Math.floor(Math.random() * 3);
          for (let i = 0; i < count; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              if (Math.random() < 0.4) createTree(x, z);
              else {
                  const color = TREE_COLORS[Math.floor(Math.random() * TREE_COLORS.length)];
                  const tree = createFloweringTree({ color });
                  tree.position.set(x, getGroundHeight(x, z), z);
                  safeAddFoliage(tree, true, 1.5);
              }
          }
          for (let i = 0; i < count * 2; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const color = SHRUB_COLORS[Math.floor(Math.random() * SHRUB_COLORS.length)];
              const shrub = createShrub({ color });
              shrub.position.set(x, getGroundHeight(x, z), z);
              safeAddFoliage(shrub, true, 0.8);
          }
      } else if (typeRoll < 0.65) {
          for (let i = 0; i < count; i++) {
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
      } else if (typeRoll < 0.75) {
          for (let i = 0; i < 5; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
              const tree = createBubbleWillow({ color });
              tree.position.set(x, getGroundHeight(x, z), z);
              safeAddFoliage(tree, true, 1.2);
          }
          for (let i = 0; i < 10; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
              const puff = createPuffballFlower({ color });
              puff.position.set(x, getGroundHeight(x, z), z);
              safeAddFoliage(puff);
          }
      } else if (typeRoll < 0.90) {
          for (let i = 0; i < 8; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const rose = createPrismRoseBush();
              rose.position.set(x, getGroundHeight(x, z), z);
              safeAddFoliage(rose, true, 1.0);
          }
      } else {
          for (let i = 0; i < 12; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              if (Math.random() < 0.5) {
                  const color = PASTEL_COLORS[Math.floor(Math.random() * PASTEL_COLORS.length)];
                  const helix = createHelixPlant({ color });
                  helix.position.set(x, getGroundHeight(x, z), z);
                  safeAddFoliage(helix);
              } else {
                  const color = FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)];
                  const sf = createStarflower({ color });
                  sf.position.set(x, getGroundHeight(x, z), z);
                  safeAddFoliage(sf);
              }
          }
          for (let i = 0; i < 3; i++) {
              const r = Math.random() * radius;
              const theta = Math.random() * Math.PI * 2;
              const x = cx + r * Math.cos(theta);
              const z = cz + r * Math.sin(theta);
              const bb = createBalloonBush({ color: 0xFF4500 });
              bb.position.set(x, getGroundHeight(x, z), z);
              safeAddFoliage(bb, true, 1.0);
          }
      }
  }

  const CLUSTER_COUNT = 60;
  for (let i = 0; i < CLUSTER_COUNT; i++) {
      const cx = (Math.random() - 0.5) * 260;
      const cz = (Math.random() - 0.5) * 260;
      spawnCluster(cx, cz);
  }

  const rainingClouds: any[] = [];
  for (let i = 0; i < 25; i++) {
      const isRaining = Math.random() > 0.6;
      const cloud = isRaining ? createRainingCloud({ rainIntensity: 100 }) : createCloud();
      cloud.position.set((Math.random() - 0.5) * 200, 25 + Math.random() * 10, (Math.random() - 0.5) * 200);
      scene.add(cloud);
      if ((cloud as any).userData?.animationType === 'rain') {
          animatedFoliage.push(cloud);
          rainingClouds.push(cloud);
      } else {
          clouds.push({ mesh: cloud, speed: (Math.random() * 0.05) + 0.02 });
      }
  }

  // --- Player & Input Logic ---
  const controls = new PointerLockControls(camera, document.body);
  const instructions = document.getElementById('instructions') as HTMLElement;
  instructions.addEventListener('click', function () { controls.lock(); });
  controls.addEventListener('lock', function () { instructions.style.display = 'none'; });
  controls.addEventListener('unlock', function () { instructions.style.display = 'flex'; });
  document.addEventListener('contextmenu', event => event.preventDefault());

  const musicUpload = document.getElementById('musicUpload') as HTMLInputElement | null;
  if (musicUpload) {
      musicUpload.addEventListener('change', (e: any) => { if (e.target.files.length > 0) audioSystem.loadModule(e.target.files[0]); });
      musicUpload.addEventListener('click', (e) => e.stopPropagation());
      const label = document.querySelector('label[for="musicUpload"]');
      if (label) label.addEventListener('click', (e) => e.stopPropagation());
  }

  const toggleDayNightBtn = document.getElementById('toggleDayNight');
  if (toggleDayNightBtn) toggleDayNightBtn.addEventListener('click', (e) => { e.stopPropagation(); isNight = !isNight; });
  document.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).code === 'KeyN') isNight = !isNight; });

  const keyStates: any = { forward: false, backward: false, left: false, right: false, jump: false, sneak: false, sprint: false };
  const onKeyDown = function (event: KeyboardEvent) { if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') event.preventDefault(); switch (event.code) { case 'KeyW': break; case 'KeyA': keyStates.left = true; break; case 'KeyS': keyStates.backward = true; break; case 'KeyD': keyStates.right = true; break; case 'Space': keyStates.jump = true; break; case 'ControlLeft': case 'ControlRight': keyStates.sneak = true; event.preventDefault(); break; case 'ShiftLeft': case 'ShiftRight': keyStates.sprint = true; break; } };
  const onKeyUp = function (event: KeyboardEvent) { switch (event.code) { case 'KeyW': break; case 'KeyA': keyStates.left = false; break; case 'KeyS': keyStates.backward = false; break; case 'KeyD': keyStates.right = false; break; case 'Space': keyStates.jump = false; break; case 'ControlLeft': case 'ControlRight': keyStates.sneak = false; break; case 'ShiftLeft': case 'ShiftRight': keyStates.sprint = false; break; } };
  const onMouseDown = function (event: MouseEvent) { if (event.button === 2) keyStates.forward = true; };
  const onMouseUp = function (event: MouseEvent) { if (event.button === 2) keyStates.forward = false; };
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);

  const player: any = { velocity: new THREE.Vector3(), direction: new THREE.Vector3(), sneakSpeed: 10.0, runSpeed: 30.0, sprintSpeed: 50.0, currentSpeed: 30.0, acceleration: 20.0, gravity: 20.0, jumpStrength: 10.0, height: 1.8, radius: 0.5 };

  let drivingMushroom: any = null; let previousCameraPosition: THREE.Vector3 | null = null;
  function findNearestDrivableMushroom() {
      let minDist = Infinity; let nearest = null;
      const camPos = camera.position;
      animatedObjects.forEach((obj) => {
          if (obj.type === 'mushroom' && obj.drivable) {
              const mPos = (obj.mesh as THREE.Object3D).position;
              const dx = camPos.x - mPos.x;
              const dz = camPos.z - mPos.z;
              const dist = Math.sqrt(dx * dx + dz * dz);
              if (dist < minDist) { minDist = dist; nearest = obj; }
          }
      });
      return nearest;
  }
  function startDrivingMushroom(mushroom: any) { drivingMushroom = mushroom; previousCameraPosition = camera.position.clone(); camera.position.copy(mushroom.mesh.position); }
  function stopDrivingMushroom() { if (previousCameraPosition) { camera.position.copy(previousCameraPosition); } drivingMushroom = null; }
  document.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).code === 'KeyM') { if (drivingMushroom) stopDrivingMushroom(); else { const nearest = findNearestDrivableMushroom(); if (nearest) startDrivingMushroom(nearest); } } });

  let cloudHelicopter: any = null; let cloudIsRaining = false; let previousCameraPositionCloud: THREE.Vector3 | null = null;
  function summonCloudHelicopter() { if (!cloudHelicopter) { cloudHelicopter = createCloud(); cloudHelicopter.position.set(camera.position.x, camera.position.y + 10, camera.position.z); scene.add(cloudHelicopter); previousCameraPositionCloud = camera.position.clone(); camera.position.copy(cloudHelicopter.position); } }
  function dismissCloudHelicopter() { if (cloudHelicopter) { scene.remove(cloudHelicopter); cloudHelicopter = null; cloudIsRaining = false; if (previousCameraPositionCloud) camera.position.copy(previousCameraPositionCloud); } }
  function toggleCloudRain() { cloudIsRaining = !cloudIsRaining; }
  document.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).code === 'KeyC') { if (cloudHelicopter) dismissCloudHelicopter(); else summonCloudHelicopter(); } if ((event as KeyboardEvent).code === 'KeyR' && cloudHelicopter) toggleCloudRain(); });

  // Waterfall + Giant mushrooms + zone generators
  function createWaterfall(height: number, colorHex = 0x87CEEB) {
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
      const mat = new PointsNodeMaterial({ color: colorHex, size: 0.4, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
      const aSpeed = attribute('aSpeed', 'float');
      const aOffset = attribute('aOffset', 'float');
      const uSpeed = uniform(1.0);
      // @ts-ignore
      (mat as any).uSpeed = uSpeed;
      const t = time.mul(uSpeed);
      const fallHeight = float(height);
      const currentDist = aOffset.add(aSpeed.mul(t));
      const modDist = currentDist.mod(fallHeight);
      const newY = modDist.negate();
      // @ts-ignore
      mat.positionNode = vec3(positionLocal.x, newY, positionLocal.z);
      const waterfall = new THREE.Points(geo, mat as any);
      (waterfall as any).userData = { animationType: 'gpuWaterfall' };
      return waterfall;
  }

  function createGiantMushroom(x: number, z: number, scale = 8) {
      const height = getGroundHeight(x, z);
      const group = new THREE.Group();
      group.position.set(x, height, z);

      const stemH = (1.5 + Math.random()) * scale;
      const stemR = (0.3 + Math.random() * 0.2) * scale;
      const stemGeo = new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 16);
      const stem = new THREE.Mesh(stemGeo, materials.mushroomStem);
      stem.castShadow = true;
      stem.position.y = stemH / 2;
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
      obstacles.push({ position: new THREE.Vector3(x, height, z), radius: stemR * 1.2 });
      const giantMushroom = { mesh: group, type: 'mushroom', speed: Math.random() * 0.02 + 0.01, offset: Math.random() * 100, drivable: false };
      (group as any).userData.type = 'mushroom';
      animatedObjects.push(giantMushroom);
      animatedFoliage.push(group);
  }

  function createGiantRainCloud(options: any = {}) { const { color = 0x555555, rainIntensity = 200 } = options; const group = new THREE.Group(); const cloudGeo = new THREE.SphereGeometry(4.5, 32, 32); const cloudMat = (materials.cloud as THREE.MeshStandardMaterial).clone(); cloudMat.color.setHex(color); const cloud = new THREE.Mesh(cloudGeo, cloudMat); cloud.castShadow = true; group.add(cloud); const rainGeo = new THREE.BufferGeometry(); const positions = new Float32Array(rainIntensity * 3); for (let i = 0; i < rainIntensity; i++) { positions[i*3] = (Math.random() - 0.5) * 9.0; positions[i*3 + 1] = Math.random() * -6.0; positions[i*3 + 2] = (Math.random() - 0.5) * 9.0; } rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3)); const rainMat = new THREE.PointsMaterial({ color: 0x87CEEB, size: 0.05 }); const rain = new THREE.Points(rainGeo, rainMat); group.add(rain); (group as any).userData.animationType = 'rain'; return group; }

  function spawnKingMushroomZone(cx: number, cz: number) {
      console.log(`Spawning King Mushroom at ${cx}, ${cz}`);
      const scale = 12; const stemH = 2.5 * scale; const stemR = 0.4 * scale; const capR = 1.5 * scale; const group = new THREE.Group(); group.position.set(cx, getGroundHeight(cx,cz), cz);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(stemR * 0.8, stemR, stemH, 32), materials.mushroomStem); stem.position.y = stemH / 2; stem.castShadow = true; group.add(stem);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 32, 32, 0, Math.PI*2, 0, Math.PI/2), materials.mushroomCap[0]); cap.position.y = stemH; group.add(cap);
      const poolGeo = new THREE.CylinderGeometry(capR * 0.8, capR * 0.8, 0.5, 32); const poolMat = new THREE.MeshStandardMaterial({ color: 0x0099FF, roughness: 0.1, metalness: 0.5 }); const pool = new THREE.Mesh(poolGeo, poolMat); pool.position.y = stemH + (capR * 0.2); group.add(pool);
      const waterfall = createWaterfall(stemH); waterfall.position.set(0, stemH + 0.5, capR * 0.8); group.add(waterfall);
      obstacles.push({ position: group.position.clone(), radius: stemR * 1.2 }); scene.add(group); animatedFoliage.push(waterfall); (window as any).kingMushroomCap = cap; (window as any).kingWaterfall = waterfall; const splashZone = new THREE.Object3D(); splashZone.position.set(cx, 0, cz + capR * 0.8); (splashZone as any).userData = { animationType: 'rain' }; rainingClouds.push(splashZone);
      for (let i = 0; i < 20; i++) { const r = 15 + Math.random() * 30; const theta = Math.random() * Math.PI * 2; const x = cx + r * Math.cos(theta); const z = cz + r * Math.sin(theta); const type = Math.random(); let plant; if (type < 0.33) plant = createBubbleWillow({ color: 0xDA70D6 }); else if (type < 0.66) plant = createHelixPlant({ color: 0x7FFFD4 }); else plant = createStarflower({ color: 0xFFD700 }); const pScale = 4 + Math.random() * 4; plant.position.set(x, getGroundHeight(x, z), z); plant.scale.set(pScale, pScale, pScale); safeAddFoliage(plant, true, 1.0 * pScale); }
  }

  function spawnOvergrownZone(cx: number, cz: number) {
      console.log(`Spawning Overgrown Zone at ${cx}, ${cz}`);
      const radius = 50;
      for (let i = 0; i < 3; i++) { const cloud = createGiantRainCloud({ rainIntensity: 200, color: 0x555555 }); cloud.position.set(cx + (Math.random()-0.5)*30, 60 + Math.random()*10, cz + (Math.random()-0.5)*30); scene.add(cloud); animatedFoliage.push(cloud); }
      for (let i = 0; i < 15; i++) { const r = Math.random() * radius; const theta = Math.random() * Math.PI * 2; const x = cx + r * Math.cos(theta); const z = cz + r * Math.sin(theta); createGiantMushroom(x, z, 8 + Math.random() * 7); }
      for (let i = 0; i < 30; i++) { const r = Math.random() * radius; const theta = Math.random() * Math.PI * 2; const x = cx + r * Math.cos(theta); const z = cz + r * Math.sin(theta); const y = getGroundHeight(x, z); const type = Math.random(); let plant; let scale; if (type < 0.4) { plant = createHelixPlant({ color: 0x00FF00 }); scale = 5 + Math.random() * 5; } else if (type < 0.7) { plant = createStarflower({ color: 0xFF00FF }); scale = 4 + Math.random() * 4; } else { plant = createBubbleWillow({ color: 0x00BFFF }); scale = 3 + Math.random() * 3; } plant.position.set(x, y, z); plant.scale.set(scale, scale, scale); safeAddFoliage(plant, true, 1.0 * scale); }
  }

  spawnOvergrownZone(-100, -100);
  spawnKingMushroomZone(-100, -100);

  const clock = new THREE.Clock();

  async function animate() {
      const delta = clock.getDelta();
      const t = clock.getElapsedTime();
      const audioState = audioSystem.update();
      const targetFactor = isNight ? 1.0 : 0.0;
      dayNightFactor += (targetFactor - dayNightFactor) * delta * 2.0;
      uSkyTopColor.value.lerpColors(new THREE.Color(0x87CEEB), new THREE.Color(0x000020), dayNightFactor);
      uSkyBottomColor.value.lerpColors(new THREE.Color(0xFFB6C1), new THREE.Color(0x000020), dayNightFactor);
      const dayFog = new THREE.Color(CONFIG.colors.fog); const nightFog = new THREE.Color(0x050510); scene.fog.color.lerpColors(dayFog, nightFog, dayNightFactor);
      sunLight.intensity = THREE.MathUtils.lerp(0.8, 0.0, dayNightFactor); ambientLight.intensity = THREE.MathUtils.lerp(1.0, 0.2, dayNightFactor);
      if ((stars as any).material) (stars as any).material.opacity = dayNightFactor;
      if (audioState && isNight) { (uStarPulse as any).value = audioState.kickTrigger; const hue = (t * 0.1 + audioState.beatPhase) % 1; (uStarColor as any).value.setHSL(hue, 1.0, 0.8); }
      if ((window as any).kingMushroomCap && audioState) { const kick = audioState.kickTrigger || 0; const groove = audioState.grooveAmount || 0; const targetScale = 1.0 + kick * 0.3; ((window as any).kingMushroomCap as THREE.Object3D).scale.setScalar(targetScale); if ((window as any).kingWaterfall && (window as any).kingWaterfall.material && ((window as any).kingWaterfall.material as any).uSpeed) { ((window as any).kingWaterfall.material as any).uSpeed.value = 1.0 + groove * 5.0; } }
      updateFoliageMaterials(audioState, isNight);
      if ((controls as any).isLocked) {
          let targetSpeed = player.runSpeed; if (keyStates.sneak) targetSpeed = player.sneakSpeed; if (keyStates.sprint) targetSpeed = player.sprintSpeed; if (player.currentSpeed < targetSpeed) player.currentSpeed += player.acceleration * delta; if (player.currentSpeed > targetSpeed) player.currentSpeed -= player.acceleration * delta; player.velocity.x -= player.velocity.x * 10.0 * delta; player.velocity.z -= player.velocity.z * 10.0 * delta; player.velocity.y -= player.gravity * delta; player.direction.z = Number(keyStates.forward) - Number(keyStates.backward); player.direction.x = Number(keyStates.right) - Number(keyStates.left); player.direction.normalize(); if (keyStates.forward || keyStates.backward) player.velocity.z -= player.direction.z * player.currentSpeed * delta; if (keyStates.left || keyStates.right) player.velocity.x -= player.direction.x * player.currentSpeed * delta; if (keyStates.jump) { if (camera.position.y <= getGroundHeight(camera.position.x, camera.position.z) + player.height + 0.5) player.velocity.y = player.jumpStrength; } if (!drivingMushroom && !cloudHelicopter) { (controls as any).moveRight(-player.velocity.x * delta); (controls as any).moveForward(-player.velocity.z * delta); camera.position.y += player.velocity.y * delta; const groundY = getGroundHeight(camera.position.x, camera.position.z); if (camera.position.y < groundY + player.height) { player.velocity.y = 0; camera.position.y = groundY + player.height; } } }
      if (drivingMushroom) { let moveSpeed = 10 * delta; let moveX = 0, moveZ = 0; if (keyStates.forward) moveZ -= moveSpeed; if (keyStates.backward) moveZ += moveSpeed; if (keyStates.left) moveX -= moveSpeed; if (keyStates.right) moveX += moveSpeed; drivingMushroom.mesh.position.x += moveX; drivingMushroom.mesh.position.z += moveZ; camera.position.copy(drivingMushroom.mesh.position); const groundY = getGroundHeight(drivingMushroom.mesh.position.x, drivingMushroom.mesh.position.z); drivingMushroom.mesh.position.y = groundY; }
      if (cloudHelicopter) { let moveSpeed = 15 * delta; let moveX = 0, moveY = 0, moveZ = 0; if (keyStates.forward) moveZ -= moveSpeed; if (keyStates.backward) moveZ += moveSpeed; if (keyStates.left) moveX -= moveSpeed; if (keyStates.right) moveX += moveSpeed; if (keyStates.jump) moveY += moveSpeed; if (keyStates.sneak) moveY -= moveSpeed; cloudHelicopter.position.x += moveX; cloudHelicopter.position.y += moveY; cloudHelicopter.position.z += moveZ; camera.position.copy(cloudHelicopter.position); }
      animatedFoliage.forEach(foliage => { animateFoliage(foliage, t, audioState, !isNight); });
      clouds.forEach(cloud => { cloud.mesh.position.x += cloud.speed; if (cloud.mesh.position.x > 120) cloud.mesh.position.x = -120; });
      rainingClouds.forEach(cloud => {
          cloud.position.x += 0.01;
          if (cloud.position.x > 120) cloud.position.x = -120;
          if (cloudIsRaining || (cloud as any).userData.animationType === 'rain') {
              for (let k = 0; k < 5; k++) {
                  if (animatedFoliage.length === 0) break;
                  const idx = Math.floor(Math.random() * animatedFoliage.length);
                  const plant = animatedFoliage[idx];
                  if ((plant as any).userData.animationType === 'rain') continue;
                  const dx = (plant as any).position.x - cloud.position.x;
                  const dz = (plant as any).position.z - cloud.position.z;
                  if (dx * dx + dz * dz < 25) {
                      if ((plant as any).scale.y < 2.0) (plant as any).scale.multiplyScalar(1.002);
                  }
              }

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
                      let baby: any;
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

  renderer.setAnimationLoop(animate);
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
}
