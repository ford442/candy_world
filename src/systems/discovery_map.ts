// src/systems/discovery_map.ts

// Define a map of discoverable items with their display names and icons.
// This is separated from physics logic to keep concerns clean.

export interface DiscoveryItem {
    name: string;
    icon: string;
}

export const DISCOVERY_MAP: Record<string, DiscoveryItem> = {
    'ability_sonic_clap': { name: 'Sonic Clap', icon: '👏' },
    'arpeggio_fern': { name: 'Arpeggio Fern', icon: '🌿' },
    'portamento_pine': { name: 'Portamento Pine', icon: '🌲' },
    'vibrato_violet': { name: 'Vibrato Violet', icon: '🌸' },
    'tremolo_tulip': { name: 'Tremolo Tulip', icon: '🌷' },
    'cymbal_dandelion': { name: 'Cymbal Dandelion', icon: '🌼' },
    'kick_drum_geyser': { name: 'Kick-Drum Geyser', icon: '⛲' },
    'snare_trap': { name: 'Snare-Snap Trap', icon: '🪤' },
    'retriggerMushroom': { name: 'Retrigger Mushroom', icon: '🍄' },
    'strobe_sickness': { name: 'Strobe Sickness', icon: '😵‍💫' },
    'panning_pad': { name: 'Panning Pad', icon: '🧘' },
    'silence_spirit': { name: 'Silence Spirit', icon: '🦌' },
    'subwoofer_lotus': { name: 'Subwoofer Lotus', icon: '🔊' },
    'instrument_shrine': { name: 'Instrument Shrine', icon: '⛩️' },
    'melody_mirror': { name: 'Melody Mirror', icon: '🪞' },
    'lake_island': { name: 'Melody Lake Island', icon: '🏝️' },
    'cave': { name: 'Crystal Cave', icon: '💎' },
    'waterfall': { name: 'Harmonic Waterfall', icon: '🌊' },
    'wisteria_cluster': { name: 'Wisteria Cluster', icon: '🍇' }
};
