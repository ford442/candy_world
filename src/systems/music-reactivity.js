// Music Reactivity System
// Handles Note -> Color mapping and note event routing
// Now manages the main loop iteration for foliage animation and photosensitivity

import { CONFIG } from '../core/config.js';
import * as THREE from 'three';
import { animateFoliage, triggerMoonBlink } from '../foliage/index.js';

// Reusable frustum for culling (prevent GC)
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _scratchSphere = new THREE.Sphere(); // For Group culling

const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function getNoteColor(note, species = 'global') {
    let noteName = '';

    // Resolve Note Name
    if (typeof note === 'number') {
        const index = note % 12;
        noteName = CHROMATIC_SCALE[index];
    } else if (typeof note === 'string') {
        // Handle "C4", "F#3" etc.
        noteName = note.replace(/[0-9-]/g, '');
    }

    // Lookup
    let map = CONFIG.noteColorMap[species];

    // If the species key isn't exact, try some heuristics to map similar types to a known species palette
    if (!map) {
        const s = (species || '').toLowerCase();
        if (s.includes('flower') || s.includes('tulip') || s.includes('violet') || s.includes('rose') || s.includes('bloom') || s.includes('lotus') || s.includes('puff') ) {
            map = CONFIG.noteColorMap['flower'];
        } else if (s.includes('mushroom') || s.includes('mush')) {
            map = CONFIG.noteColorMap['mushroom'];
        } else if (s.includes('tree') || s.includes('willow') || s.includes('palm') || s.includes('bush')) {
            map = CONFIG.noteColorMap['tree'];
        } else if (s.includes('cloud') || s.includes('orb') || s.includes('geyser') || s.includes('moon')) {
            map = CONFIG.noteColorMap['cloud'] || CONFIG.noteColorMap['global'];
        } else {
            map = CONFIG.noteColorMap['global'];
        }
    }

    // Return color or fallback to White
    return map[noteName] || 0xFFFFFF;
}

