// src/world/generation.ts

import * as THREE from 'three';
import { getGroundHeight } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createWaterfall, createWaveformWater, createFireflies, initFallingBerries,
    initGrassSystem, addGrassInstance,
    createArpeggioFern, createPortamentoPine, createCymbalDandelion, createSnareTrap,
    createBubbleWillow, createHelixPlant, createBalloonBush, createWisteriaCluster,
    createPanningPad, createSilenceSpirit, createInstrumentShrine, createMelodyMirror
} from '../foliage/index.js';
import { createCaveEntrance } from '../foliage/cave.js';
import { validateFoliageMaterials } from '../foliage/common.js';
import { CONFIG } from '../core/config.js';
import { registerPhysicsCave } from '../systems/physics.js';
import {
    animatedFoliage, obstacles, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, vineSwings, worldGroup
} from './state.js';
import mapData from '../../assets/map.json';

// Type definitions for map data
interface MapEntity {
    type: string;
    position: [number, number, number];
    variant?: string;
    scale?: number;
    size?: number | string;
    note?: string;        // Musical note for mushrooms
    noteIndex?: number;   // Note index (0-11) for mushrooms
    hasFace?: boolean;    // Whether mushroom has a face
}

interface ObstacleData {
    position: THREE.Vector3;
    radius: number;
}

interface WorldObjects {
    sky: THREE.Object3D;
    moon: THREE.Object3D;
    ground: THREE.Mesh;
}

interface WeatherSystem {
    registerTree(obj: THREE.Object3D): void;
    registerShrub(obj: THREE.Object3D): void;
    registerMushroom(obj: THREE.Object3D): void;
    registerCave(obj: THREE.Object3D): void;
}

// --- Lake Configuration (Mirrored in Physics.js) ---
const LAKE_BOUNDS = { minX: -38, maxX: 78, minZ: -28, maxZ: 68 };
const LAKE_BOTTOM = -2.0;

// Helper: Calculate Unified Ground Height (WASM + Visual Lake Modifiers)
// Matches logic in src/systems/physics.js
function getUnifiedGroundHeight(x: number, z: number): number {
    let height = getGroundHeight(x, z);

    if (x > LAKE_BOUNDS.minX && x < LAKE_BOUNDS.maxX && z > LAKE_BOUNDS.minZ && z < LAKE_BOUNDS.maxZ) {
        const distX = Math.min(x - LAKE_BOUNDS.minX, LAKE_BOUNDS.maxX - x);
        const distZ = Math.min(z - LAKE_BOUNDS.minZ, LAKE_BOUNDS.maxZ - z);
        const distEdge = Math.min(distX, distZ);

        // Smooth blend area (10 units wide)
        const blend = Math.min(1.0, distEdge / 10.0);
        const targetHeight = THREE.MathUtils.lerp(height, LAKE_BOTTOM, blend);

        if (targetHeight < height) {
            height = targetHeight;
        }
    }
    return height;
}

// --- Scene Setup ---

