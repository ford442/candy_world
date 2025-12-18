// Music Reactivity System
// Handles Note -> Color mapping and note event routing

import { CONFIG } from '../core/config.js';

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
    const map = CONFIG.noteColorMap[species] || CONFIG.noteColorMap['global'];

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
     * Apply reaction to a specific object
     * @param {THREE.Object3D} object
     * @param {number|string} note
     * @param {number} velocity
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
}