export class MusicReactivitySystem {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.config = config;
        // Staggered update: Start processing from a different offset each frame
        this.updateStartIndex = 0;
        // Cache for frustum culling optimization
        this._lastCameraVersion = -1;
    }

    /**
     * Get the current staggered update index (for testing)
     * @returns {number} The current start index for round-robin processing
     */
    getUpdateStartIndex() {
        return this.updateStartIndex;
    }

    /**
     * Apply reaction to a specific object
     * Merged: Handles standard foliage AND celestial objects from jules-dev
     */
    reactObject(object, note, velocity) {
        if (!object.userData.type) return;

        const species = object.userData.type;

        // 1. Standard Reactivity (Flora)
        if (typeof object.reactToNote === 'function') {
            const color = getNoteColor(note, species);
            object.reactToNote(note, color, velocity);
        }

        // 2. Celestial Reactions (from jules-dev)
        if (object.userData.type === 'pulsar') {
            // Flash scale and opacity
            const scale = 1.0 + velocity * 0.5;
            object.scale.setScalar(scale);
            // If it has a glow child (index 1), boost opacity
            if (object.children[1]) {
                object.children[1].material.opacity = 0.3 + velocity * 0.7;
            }
        }
        else if (object.userData.type === 'planet') {
            // Pulse the planet slowly
            const scale = 1.0 + velocity * 0.1;
            object.scale.setScalar(scale);
            // Rotate ring faster on beat
            if (object.children[1]) {
                object.children[1].rotation.z += velocity * 0.1;
            }
        }
        else if (object.userData.type === 'galaxy') {
            // Spin Galaxy Faster on Melody intensity
            // We accumulate rotation, so we need to access the mesh directly
            object.rotation.y -= (object.userData.baseRotationSpeed + velocity * 0.02);
        }
    }

    // Helper to check if object is currently active (User Change)
    isObjectActive(object) {
        return object.visible;
    }

    /**
     * Main update loop for foliage animation and reactivity.
     * Integrates Photosensitivity (Feature Branch) with Channel Mapping (Jules Dev).
     *
     * @param {number} t - Current game time
     * @param {object} audioState - Current audio analysis state
     * @param {object} weatherSystem - Reference to weather system (for light level)
     * @param {Array} animatedFoliage - List of objects to update
     * @param {THREE.Camera} camera - Camera for distance culling
     * @param {boolean} isNight - Is it currently night?
     * @param {boolean} isDeepNight - Is it deep night (for fireflies etc)?
     * @param {THREE.Object3D} moon - Reference to moon for blinking
     */
    update(t, audioState, weatherSystem, animatedFoliage, camera, isNight, isDeepNight, moon) {
        
        // 1. Global Events (Moon Blink)
        // Check specific instruments (e.g. Tree/Drums) for global effects
        if (audioState && audioState.channelData && isNight && moon) {
            // Quick check for instrument 2 (Tree/Drums) activity
            for (const ch of audioState.channelData) {
                if (ch.trigger > 0.5 && ch.instrument === 2) {
                    triggerMoonBlink(moon);
                    break;
                }
            }
        }

        // 2. Get Global Light Level
        const globalLight = (weatherSystem && typeof weatherSystem.getGlobalLightLevel === 'function')
            ? weatherSystem.currentLightLevel 
            : 1.0;

        // 3. Prepare Frustum Culling (major performance win for 3000+ objects)
        // Only recalculate if camera matrix has changed (optimization)
        const cameraVersion = camera.matrixWorldAutoUpdate ? camera.matrixWorld.elements[0] : this._lastCameraVersion;
        if (cameraVersion !== this._lastCameraVersion) {
            _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_projScreenMatrix);
            this._lastCameraVersion = cameraVersion;
        }

        // 4. Iterate Foliage
        const camPos = camera.position;
        // Optimization: Cache camera coordinates to avoid property access in loop
        const camX = camPos.x;
        const camY = camPos.y;
        const camZ = camPos.z;

        // Reduced from 50 to 30 for better performance with large object count
        const maxAnimationDistance = 30; // Reduced from 50 for 3k+ objects
        const maxDistanceSq = maxAnimationDistance * maxAnimationDistance;

        // Time budgeting: Limit material updates to avoid audio stutter
        const maxFoliageUpdateTime = 2; // milliseconds
        const frameStartTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        let foliageUpdatesThisFrame = 0;
        const maxFoliageUpdates = 100; // Increased from 50 since frustum culling reduces candidates
        const budgetCheckInterval = 20; // Check time budget every 20 items (reduced overhead)

        // Audio Channel Info (Pre-calc for loop)
        const channels = (audioState && audioState.channelData) ? audioState.channelData : null;
        const totalChannels = channels ? channels.length : 0;
        const splitIndex = Math.ceil(totalChannels / 2);

        // Staggered updates: Process objects in a round-robin fashion
        // This prevents hitches when many objects come into view at once
        const totalObjects = animatedFoliage.length;
        const startIdx = this.updateStartIndex;
        let processedCount = 0;

        for (let offset = 0; offset < totalObjects; offset++) {
            // Wrap around using modulo for round-robin processing
            const i = (startIdx + offset) % totalObjects;
            const f = animatedFoliage[i];

            // CRITICAL: Frustum culling - skip objects outside camera view
            // This is the primary fix for the freeze when viewing many objects
            // FIX: Safely handle Groups which lack geometry/boundingSphere
            let isVisible = false;
            if (f.geometry && f.geometry.boundingSphere) {
                isVisible = _frustum.intersectsObject(f);
            } else {
                // Fallback for Groups or objects without geometry
                // Use a default radius (5.0) or user-defined radius
                _scratchSphere.center.copy(f.position);
                _scratchSphere.radius = f.userData.radius || 5.0;
                isVisible = _frustum.intersectsSphere(_scratchSphere);
            }

            if (!isVisible) {
                continue;
            }

            // Optimization: Inline distance culling to avoid function call overhead
            const dx = f.position.x - camX;
            const dy = f.position.y - camY;
            const dz = f.position.z - camZ;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq > maxDistanceSq) continue;

            // Check time budget (throttled to avoid expensive performance.now() calls every iteration)
            const shouldCheckBudget = (processedCount % budgetCheckInterval === 0);
            if (shouldCheckBudget) {
                const hasPerformance = (typeof performance !== 'undefined');
                if (hasPerformance && (performance.now() - frameStartTime > maxFoliageUpdateTime)) {
                    break; 
                }
            }

            // Limit number of updates per frame
            if (foliageUpdatesThisFrame >= maxFoliageUpdates) {
                break;
            }

            processedCount++;

            // --- USER CHANGE: 'wobble' multiplier ---
            if (f.userData.animationType === 'wobble') {
                f.userData.animationOffset += 0.05; 
            }
            // ----------------------------------------

            // A) Standard Animation (Sway, Bounce, etc.)
            animateFoliage(f, t, audioState, !isNight, isDeepNight);
            foliageUpdatesThisFrame++;

            // B) Music Reactivity (Photosensitive + Channel Mapped)
            if (channels) {
                // 1. Check Photosensitivity (Feature Branch Logic)
                const min = f.userData.minLight !== undefined ? f.userData.minLight : 0.0;
                const max = f.userData.maxLight !== undefined ? f.userData.maxLight : 1.0;
                const feather = 0.1;
                
                const lowerEdge = (globalLight - min) / feather; 
                const upperEdge = (max - globalLight) / feather; 
                const lightFactor = Math.min(Math.max(lowerEdge, 0), Math.max(upperEdge, 0), 1.0);

                // 2. If light allows, check Audio Channel (Jules Dev Logic)
                if (lightFactor > 0) {
                    const type = f.userData.reactivityType || 'flora';
                    const id = f.userData.reactivityId || 0;
                    let targetChannelIndex = 0;

                    if (type === 'sky') {
                        // Upper half (Drums/Percussion)
                        const skyCount = totalChannels - splitIndex;
                        if (skyCount > 0) {
                            targetChannelIndex = splitIndex + (id % skyCount);
                        } else {
                            targetChannelIndex = totalChannels - 1; 
                        }
                    } else {
                        // Lower half (Melody/Bass)
                        const floraCount = splitIndex;
                        if (floraCount > 0) {
                            targetChannelIndex = id % floraCount;
                        } else {
                            targetChannelIndex = 0;
                        }
                    }

                    if (targetChannelIndex < totalChannels) {
                        const info = channels[targetChannelIndex];
                        if (info && info.trigger > 0.1) {
                            // Apply reaction scaled by lightFactor
                            this.reactObject(f, info.note, info.trigger * lightFactor);
                        }
                    }
                }
            }
        }

        // Advance the start index for next frame (staggered processing)
        // Use a hybrid approach: advance by processed count but ensure minimum progress
        // This prevents getting stuck when heavy culling occurs
        const minIncrement = Math.min(10, totalObjects); // Ensure we advance at least 10 objects
        const actualIncrement = Math.max(processedCount, minIncrement);
        this.updateStartIndex = (startIdx + actualIncrement) % totalObjects;

        // Export stats for performance monitoring (if available)
        if (typeof window !== 'undefined' && window.updatePerfStats) {
            window.updatePerfStats(totalObjects, processedCount, foliageUpdatesThisFrame);
        }
    }
    
    // Alias for backward compatibility if needed
    applyReaction(object, note, velocity) {
        this.reactObject(object, note, velocity);
    }
}