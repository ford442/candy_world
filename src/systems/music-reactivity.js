// Music Reactivity System
// Handles Note -> Color mapping and note event routing
// Now manages the main loop iteration for foliage animation and photosensitivity

import { CONFIG } from '../core/config.js';
import { animateFoliage, triggerMoonBlink } from '../foliage/index.js'; // Ensure this index exports what we need
import * as THREE from 'three';

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
        } else if (s.includes('cloud') || s.includes('orb') || s.includes('geyser')) {
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
        this.config = config; // Extra config if needed

        // Reusable objects for loop performance
        this._frameTriggerData = {
            flower: { active: false, note: 60, volume: 0 },
            mushroom: { active: false, note: 60, volume: 0 },
            tree: { active: false, note: 60, volume: 0 }
        };
    }

    /**
     * Trigger a reaction on a specific species type (Global broadcast)
     */
    triggerNote(species, note, velocity) {
        // This method is intended for global broadcasting if we had a centralized list of listeners.
        // Currently unused as main loop drives reactions.
    }

    /**
     * Apply reaction to a specific object
     */
    reactObject(object, note, velocity) {
        if (!object.userData.type) return;

        const species = object.userData.type;

        if (typeof object.reactToNote === 'function') {
            // Get color specifically for this species
            const color = getNoteColor(note, species);
            object.reactToNote(note, color, velocity);
        }
    }

    /**
     * Main update loop for foliage animation and reactivity.
     * Moved from main.js to encapsulate photosensitivity logic.
     *
     * @param {number} t - Current game time
     * @param {object} audioState - Current audio analysis state
     * @param {object} weatherSystem - Reference to weather system (for light level)
     * @param {Array} animatedFoliage - List of objects to update
     * @param {THREE.Camera} camera - Camera for distance culling
     * @param {boolean} isNight - Is it currently night?
     * @param {boolean} isDeepNight - Is it deep night (for fireflies etc)?
     */
    update(t, audioState, weatherSystem, animatedFoliage, camera, isNight, isDeepNight, moon) {
        // 1. Process Audio Triggers
        // Reset trigger data
        this._frameTriggerData.flower.active = false;
        this._frameTriggerData.mushroom.active = false;
        this._frameTriggerData.tree.active = false;
        let hasTriggers = false;

        if (audioState && audioState.channelData) {
            audioState.channelData.forEach(ch => {
                if (ch.trigger > 0.5) {
                    let species = 'flower';
                    if (ch.instrument === 1 || ch.freq < 200) species = 'mushroom';
                    if (ch.instrument === 2) species = 'tree';

                    const data = this._frameTriggerData[species];
                    if (data) {
                        data.active = true;
                        data.note = ch.note || 60;
                        data.volume = ch.volume;
                        hasTriggers = true;
                    }

                    if (species === 'tree' && isNight && moon) triggerMoonBlink(moon);
                }
            });
        }

        // 2. Get Global Light Level
        // Fallback to 1.0 if weatherSystem not ready or method missing
        const globalLight = (weatherSystem && typeof weatherSystem.getGlobalLightLevel === 'function')
            ? weatherSystem.currentLightLevel // cached in weather update
            : 1.0;

        // 3. Iterate Foliage
        const camPos = camera.position;
        const maxAnimationDistance = 50;
        const maxDistanceSq = maxAnimationDistance * maxAnimationDistance;

        // Time budgeting: Limit material updates to avoid audio stutter
        // Allocate max 2ms per frame for foliage updates
        const maxFoliageUpdateTime = 2; // milliseconds
        const frameStartTime = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        let foliageUpdatesThisFrame = 0;
        const maxFoliageUpdates = 50; // Max number of foliage objects to update per frame

        for (let i = 0, l = animatedFoliage.length; i < l; i++) {
            const f = animatedFoliage[i];

            // Distance Culling
            const distSq = f.position.distanceToSquared(camPos);
            if (distSq > maxDistanceSq) continue;

            // Check time budget
            if ((typeof performance !== 'undefined') && (performance.now() - frameStartTime > maxFoliageUpdateTime)) {
                break; // Skip remaining updates this frame to preserve audio performance
            }

            // Limit number of updates per frame
            if (foliageUpdatesThisFrame >= maxFoliageUpdates) {
                break;
            }

            // A) Standard Animation (Sway, Bounce, etc.)
            animateFoliage(f, t, audioState, !isNight, isDeepNight);
            foliageUpdatesThisFrame++;

            // B) Music Reactivity (Photosensitive)
            if (hasTriggers) {
                const trigger = this._frameTriggerData[f.userData.type];
                if (trigger && trigger.active) {
                    // Check Photosensitivity
                    const min = f.userData.minLight !== undefined ? f.userData.minLight : 0.0;
                    const max = f.userData.maxLight !== undefined ? f.userData.maxLight : 1.0;

                    // Feathering (0.1 edge)
                    const feather = 0.1;
                    const lowerEdge = (globalLight - min) / feather; // < 0 if too dark, > 1 if bright enough
                    const upperEdge = (max - globalLight) / feather; // < 0 if too bright, > 1 if dim enough

                    // Combine factors (clamped 0-1)
                    // If globalLight is within [min, max], lightFactor should be 1.0 (or fading at edges)
                    // If globalLight < min, lowerEdge becomes negative -> factor 0
                    // If globalLight > max, upperEdge becomes negative -> factor 0

                    // Wait, logic check:
                    // If light = min, lowerEdge = 0.
                    // If light = min + feather, lowerEdge = 1.
                    // So we want light > min for lowerEdge to be positive. Correct.

                    const lightFactor = Math.min(Math.max(lowerEdge, 0), Math.max(upperEdge, 0), 1.0);

                    // Only react if light conditions allow
                    if (lightFactor > 0) {
                        // Pass lightFactor to scale intensity
                        this.reactObject(f, trigger.note, trigger.volume * lightFactor);
                    }
                }
            }
        }
    }
}
