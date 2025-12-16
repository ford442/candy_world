// Music Reactivity System
// Handles Note -> Color mapping and note event routing

// Standard MIDI Note to Color Map (Sequencer Palette)
// Approximated from visual reference in plan
const COLOR_PALETTE = {
    'C':  0xFF0000, // Red
    'C#': 0xFF7F00, // Orange-Red
    'D':  0xFFFF00, // Yellow
    'D#': 0x7FFF00, // Yellow-Green
    'E':  0x00FF00, // Green
    'F':  0x00FF7F, // Blue-Green / Teal
    'F#': 0x00FFFF, // Cyan
    'G':  0x007FFF, // Sky Blue
    'G#': 0x0000FF, // Blue
    'A':  0x7F00FF, // Violet
    'A#': 0xFF00FF, // Magenta
    'B':  0xFF007F  // Pink
};

// Map MIDI note numbers (0-127) to colors
// C4 is 60. Note % 12 gives chromatic index.
const CHROMATIC_SCALE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function getNoteColor(note) {
    if (typeof note === 'number') {
        const index = note % 12;
        return COLOR_PALETTE[CHROMATIC_SCALE[index]];
    } else if (typeof note === 'string') {
        // Handle "C4", "F#3" etc.
        const pitch = note.replace(/[0-9-]/g, '');
        return COLOR_PALETTE[pitch] || 0xFFFFFF;
    }
    return 0xFFFFFF;
}

// Per-Species Configuration (Default Mappings)
// Can be overridden by main config
const SPECIES_CONFIG = {
    'mushroom': {
        // Mushrooms react to Bass/Drums usually, but mapped notes can tint caps
        targetMaterial: 'mushroomCap', // Name or part ID
        reactionType: 'pulse', // 'tint', 'pulse', 'flash'
        duration: 200
    },
    'flower': {
        // Flowers react to Melody
        targetMaterial: 'flowerPetal',
        reactionType: 'tint',
        duration: 300
    },
    'tree': {
        targetMaterial: 'trunk', // Or leaves if available
        reactionType: 'flash',
        duration: 150
    },
    'cloud': {
        targetMaterial: 'cloud',
        reactionType: 'flash',
        duration: 100
    }
};

export class MusicReactivity {
    constructor(scene, config = {}) {
        this.scene = scene;
        this.config = { ...SPECIES_CONFIG, ...config };
        this.activeReactions = []; // List of objects currently reacting
    }

    /**
     * Trigger a reaction on a specific species type
     * @param {string} species - 'mushroom', 'flower', etc.
     * @param {number|string} note - MIDI note or name
     * @param {number} velocity - 0-127 or 0-1
     */
    triggerNote(species, note, velocity) {
        const colorHex = getNoteColor(note);
        const speciesConf = this.config[species];

        if (!speciesConf) return;

        // Find objects of this species
        // Optimization: In a real engine, we'd use a pre-cached list from main.js
        // For now, we rely on the `reactToNote` method attached to objects in foliage.js

        // We broadcast to valid targets.
        // To avoid iterating scene, we assume main.js or foliage.js registers listeners,
        // OR we use a shared set of "Reactive Objects" (like `animatedFoliage` in main.js).
        // Since this module is imported by main, main should pass the list or call this.
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
        // Check if we have a mapping or if object has its own handler
        if (typeof object.reactToNote === 'function') {
            const color = getNoteColor(note);
            object.reactToNote(note, color, velocity);
        }
    }
}
