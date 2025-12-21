// src/world/generation.js

import * as THREE from 'three';
import { getGroundHeight } from '../utils/wasm-loader.js';
import {
    createSky, createStars, createMoon, createMushroom, createGlowingFlower,
    createFlower, createSubwooferLotus, createAccordionPalm, createFiberOpticWillow,
    createFloatingOrb, createSwingableVine, VineSwing, createPrismRoseBush,
    createStarflower, createVibratoViolet, createTremoloTulip, createKickDrumGeyser,
    createRainingCloud, createWaterfall, createMelodyLake, createFireflies, initFallingBerries,
    initGrassSystem, addGrassInstance,
    createArpeggioFern, createPortamentoPine, createCymbalDandelion, createSnareTrap,
    createBubbleWillow, createHelixPlant, createBalloonBush, createWisteriaCluster
} from '../foliage/index.js';
import { validateFoliageMaterials } from '../foliage/common.js';
import { CONFIG } from '../core/config.js';
import {
    animatedFoliage, obstacles, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, vineSwings, worldGroup
} from './state.js';
import mapData from '../../assets/map.json';

// --- Scene Setup ---

export function initWorld(scene, weatherSystem) {
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
        const y = posAttribute.getY(i);
        const zWorld = -y;
        const height = getGroundHeight(x, zWorld);
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
    // 0.002 was for 2000u world. 0.012 is for 400u world.
    const fogColor = new THREE.Color(CONFIG.colors.fog || 0xFFC5D3);
    scene.fog = new THREE.FogExp2(fogColor, 0.012);
    scene.background = fogColor;

    // Initialize Vegetation Systems
    // High count (20k) on small map = Very Lush Grass
    initGrassSystem(scene, 20000);
    scene.add(createFireflies(150, 100));

    // Melody Lake
    const melodyLake = createMelodyLake(80, 80);
    melodyLake.position.set(0, 2.5, 0);
    scene.add(melodyLake);

    // Falling Berries
    initFallingBerries(scene);

    // Add the main world group (containing all generated foliage) to the scene
    scene.add(worldGroup);

    // Generate Content
    generateMap(weatherSystem);

    return { sky, moon, ground };
}

export function safeAddFoliage(obj, isObstacle = false, radius = 1.0, weatherSystem = null) {
    if (animatedFoliage.length > 1000) return; // Reduced limit to prevent WASM/JS hang
    foliageGroup.add(obj);
    animatedFoliage.push(obj);
    if (isObstacle) obstacles.push({ position: obj.position.clone(), radius });

    // Optimization
    if (obj.userData.type === 'mushroom') foliageMushrooms.push(obj);
    if (obj.userData.type === 'cloud') foliageClouds.push(obj);
    if (obj.userData.isTrampoline) foliageTrampolines.push(obj);

    // Register with weather system
    if (weatherSystem) {
        if (obj.userData.type === 'tree') {
            weatherSystem.registerTree(obj);
        } else if (obj.userData.type === 'shrub') {
            weatherSystem.registerShrub(obj);
        } else if (obj.userData.type === 'mushroom') {
            weatherSystem.registerMushroom(obj);
        }
    }
}

// --- HELPER: Position Validation ---
function isPositionValid(x, z, radius) {
    // 1. Player Protection (Center Check)
    // Keep 15 units clear around (0,0)
    const distFromCenterSq = x * x + z * z;
    if (distFromCenterSq < 15 * 15) {
        return false;
    }

    // 2. Obstacle Overlap Check
    for (const obs of obstacles) {
        const dx = x - obs.position.x;
        const dz = z - obs.position.z;
        const distSq = dx * dx + dz * dz;
        const minDistance = obs.radius + radius + 1.5; // Buffer of 1.5 units

        if (distSq < minDistance * minDistance) {
            return false;
        }
    }

    return true;
}


// --- MAP GENERATION ---

