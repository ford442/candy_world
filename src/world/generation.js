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
    // Trees & Shrubs
    createFloweringTree, createShrub, createBubbleWillow,
    // Musical flora
    createArpeggioFern, createPortamentoPine, createCymbalDandelion, createSnareTrap
} from '../foliage/index.js';
import { CONFIG } from '../core/config.js';
import {
    animatedFoliage, obstacles, foliageGroup, foliageMushrooms,
    foliageClouds, foliageTrampolines, vineSwings
} from './state.js';

// --- DENSITY INCREASED MAP DATA ---
// Larger radii & slightly more clouds for a fuller vertical ecosystem
const MAP_ZONES = [
    // Center: Musical Meadow
    { type: 'musical_meadow', x: 0, z: 0, radius: 40 },

    // North: Mushroom Forests
    { type: 'mushroom_forest', x: 0, z: -60, radius: 35 },
    { type: 'mushroom_forest', x: 30, z: -90, radius: 30 },

    // East: Crystal Groves
    { type: 'crystal_grove', x: 70, z: 0, radius: 30 },

    // South: Weird Jungle
    { type: 'weird_jungle', x: 0, z: 80, radius: 40 },
    
    // West: Flower Fields
    { type: 'flower_field', x: -70, z: 0, radius: 35 },
];

const MAP_CLOUDS = [
    // Tier 1 clouds (sources)
    { x: 20, y: 50, z: 20, tier: 1, rain: 50, scale: 2.0, waterfall: true },
    { x: -30, y: 55, z: -30, tier: 1, rain: 40, scale: 2.2, waterfall: true },
    { x: 60, y: 45, z: -10, tier: 1, rain: 60, scale: 1.8, waterfall: false },
    { x: 0, y: 60, z: 80, tier: 1, rain: 45, scale: 2.5, waterfall: true },

    // Decorative Tier 2 clouds
    { x: 0, y: 30, z: 50, tier: 2, rain: 20, scale: 1.2 },
    { x: -50, y: 25, z: 10, tier: 2, rain: 15, scale: 1.0 },
    { x: 40, y: 28, z: 60, tier: 2, rain: 10, scale: 1.1 },
    { x: -20, y: 35, z: -60, tier: 2, rain: 25, scale: 1.3 },
];

// --- Scene Setup ---

export function initWorld(scene, weatherSystem) {
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

    // Ground
    const groundGeo = new THREE.PlaneGeometry(2000, 2000, 128, 128);
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

    // Initialize Vegetation Systems
    initGrassSystem(scene, 8000);

    // Fireflies (Deep Night)
    const fireflies = createFireflies(150, 100);
    scene.add(fireflies);

    // Melody Lake
    const melodyLake = createMelodyLake(100, 100);
    melodyLake.position.set(0, 2.5, 0);
    scene.add(melodyLake);

    // Falling Berries
    initFallingBerries(scene);

    // --- Vertical Ecosystem Density Increase ---
    // Note: These are added before the static zone generation; safeAddFoliage enforces caps.
    const AREA_RANGE = 120;

    // 1. TREES (Increase to 50)
    for (let i = 0; i < 50; i++) {
        const x = (Math.random() - 0.5) * AREA_RANGE * 2;
        const z = (Math.random() - 0.5) * AREA_RANGE * 2;
        const y = getGroundHeight(x, z);
        const tree = Math.random() < 0.5 ? createBubbleWillow() : createFloweringTree();
        tree.position.set(x, y, z);
        tree.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(tree, true, 1.2, weatherSystem);
    }

    // 2. FLOWERING TREES (Increase to 40)
    for (let i = 0; i < 40; i++) {
        const x = (Math.random() - 0.5) * AREA_RANGE * 2;
        const z = (Math.random() - 0.5) * AREA_RANGE * 2;
        const y = getGroundHeight(x, z);
        const ft = createFloweringTree({ color: 0xFF69B4 });
        ft.position.set(x, y, z);
        ft.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(ft, true, 1.4, weatherSystem);
    }

    // 3. GIANT MUSHROOMS (Increase to 30)
    for (let i = 0; i < 30; i++) {
        const x = (Math.random() - 0.5) * AREA_RANGE * 2;
        const z = (Math.random() - 0.5) * AREA_RANGE * 2;
        const y = getGroundHeight(x, z);
        const m = createMushroom({ size: 'giant', scale: 1.0 + Math.random() * 1.0 });
        m.position.set(x, y, z);
        m.rotation.y = Math.random() * Math.PI * 2;
        safeAddFoliage(m, true, 2.0, weatherSystem);
    }

    // 4. SMALL FOLIAGE (Increase to 900; mostly grass with some shrubs)
    for (let i = 0; i < 900; i++) {
        const x = (Math.random() - 0.5) * AREA_RANGE * 2;
        const z = (Math.random() - 0.5) * AREA_RANGE * 2;
        const y = getGroundHeight(x, z);
        if (Math.random() < 0.85) {
            addGrassInstance(x + (Math.random() - 0.5) * 1.5, y, z + (Math.random() - 0.5) * 1.5);
        } else {
            const s = createShrub();
            s.position.set(x, y, z);
            safeAddFoliage(s, false, 0.7, weatherSystem);
        }
    }

    // 5. CLOUDS (Increase total to ~25 by spawning additional decorative clouds)
    const existingClouds = MAP_CLOUDS.length;
    const targetCloudCount = 30;
    const extra = Math.max(0, targetCloudCount - existingClouds);
    for (let i = 0; i < extra; i++) {
        const height = 25 + Math.random() * 30;
        const cloud = createRainingCloud({ rainIntensity: 10 + Math.random() * 30, size: 0.8 + Math.random() * 1.4 });
        cloud.position.set((Math.random() - 0.5) * AREA_RANGE * 3, height, (Math.random() - 0.5) * AREA_RANGE * 3);
        cloud.userData.tier = 2;
        foliageGroup.add(cloud);
        animatedFoliage.push(cloud);
        foliageClouds.push(cloud);
    }

    // Generate Map
    generateMap(weatherSystem);

    return { sky, stars, moon, ground, fireflies };
}

