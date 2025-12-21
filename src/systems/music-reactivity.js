// Music Reactivity System
// Handles Note -> Color mapping and note event routing

import { CONFIG } from '../core/config.js';
import { reactiveObjects } from '../foliage/common.js';

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

/**
 * Apply reaction to a specific object
 * @param {THREE.Object3D} object
 * @param {number|string} note
 * @param {number} velocity
 */
export function reactObject(object, note, velocity) {
    if (!object.userData.type) return;

    const species = object.userData.type;

    if (typeof object.reactToNote === 'function') {
        // Get color specifically for this species
        const color = getNoteColor(note, species);
        object.reactToNote(note, color, velocity);
    }

    // --- NEW: CELESTIAL REACTIONS ---
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

/**
 * Main Update Loop for Music Reactivity
 * splits channels between 'flora' (low channels) and 'sky' (high channels/drums)
 */
export function updateMusicReactivity(audioState) {
    if (!audioState || !audioState.channelData) return;

    const channels = audioState.channelData;
    const totalChannels = channels.length;

    // Split: Flora gets bottom half, Sky gets top half (drums)
    const splitIndex = Math.ceil(totalChannels / 2);

    // Iterate efficiently
    for (let i = 0, l = reactiveObjects.length; i < l; i++) {
        const obj = reactiveObjects[i];
        const type = obj.userData.reactivityType || 'flora';
        const id = obj.userData.reactivityId || 0;

        let targetChannelIndex;

        if (type === 'sky') {
            const skyChannelCount = totalChannels - splitIndex;
            if (skyChannelCount > 0) {
                // Map ID to upper channels (e.g. 2, 3 in a 4-ch MOD)
                targetChannelIndex = splitIndex + (id % skyChannelCount);
            } else {
                targetChannelIndex = 0; // Fallback
            }
        } else {
            // Flora
            const floraChannelCount = splitIndex;
            if (floraChannelCount > 0) {
                 // Map ID to lower channels (e.g. 0, 1 in a 4-ch MOD)
                targetChannelIndex = id % floraChannelCount;
            } else {
                targetChannelIndex = 0;
            }
        }

        // Safety clamp
        if (targetChannelIndex >= totalChannels) targetChannelIndex = 0;

        const channelInfo = channels[targetChannelIndex];

        // Trigger check
        // We use a threshold of 0.1 to avoid noise
        if (channelInfo && channelInfo.trigger > 0.1) {
            // Apply visual reaction
            // Pass the Note so the object picks the right color from its palette
            // Pass the Trigger as velocity for intensity
            reactObject(obj, channelInfo.note, channelInfo.trigger);
        }
    }
}

export class MusicReactivity {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.config = config;
    }

    // Deprecated method wrappers to maintain API compatibility if called elsewhere
    triggerNote(species, note, velocity) {
        // No-op or global broadcast if needed later
    }

    reactObject(object, note, velocity) {
        reactObject(object, note, velocity);
    }
}