export function initWorld(scene: THREE.Scene, weatherSystem: WeatherSystem, loadContent: boolean = true): WorldObjects {
    // 0. Pre-flight Check
    validateFoliageMaterials();

    // Sky
    const sky = createSky();
    scene.add(sky);

    // Stars
    const stars = createStars();
    scene.add(stars);

    // Moon
    const moon = createMoon();
    moon.position.set(-50, 60, -30); // High up
    scene.add(moon);

    // Ground - SHRUNK from 2000 to 400 for tighter feel
    const groundGeo = new THREE.PlaneGeometry(400, 400, 128, 128);
    const posAttribute = groundGeo.attributes.position;

    for (let i = 0; i < posAttribute.count; i++) {
        const x = posAttribute.getX(i);
        const y = posAttribute.getY(i); // Plane is on XY
        const zWorld = -y;

        // Use the Unified Height that accounts for the Lake
        const height = getUnifiedGroundHeight(x, zWorld);
        posAttribute.setZ(i, height);
    }

    groundGeo.computeVertexNormals();
    const groundMat = new THREE.MeshPhysicalMaterial({
        color: CONFIG.colors.ground,
        roughness: 0.4,
        metalness: 0.0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.6,
        flatShading: false,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // 2. OVERRIDE FOG for Compact World
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xFFC5D3);
    scene.fog = new THREE.FogExp2(fogColor, 0.012);
    scene.background = fogColor;

    // Initialize Vegetation Systems
    initGrassSystem(scene, 10000);
    scene.add(createFireflies(150, 100));

    // Melody Lake (Waveform Water)
    // Lake is at 20, 1.5, 20 with width 120, depth 100
    const melodyLake = createWaveformWater(120, 100);
    melodyLake.position.set(20, 1.5, 20); 
    scene.add(melodyLake);

    // Falling Berries
    initFallingBerries(scene);

    // Add the main world group (containing all generated foliage) to the scene
    scene.add(worldGroup);

    // Generate Content if requested
    if (loadContent) {
        generateMap(weatherSystem);
    }

    return { sky, moon, ground };
}

export function safeAddFoliage(
    obj: THREE.Object3D,
    isObstacle: boolean = false,
    radius: number = 1.0,
    weatherSystem: WeatherSystem | null = null
): void {
    if (animatedFoliage.length > 1000) return; // Reduced limit to prevent WASM/JS hang
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });

    // Optimization
    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);

    // Invoke deferred placement logic (e.g. for batching)
    if (obj.userData.onPlacement) {
        obj.userData.onPlacement();
    }

    // Register with weather system
    if (weatherSystem) {
        if (obj.userData.type === 'tree') {
            weatherSystem.registerTree(obj);
        } else if (obj.userData.type === 'shrub') {
            weatherSystem.registerShrub(obj);
        } else if (obj.userData.type === 'mushroom') {
            weatherSystem.registerMushroom(obj);
        } else if (obj.userData.type === 'cave') {
            weatherSystem.registerCave(obj);
            registerPhysicsCave(obj);
        }
    }
}

// --- HELPER: Position Validation ---
function isPositionValid(x: number, z: number, radius: number): boolean {
    const distFromCenterSq = x * x + z * z;
    if (distFromCenterSq < 15 * 15) return false;

    for (const obs of obstacles) {
        const dx = x - obs.position.x;
        const dz = z - obs.position.z;
        const distSq = dx * dx + dz * dz;
        const minDistance = obs.radius + radius + 1.5;
        if (distSq < minDistance * minDistance) return false;
    }
    
    // 3. Lake Avoidance for PROCEDURAL content
    // We specifically prevent random generation in the lake so we don't drown bushes.
    // However, map.json entities or explicitly placed objects (like the Cave) are allowed.
    if (x > -40 && x < 80 && z > -30 && z < 70) {
        return false;
    }

    return true;
}


// --- MAP GENERATION ---

