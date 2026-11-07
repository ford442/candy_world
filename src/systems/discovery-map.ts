// src/systems/discovery-map.ts

// Define a map of discoverable items with their display names and icons.
// This is separated from physics logic to keep concerns clean.

export interface DiscoveryItem {
    name: string;
    icon: string;
    /**
     * A hidden harmonic: left out of the Discovery Log until it is found,
     * unless the player has the Resonance Tuner.
     */
    hidden?: boolean;
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
    'strobe_sickness': { name: 'Strobe Sickness', icon: '😵‍💫', hidden: true },
    'panning_pad': { name: 'Panning Pad', icon: '🧘' },
    'silence_spirit': { name: 'Silence Spirit', icon: '🦌', hidden: true },
    'subwoofer_lotus': { name: 'Subwoofer Lotus', icon: '🔊' },
    'harmony_orb': { name: 'Harmony Orb', icon: '🔮' },
    'instrument_shrine': { name: 'Instrument Shrine', icon: '⛩️' },
    'melody_mirror': { name: 'Melody Mirror', icon: '🪞', hidden: true },
    'lake_island': { name: 'Melody Lake Island', icon: '🏝️' },
    'sky_island': { name: 'Sky Island', icon: '☁️' },
    'cave': { name: 'Crystal Cave', icon: '💎', hidden: true },
    'waterfall': { name: 'Harmonic Waterfall', icon: '🌊', hidden: true },
    'wisteria_cluster': { name: 'Wisteria Cluster', icon: '🍇', hidden: true },
    'groove_boots': { name: 'Groove Boots', icon: '🥾' },
    'wind_anchor': { name: 'Wind Anchor', icon: '⚓' }
};

export type DiscoveryLogEntry =
    | { id: string; state: 'found'; name: string; icon: string }
    /** Hidden harmonic the Resonance Tuner can sense but the player has not found. */
    | { id: string; state: 'sensed'; name: string; icon: string }
    | { id: string; state: 'unknown' };

/**
 * What the Discovery Log shows. Hidden harmonics stay out of the log (and its
 * totals) until found, unless `tuned` (Resonance Tuner) is true.
 */
export function buildDiscoveryLogEntries(
    map: Readonly<Record<string, DiscoveryItem>>,
    isFound: (id: string) => boolean,
    tuned: boolean
): DiscoveryLogEntry[] {
    const entries: DiscoveryLogEntry[] = [];
    for (const id in map) {
        const info = map[id];
        if (isFound(id)) {
            entries.push({ id, state: 'found', name: info.name, icon: info.icon });
        } else if (info.hidden) {
            if (tuned) entries.push({ id, state: 'sensed', name: info.name, icon: info.icon });
        } else {
            entries.push({ id, state: 'unknown' });
        }
    }
    return entries;
}