export function safeAddFoliage(obj, isObstacle = false, radius = 1.0, weatherSystem = null) {
    // TEMPORARY TESTING CAP: Increased to allow the vertical-ecosystem density to be applied for tests.
    // Original cap was 400; raise to 5000 for performance experimentation. Revert once testing is complete.
    if (animatedFoliage.length > 5000) return;

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

// --- CLUSTERING SPAWNER ---

// --- CLUSTER SPAWNER ---
// Optimized for Low Object Count
function spawnCluster(cx, cz, type, weatherSystem, radius = 30) {
    
    // 1. Mushroom Forest
    if (type === 'mushroom_forest') {
        // INCREASED DENSITY: multiplier raised to give more mushrooms per zone
        const count = Math.min(40, Math.floor(radius * 0.6)); 
        
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * radius * 1.5;
            const z = cz + (Math.random() - 0.5) * radius * 1.5;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            let obj;
            let isObs = true;
            
            if (r < 0.15) {
                // Giant Mushroom
                obj = createMushroom({ size: 'giant', scale: 0.8 + Math.random() * 0.5 });
                // PERFORMANCE: REMOVED extra "glowing flower" spawns under giant mushrooms
            } else if (r < 0.3) {
                // Portamento Pine
                obj = createPortamentoPine({ height: 5 + Math.random() * 3 });
            } else {
                // Regular Mushroom
                obj = createMushroom({ size: 'regular', scale: 0.8 + Math.random() * 0.5 });
                isObs = false;
            }

            obj.position.set(x, y, z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, isObs, 1.0, weatherSystem);
        }
    }

    // 2. Glowing Flower Field
    else if (type === 'flower_field') {
        const count = Math.min(35, Math.floor(radius * 0.9));
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * radius * 1.8;
            const z = cz + (Math.random() - 0.5) * radius * 1.8;
            const y = getGroundHeight(x, z);

            if (Math.random() > 0.6) addGrassInstance(x, y, z);

            if (Math.random() > 0.4) {
                const isGlowing = Math.random() < 0.3;
                const f = isGlowing ? createGlowingFlower() : createFlower({ shape: 'layered' });
                f.position.set(x, y, z);
                safeAddFoliage(f, false, 1.0, weatherSystem);
            }
        }
    }

    // 3. Weird Jungle
    else if (type === 'weird_jungle') {
        const count = Math.min(30, Math.floor(radius * 0.5));
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * radius;
            const z = cz + (Math.random() - 0.5) * radius;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            let plant;
            if (r < 0.25) plant = createSubwooferLotus({ color: 0x2E8B57 });
            else if (r < 0.5) plant = createAccordionPalm({ color: 0xFF6347 });
            else if (r < 0.7) plant = createFiberOpticWillow();
            else plant = createSnareTrap({ scale: 1.5 });

            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 1.0, weatherSystem);
        }
        
        // Vines (Reduced to 1 per zone)
        const x = cx; 
        const z = cz;
        const y = getGroundHeight(x, z) + 15 + Math.random() * 5;
        const vine = createSwingableVine({ length: 12 + Math.random() * 4 });
        vine.position.set(x, y, z);
        safeAddFoliage(vine, false, 1.0, weatherSystem); 
        vineSwings.push(new VineSwing(vine, vine.userData.vineLength));
    }

    // 4. Crystal Grove
    else if (type === 'crystal_grove') {
        const count = Math.min(30, Math.floor(radius * 0.6));
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * radius;
            const z = cz + (Math.random() - 0.5) * radius;
            const y = getGroundHeight(x, z);

            const r = Math.random();
            let plant;
            if (r < 0.4) plant = createPrismRoseBush();
            else if (r < 0.7) plant = createStarflower();
            else plant = createArpeggioFern({ scale: 2.0 });

            plant.position.set(x, y, z);
            safeAddFoliage(plant, true, 0.8, weatherSystem);
        }
    }

    // 5. Musical Meadow
    else if (type === 'musical_meadow') {
        const count = Math.min(35, Math.floor(radius * 0.8));
        
        for (let i = 0; i < count; i++) {
            const x = cx + (Math.random() - 0.5) * radius;
            const z = cz + (Math.random() - 0.5) * radius;
            const y = getGroundHeight(x, z);
            
            const r = Math.random();
            let obj;
            
            if (r < 0.4) {
                 obj = createVibratoViolet({ intensity: 0.8 + Math.random() * 0.4 });
            } else if (r < 0.7) {
                 obj = createTremoloTulip({ size: 0.8 + Math.random() * 0.4 });
            } else {
                 obj = createCymbalDandelion({ scale: 1.2 });
            }
            
            obj.position.set(x, y, z);
            obj.rotation.y = Math.random() * Math.PI * 2;
            safeAddFoliage(obj, false, 0.3, weatherSystem);
        }

        // Increase geysers to 4
        for (let i = 0; i < 4; i++) {
            const x = cx + (Math.random() - 0.5) * (radius * 0.6);
            const z = cz + (Math.random() - 0.5) * (radius * 0.6);
            const geyser = createKickDrumGeyser({ maxHeight: 6 });
            geyser.position.set(x, getGroundHeight(x, z), z);
            safeAddFoliage(geyser, true, 0.5, weatherSystem);
        }

        // More grass
        for (let i = 0; i < 40; i++) {
            addGrassInstance(cx + (Math.random() - 0.5) * radius, getGroundHeight(cx + (Math.random() - 0.5) * radius, cz), cz + (Math.random() - 0.5) * radius);
        }
    }
}