export function generateMap(weatherSystem: WeatherSystem): void {
    console.log(`[World] Loading map with ${mapData.length} entities...`);

    (mapData as MapEntity[]).forEach(item => {
        const [x, yInput, z] = item.position;
        // USE UNIFIED HEIGHT for placement
        const groundY = getUnifiedGroundHeight(x, z);
        let y = groundY;
        if (item.type === 'cloud') y = yInput;

        try {
            let obj: THREE.Object3D | null = null;
            let isObstacle = false;
            let radius = 0.5;

            // --- Basic Types ---
            if (item.type === 'mushroom') {
                const isGiant = item.variant === 'giant';
                const scale = item.scale || 1.0;
                const hasFace = item.hasFace !== undefined ? item.hasFace : (isGiant || Math.random() < 0.1);
                const isBouncy = isGiant || hasFace;

                obj = createMushroom({
                    size: isGiant ? 'giant' : 'regular',
                    scale,
                    hasFace,
                    isBouncy,
                    note: item.note,
                    noteIndex: item.noteIndex
                });
                isObstacle = true;
                radius = isGiant ? 2.0 : 0.5;
            }
            else if (item.type === 'flower') {
                const isGlowing = item.variant === 'glowing';
                obj = isGlowing ? createGlowingFlower() : createFlower();
            }
            else if (item.type === 'cloud') {
                obj = createRainingCloud({ size: item.size as number || 1.5 });
            }
            else if (item.type === 'grass') {
                addGrassInstance(x, y, z);
                return;
            }
            // ... (Other types elided for brevity, same logic follows) ...
            else if (item.type === 'subwoofer_lotus') {
                obj = createSubwooferLotus({ scale: item.scale || 1.0 });
            }
            else if (item.type === 'accordion_palm') {
                obj = createAccordionPalm({ color: 0xFFD700 });
                isObstacle = true;
            }
            else if (item.type === 'fiber_optic_willow') {
                obj = createFiberOpticWillow();
                isObstacle = true;
            }
            else if (item.type === 'floating_orb') {
                obj = createFloatingOrb({ size: 0.5 });
                y += 1.5;
            }
            else if (item.type === 'swingable_vine') {
                obj = createSwingableVine({ length: 8 });
                y += 8;
                if (vineSwings) vineSwings.push(new VineSwing(obj, 8));
            }
            else if (item.type === 'prism_rose_bush') {
                obj = createPrismRoseBush();
                isObstacle = true;
            }
            else if (item.type === 'starflower') {
                obj = createStarflower();
            }
            else if (item.type === 'vibrato_violet') {
                obj = createVibratoViolet();
            }
            else if (item.type === 'tremolo_tulip') {
                obj = createTremoloTulip();
            }
            else if (item.type === 'kick_drum_geyser') {
                obj = createKickDrumGeyser();
            }
            // Musical Flora
            else if (item.type === 'arpeggio_fern') {
                obj = createArpeggioFern({ scale: item.scale || 1.0 });
            }
            else if (item.type === 'portamento_pine') {
                obj = createPortamentoPine({ height: 4.0 });
                isObstacle = true;
            }
            else if (item.type === 'cymbal_dandelion') {
                obj = createCymbalDandelion();
            }
            else if (item.type === 'snare_trap') {
                obj = createSnareTrap();
            }
            else if (item.type === 'panning_pad') {
                const panBias = x < 0 ? -1 : 1;
                obj = createPanningPad({ radius: item.scale || 1.0, panBias: panBias });
                if (y < 2) y = 1.0;
            }
            // Spirits
            else if (item.type === 'silence_spirit') {
                obj = createSilenceSpirit({ scale: item.scale || 1.0 });
            }
            // Instrument Shrines
            else if (item.type === 'instrument_shrine') {
                const id = parseInt(item.variant || '0', 10);
                obj = createInstrumentShrine({ instrumentID: id, scale: item.scale || 1.0 });
                isObstacle = true;
                radius = 1.0;
            }
            // Trees
            else if (item.type === 'bubble_willow') {
                obj = createBubbleWillow();
                isObstacle = true;
            }
            else if (item.type === 'helix_plant') {
                obj = createHelixPlant();
            }
            else if (item.type === 'balloon_bush') {
                obj = createBalloonBush();
            }
            else if (item.type === 'wisteria_cluster') {
                obj = createWisteriaCluster();
                y += 4;
            }

            // --- Spawning ---
            if (obj) {
                obj.position.set(x, y, z);
                obj.rotation.y = Math.random() * Math.PI * 2;
                if (item.scale && item.type !== 'mushroom' && item.type !== 'flower') {
                    obj.scale.setScalar(item.scale);
                }
                safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            }

        } catch (e) {
            console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
        }
    });

    // --- NEW: Spawn The Cave ---
    const cave = createCaveEntrance({ scale: 2.0 });
    const caveX = 25;
    const caveZ = 25;
    // USE UNIFIED HEIGHT so Cave doesn't float over the lake
    const caveY = getUnifiedGroundHeight(caveX, caveZ);

    cave.position.set(caveX, caveY, caveZ);
    cave.lookAt(0, caveY, 0);
    safeAddFoliage(cave, false, 0, weatherSystem);
    console.log("[World] Cave spawned at ", caveX, caveZ, " Height:", caveY);

    populateProceduralExtras(weatherSystem);
}

