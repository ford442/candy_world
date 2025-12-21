// Music Reactivity System
// Handles Note -> Color mapping and note event routing
// Now manages the main loop iteration for foliage animation and photosensitivity

import { CONFIG } from '../core/config.js';
import * as THREE from 'three';
import { animateFoliage, triggerMoonBlink } from '../foliage/index.js';

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

        // 3. Iterate Foliage
        const camPos = camera.position;
        const maxAnimationDistance = 50;
        const maxDistanceSq = maxAnimationDistance * maxAnimationDistance;

        // Time budgeting: Limit material updates to avoid audio stutter
        const maxFoliageUpdateTime = 2; // milliseconds
        const frameStartTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        let foliageUpdatesThisFrame = 0;
        const maxFoliageUpdates = 50; 

        // Audio Channel Info (Pre-calc for loop)
        const channels = (audioState && audioState.channelData) ? audioState.channelData : null;
        const totalChannels = channels ? channels.length : 0;
        const splitIndex = Math.ceil(totalChannels / 2);

        for (let i = 0, l = animatedFoliage.length; i < l; i++) {
            const f = animatedFoliage[i];

            // Distance Culling
            const distSq = f.position.distanceToSquared(camPos);
            if (distSq > maxDistanceSq) continue;

            // Check time budget
            if ((typeof performance !== 'undefined') && (performance.now() - frameStartTime > maxFoliageUpdateTime)) {
                break; 
            }

            // Limit number of updates per frame
            if (foliageUpdatesThisFrame >= maxFoliageUpdates) {
                break;
            }

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
    }
    
    // Alias for backward compatibility if needed
    applyReaction(object, note, velocity) {
        this.reactObject(object, note, velocity);
    }
}