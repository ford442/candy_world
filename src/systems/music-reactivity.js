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
        } else if (s.includes('cloud') || s.includes('orb') || s.includes('geyser')) {
            map = CONFIG.noteColorMap['cloud'] || CONFIG.noteColorMap['global'];
        } else {
            map = CONFIG.noteColorMap['global'];
        }
    }

    // Debug logging of resolved palette (throttled to 1s)
    if (CONFIG.debugNoteReactivity) {
        try {
            // Use performance.now when available for higher resolution timing
            const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
            // Module-level throttle state
            if (typeof getNoteColor._lastNoteLogTime === 'undefined') getNoteColor._lastNoteLogTime = 0;
            if (now - getNoteColor._lastNoteLogTime > 1000) {
                getNoteColor._lastNoteLogTime = now;
                console.log('getNoteColor:', note, 'species=', species, 'resolvedPalette=', Object.keys(CONFIG.noteColorMap).find(k => CONFIG.noteColorMap[k] === map) || 'custom', 'noteName=', noteName, 'color=', (map[noteName] || 0xFFFFFF).toString(16));
            }
        } catch(e) {}
    }

    // Return color or fallback to White
    return map[noteName] || 0xFFFFFF;
}

export class MusicReactivity {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.config = config; // Extra config if needed
    }

    /**
     * Trigger a reaction on a specific species type
     * @param {string} species - 'mushroom', 'flower', etc.
     * @param {number|string} note - MIDI note or name
     * @param {number} velocity - 0-127 or 0-1
     */
    triggerNote(species, note, velocity) {
        // This method is intended for global broadcasting if we had a centralized list of listeners.
        // Currently, main.js iterates foliage and calls reactObject directly.
    }

    /**
     * Update loop to handle music reactivity distribution
     * @param {Object} audioState - Current state from AudioSystem
     */
    update(audioState) {
        if (!audioState || !audioState.channelData) return;

        const channels = audioState.channelData;
        const totalChannels = channels.length;
        const splitIndex = Math.ceil(totalChannels / 2); // Split point

        reactiveObjects.forEach(obj => {
            const type = obj.userData.reactivityType || 'flora';
            const id = obj.userData.reactivityId || 0;

            let targetChannelIndex;

            if (type === 'sky') {
                // Upper half (Drums/Percussion)
                const skyCount = totalChannels - splitIndex;
                if (skyCount > 0) {
                     targetChannelIndex = splitIndex + (id % skyCount);
                } else {
                     targetChannelIndex = totalChannels - 1; // Fallback
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

            // Wrap safety
            if (targetChannelIndex >= totalChannels) targetChannelIndex = 0;

            const info = channels[targetChannelIndex];
            if (info && info.trigger > 0.1) {
                // Use the object's assigned color palette (visual)
                // But trigger based on the mapped audio channel (timing)
                this.applyReaction(obj, info.note, info.trigger);
            }
        });
    }

    /**
     * Apply reaction to a specific object
     * @param {THREE.Object3D} object
     * @param {number|string} note
     * @param {number} velocity
     */
    applyReaction(object, note, velocity) {
        if (!object.userData.type) return;

        const species = object.userData.type;

        if (typeof object.reactToNote === 'function') {
            // Get color specifically for this species
            const color = getNoteColor(note, species);
            object.reactToNote(note, color, velocity);
        }
    }

    // Alias for backward compatibility if needed, but we are using applyReaction internally now
    reactObject(object, note, velocity) {
        this.applyReaction(object, note, velocity);
    }
}