function populateProceduralExtras(weatherSystem: WeatherSystem): void {
    console.log("[World] Populating procedural extras...");
    if ((window as any).setLoadingStatus) (window as any).setLoadingStatus("Growing Procedural Flora...");
    const extrasCount = 40;
    const range = 150;

    for (let i = 0; i < extrasCount; i++) {
        let obj: THREE.Object3D | null = null;
        let isObstacle = false;
        let radius = 0.5;
        let x = 0, z = 0, y = 0;
        let attempts = 0;
        let validPosition = false;

        while (attempts < 10) {
            x = (Math.random() - 0.5) * range;
            z = (Math.random() - 0.5) * range;
            if (isPositionValid(x, z, 1.5)) {
                validPosition = true;
                break;
            }
            attempts++;
        }

        if (!validPosition) continue;

        // Use Unified Height for placement
        const groundY = getUnifiedGroundHeight(x, z);

        try {
            // ... (Procedural selection logic same as before) ...
            const rand = Math.random();
            if (rand < 0.3) {
                 obj = Math.random() < 0.5 ? createFlower() : createGlowingFlower();
                 obj.position.set(x, groundY, z);
            }
            else if (rand < 0.45) {
                 obj = createMushroom({
                     size: 'regular',
                     scale: 0.8 + Math.random() * 0.5,
                     hasFace: true,
                     isBouncy: true
                 });
                 obj.position.set(x, groundY, z);
                 isObstacle = true;
            }
            else if (rand < 0.55) {
                 const treeType = Math.random();
                 if (treeType < 0.33) obj = createBubbleWillow();
                 else if (treeType < 0.66) obj = createBalloonBush();
                 else obj = createHelixPlant();

                 obj.position.set(x, groundY, z);
                 isObstacle = true;
                 radius = 1.5;
            }
            else if (rand < 0.75) {
                 const type = Math.random();
                 if (type < 0.20) {
                     obj = createArpeggioFern({ scale: 1.0 + Math.random() * 0.5 });
                 } else if (type < 0.35) {
                     obj = createKickDrumGeyser({ maxHeight: 5.0 + Math.random() * 3.0 });
                     radius = 1.0;
                 } else if (type < 0.50) {
                     obj = createSnareTrap({ scale: 0.8 + Math.random() * 0.4 });
                     isObstacle = true;
                     radius = 0.8;
                 } else if (type < 0.60) {
                     obj = createPortamentoPine({ height: 4.0 + Math.random() * 2.0 });
                     isObstacle = true;
                     radius = 0.5;
                 } else if (type < 0.75) {
                     obj = createTremoloTulip({ size: 1.0 + Math.random() * 0.5 });
                 } else if (type < 0.85) {
                     obj = createCymbalDandelion({ scale: 0.8 + Math.random() * 0.4 });
                 } else {
                     const panBias = x < 0 ? -1 : 1;
                     obj = createPanningPad({ radius: 1.2 + Math.random(), panBias });
                     obj.position.y = groundY + 0.5;
                 }
                 if (obj) obj.position.set(x, obj.position.y || groundY, z);
            }
             else if (rand < 0.90) {
                 const isHigh = Math.random() < 0.5;
                 y = isHigh ? 35 + Math.random() * 20 : 12 + Math.random() * 10;
                 obj = createRainingCloud({ size: 1.0 + Math.random() });
                 obj.position.set(x, y, z);
             }
             else if (rand < 0.95) {
                 obj = createSilenceSpirit();
                 obj.position.set(x, groundY, z);
             }
             else if (rand < 0.97) {
                 obj = createMelodyMirror({ scale: 2.0 });
                 // Float high up
                 obj.position.set(x, groundY + 15 + Math.random() * 10, z);
             }
             else {
                 const id = Math.floor(Math.random() * 16);
                 obj = createInstrumentShrine({ instrumentID: id });
                 obj.position.set(x, groundY, z);
                 isObstacle = true;
            }

            if (obj) {
                obj.rotation.y = Math.random() * Math.PI * 2;
                safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            }
        } catch (e) {
            console.warn(`[World] Failed to spawn procedural extra at ${x},${z}`, e);
        }
    }
    console.log("[World] Finished populating procedural extras.");
}