function generateMap(weatherSystem) {
    console.log("Generating World (Performance Mode)...");

    // 1. Spawn Zones
    MAP_ZONES.forEach(zone => {
        spawnCluster(zone.x, zone.z, zone.type, weatherSystem, zone.radius);
    });

    // 2. Spawn Clouds & Waterfalls
    MAP_CLOUDS.forEach(data => {
        const cloud = createRainingCloud({
            rainIntensity: data.rain,
            size: data.scale
        });
        cloud.position.set(data.x, data.y, data.z);
        
        // Metadata
        cloud.userData.tier = data.tier;
        if (data.tier === 1) {
            cloud.userData.isWalkable = true;
            // Tier 1 scaling is visual; physics needs to know bounds
            cloud.scale.setScalar(data.scale); 
        }

        foliageGroup.add(cloud);
        animatedFoliage.push(cloud);
        foliageClouds.push(cloud);

        // Waterfall Logic
        if (data.waterfall) {
            const startPos = cloud.position.clone();
            startPos.y -= 3.0; // Start below cloud
            
            // Calculate ground hit
            let endY = getGroundHeight(startPos.x, startPos.z);
            
            // Lake Logic: Ensure we don't go below water level at origin
            if (Math.sqrt(startPos.x**2 + startPos.z**2) < 40) endY = Math.max(endY, 2.5);

            const endPos = new THREE.Vector3(startPos.x, endY, startPos.z);
            const waterfall = createWaterfall(startPos, endPos, 3.0 + Math.random() * 2.0);
            safeAddFoliage(waterfall, false, 2.0, weatherSystem);
        }
    });

    // 3. Fill Empty Spaces with Grass/Generic Foliage
    // This ensures the world doesn't look empty between the specific zones
    fillEmptySpace();
}

function fillEmptySpace() {
    const GRID_SIZE = 15; // Smaller grid = more checks, denser grass
    const RANGE = 150; 
    
    for (let x = -RANGE; x <= RANGE; x += GRID_SIZE) {
        for (let z = -RANGE; z <= RANGE; z += GRID_SIZE) {
            const jx = x + (Math.random() - 0.5) * 15;
            const jz = z + (Math.random() - 0.5) * 15;

            let tooClose = false;
            for (const zone of MAP_ZONES) {
                const dx = jx - zone.x;
                const dz = jz - zone.z;
                if (Math.sqrt(dx*dx + dz*dz) < zone.radius * 1.0) {
                    tooClose = true;
                    break;
                }
            }

            if (!tooClose) {
                const y = getGroundHeight(jx, jz);
                // Increased grass fill
                for(let k=0; k<5; k++) {
                   addGrassInstance(
                       jx + (Math.random()-0.5)*10, 
                       y, 
                       jz + (Math.random()-0.5)*10
                   );
                }
            }
        }
    }
}