// @refactor {target: "ts", reason: "logic-complexity", note: "Map generation logic is complex and benefits from strict typing"}
function generateMap(weatherSystem) {
    console.log(`[World] Loading map with ${mapData.length} entities...`);

    mapData.forEach(item => {
        const [x, yInput, z] = item.position;
        // Recalculate Y based on ground height for most objects to ensure they sit on terrain
        const groundY = getGroundHeight(x, z);

        // Use provided Y if it's significantly different (e.g. cloud), otherwise snap to ground
        let y = groundY;
        if (item.type === 'cloud') {
            y = yInput; // Clouds float
        }

        try {
            let obj = null;
            let isObstacle = false;
            let radius = 0.5;

            // --- Basic Types ---
            if (item.type === 'mushroom') {
                const isGiant = item.variant === 'giant';
                const scale = item.scale || 1.0;

                // Add faces to giants and some regulars (10% chance)
                const hasFace = isGiant || Math.random() < 0.1;
                // Make face mushrooms bouncy
                const isBouncy = isGiant || hasFace;

                obj = createMushroom({
                    size: isGiant ? 'giant' : 'regular',
                    scale,
                    hasFace,
                    isBouncy
                });
                isObstacle = true;
                radius = isGiant ? 2.0 : 0.5;
            }
            else if (item.type === 'flower') {
                const isGlowing = item.variant === 'glowing';
                obj = isGlowing ? createGlowingFlower() : createFlower();
            }
            else if (item.type === 'cloud') {
                obj = createRainingCloud({ size: item.size || 1.5 });
            }
            else if (item.type === 'grass') {
                addGrassInstance(x, y, z);
                return; // Grass handled separately
            }

            // --- Advanced Types (New additions) ---
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
                y += 1.5; // Float above ground
            }
            else if (item.type === 'swingable_vine') {
                // Needs height to dangle
                obj = createSwingableVine({ length: 8 });
                y += 8; // Hang from above
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
                y += 4; // Hangs
            }

            // --- Spawning ---
            if (obj) {
                obj.position.set(x, y, z);
                obj.rotation.y = Math.random() * Math.PI * 2;

                // Apply Scale if provided and object supports it (some have fixed sizes)
                if (item.scale && item.type !== 'mushroom' && item.type !== 'flower') {
                    obj.scale.setScalar(item.scale);
                }

                safeAddFoliage(obj, isObstacle, radius, weatherSystem);
            }

        } catch (e) {
            console.warn(`[World] Failed to spawn ${item.type} at ${x},${z}`, e);
        }
    });

    populateProceduralExtras(weatherSystem);
}

function populateProceduralExtras(weatherSystem) {
    console.log("[World] Populating procedural extras (flowers, face mushrooms, trees, clouds)...");
    const extrasCount = 80; // Add extra density
    const range = 150; // Keep within central area

    for (let i = 0; i < extrasCount; i++) {
        let obj = null;
        let isObstacle = false;
        let radius = 0.5;
        let x = 0, z = 0, y = 0;
        let attempts = 0;
        let validPosition = false;

        // Try to find a valid position
        while (attempts < 10) {
            x = (Math.random() - 0.5) * range;
            z = (Math.random() - 0.5) * range;

            // Assume max radius of procedural objects (Bubble Willow is ~1.5)
            // Using 1.5 as a conservative guess for the check
            if (isPositionValid(x, z, 1.5)) {
                validPosition = true;
                break;
            }
            attempts++;
        }

        if (!validPosition) {
            // console.debug(`[World] Skipped spawning extra after ${attempts} attempts.`);
            continue;
        }

        const groundY = getGroundHeight(x, z);

        try {
            const rand = Math.random();

            if (rand < 0.4) { // 40% Flowers
                 obj = Math.random() < 0.5 ? createFlower() : createGlowingFlower();
                 obj.position.set(x, groundY, z);
            }
            else if (rand < 0.6) { // 20% Face Mushrooms (Bouncy!)
                 // Small bouncy face mushrooms like in the concept image
                 obj = createMushroom({
                     size: 'regular',
                     scale: 0.8 + Math.random() * 0.5,
                     hasFace: true,
                     isBouncy: true
                 });
                 obj.position.set(x, groundY, z);
                 isObstacle = true;
            }
            else if (rand < 0.8) { // 20% Trees
                 const treeType = Math.random();
                 if (treeType < 0.33) obj = createBubbleWillow();
                 else if (treeType < 0.66) obj = createBalloonBush();
                 else obj = createHelixPlant();

                 obj.position.set(x, groundY, z);
                 isObstacle = true;
                 radius = 1.5;
            }
            else { // 20% Clouds
                 const isHigh = Math.random() < 0.5;
                 y = isHigh ? 35 + Math.random() * 20 : 12 + Math.random() * 10;
                 obj = createRainingCloud({ size: 1.0 + Math.random() });
                 obj.position.set(x, y, z);
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
