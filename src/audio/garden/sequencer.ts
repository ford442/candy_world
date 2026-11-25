/**
 * @file src/audio/garden/sequencer.ts
 * @brief The garden sequencer's musical core (Music Garden slice B): which planted flora sound on
 * which sixteenth, and as what note.
 *
 * Pure: no Web Audio, no Three.js, no world state. The caller hands it the live plants near the
 * player (`setPlants`), the key (`setKey`) and asks what plays on a step (`notesAt`); timing is
 * `clock.ts` and `player.ts`, the audio output is `voices.ts`. That keeps it deterministic: the
 * same plants, key and step give the same notes on every client and in every test.
 *
 * What plays (`world/document/garden-flora.ts` has the figures):
 * - a **chime tulip** rings its scale degree in the biome's key, an octave above the lead, on its
 *   step and again half a bar later (the second ring softer);
 * - a **drum puffball** plays its kick, snare or hat on its grid, the kick on the key's root.
 *
 * Plants fade with distance (nothing beyond `GARDEN_HEAR_RADIUS`) and pan by where they stand
 * relative to the listener. At most `GARDEN_MAX_PLANTS` nearest plants sound, so a field of
 * hundreds cannot out-shout the soundtrack or fill the DSP's 64 voices.
 */

import {
    CHIME_TULIP_TYPE,
    DRUM_PUFFBALL_TYPE,
    GARDEN_STEPS,
    chimeHitsOn,
    drumHitsOn,
    resolveChimeTulip,
    resolveDrumPuffball,
    type ChimeTulipFigure,
    type DrumKind,
    type DrumPuffballFigure,
} from '../../world/document/garden-flora.ts';
import type { GardenInstrument } from '../generative/dsp-patches.ts';
import { noteNameToMidi, scaleNote, type NoteName } from '../generative/scales.ts';

/** Beyond this distance (m) a plant is silent. */
export const GARDEN_HEAR_RADIUS = 36;
/** The nearest this many plants sound. */
export const GARDEN_MAX_PLANTS = 24;
/** Below this loudness a plant is not worth a voice. */
const MIN_LOUDNESS = 0.04;
/** Octave of a chime's degree 0, above the generative melody (5). */
export const CHIME_OCTAVE = 5;
/** Octave of the kick's note: the key's root. */
export const KICK_OCTAVE = 2;
/** How far to the side a hard-left or hard-right plant pans (the engine clamps to ±1). */
const PAN_WIDTH = 0.85;
/** A chime's second ring (half a bar later) is this much of the first. */
const SECOND_RING = 0.7;
/** MIDI note the unpitched drums are sent: their patches ignore pitch. */
const UNPITCHED_MIDI = 60;

export interface GardenPlant {
    id: string;
    type: string;
    x: number;
    z: number;
    /** The record's raw `params` (the figure resolves and validates them). */
    params: unknown;
}

/** Where the player stands and which way their right hand points (horizontal, unit length). */
export interface GardenListener {
    x: number;
    z: number;
    rightX: number;
    rightZ: number;
}

/** The key notes resolve in (a `BiomeMusicProfile` has these and more). */
export interface GardenKey {
    root: NoteName;
    scale: readonly number[];
}

/** One note a plant plays on one step. The array `notesAt` returns is reused: copy what you keep. */
export interface GardenNote {
    plantId: string;
    instrument: GardenInstrument;
    /** MIDI note (the drums' patches ignore it). */
    midi: number;
    /** 0..1, already scaled by distance. */
    velocity: number;
    /** How many sixteenths the note is held. */
    steps: number;
    pan: number;
    /** The sixteenth it plays on (0..15). */
    step: number;
}

interface ActivePlant {
    id: string;
    kind: 'chime' | 'drum';
    chime?: ChimeTulipFigure;
    drum?: DrumPuffballFigure;
    loudness: number;
    pan: number;
}

const DRUM_INSTRUMENT: Record<DrumKind, GardenInstrument> = {
    kick: 'kick',
    snare: 'snare',
    hat: 'hat',
};

/** Resolved figures per plant id, re-resolved only when its raw params object changes. */
interface Resolved {
    raw: unknown;
    chime?: ChimeTulipFigure;
    drum?: DrumPuffballFigure;
}

export class GardenSequencer {
    private active: ActivePlant[] = [];
    private readonly resolved = new Map<string, Resolved>();
    private readonly out: GardenNote[] = [];
    private key: GardenKey = { root: 'C', scale: [0, 2, 4, 5, 7, 9, 11] };
    private kickMidi = 0;

    constructor() {
        this.setKey(this.key);
    }

    /** The key chimes and the kick resolve in. */
    setKey(key: GardenKey): void {
        this.key = key;
        this.kickMidi = noteNameToMidi(scaleNote(key.root, key.scale, 0, KICK_OCTAVE));
    }

    /** How many plants currently sound. */
    get playing(): number {
        return this.active.length;
    }

    /** True when at least one plant sounds on some step of the bar. */
    get hasPlants(): boolean {
        return this.active.length > 0;
    }

    /**
     * Take the live plants: keep the nearest `GARDEN_MAX_PLANTS` within earshot of `listener`, with
     * their loudness and pan. Call on a scan (a few times a second), not every frame.
     */
    setPlants(plants: Iterable<GardenPlant>, listener: GardenListener): void {
        const near: Array<{ plant: GardenPlant; d: number }> = [];
        for (const plant of plants) {
            if (plant.type !== CHIME_TULIP_TYPE && plant.type !== DRUM_PUFFBALL_TYPE) continue;
            const dx = plant.x - listener.x;
            const dz = plant.z - listener.z;
            const d = Math.hypot(dx, dz);
            if (d < GARDEN_HEAR_RADIUS) near.push({ plant, d });
        }
        near.sort((a, b) => a.d - b.d || (a.plant.id < b.plant.id ? -1 : 1));
        const next: ActivePlant[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < near.length && next.length < GARDEN_MAX_PLANTS; i++) {
            const { plant, d } = near[i];
            // Quadratic falloff: a plant at half range is a quarter as loud.
            const t = 1 - d / GARDEN_HEAR_RADIUS;
            const loudness = t * t;
            if (loudness < MIN_LOUDNESS) continue;
            const dx = plant.x - listener.x;
            const dz = plant.z - listener.z;
            // Right-ness of the direction to the plant; plants underfoot stay centred.
            const side = d > 1 ? (dx * listener.rightX + dz * listener.rightZ) / d : 0;
            const pan = Math.max(-1, Math.min(1, side * PAN_WIDTH));
            seen.add(plant.id);
            let r = this.resolved.get(plant.id);
            if (!r || r.raw !== plant.params) {
                r =
                    plant.type === CHIME_TULIP_TYPE
                        ? { raw: plant.params, chime: resolveChimeTulip(plant.id, plant.params) }
                        : { raw: plant.params, drum: resolveDrumPuffball(plant.id, plant.params) };
                this.resolved.set(plant.id, r);
            }
            next.push(
                r.chime
                    ? { id: plant.id, kind: 'chime', chime: r.chime, loudness, pan }
                    : { id: plant.id, kind: 'drum', drum: r.drum, loudness, pan }
            );
        }
        // Forget plants that are gone for good (not just out of earshot): keep the cache bounded.
        if (this.resolved.size > 4 * GARDEN_MAX_PLANTS + near.length) {
            for (const id of this.resolved.keys()) if (!seen.has(id)) this.resolved.delete(id);
        }
        this.active = next;
    }

    /** The figure plant `id` plays (null if it is not sounding), for the caller's visuals. */
    figureOf(id: string): ChimeTulipFigure | DrumPuffballFigure | null {
        const r = this.resolved.get(id);
        return r ? (r.chime ?? r.drum ?? null) : null;
    }

    /** The notes that play on `step` (0..15), in plant order. The array is reused. */
    notesAt(step: number): readonly GardenNote[] {
        const out = this.out;
        out.length = 0;
        const s = ((step % GARDEN_STEPS) + GARDEN_STEPS) % GARDEN_STEPS;
        for (const plant of this.active) {
            if (plant.chime) {
                if (!chimeHitsOn(plant.chime, s)) continue;
                const second = s !== plant.chime.step;
                const midi = noteNameToMidi(
                    scaleNote(this.key.root, this.key.scale, plant.chime.degree, CHIME_OCTAVE)
                );
                out.push({
                    plantId: plant.id,
                    instrument: 'chime',
                    midi,
                    velocity: plant.loudness * (second ? SECOND_RING : 1),
                    steps: 4,
                    pan: plant.pan,
                    step: s,
                });
            } else if (plant.drum) {
                if (!drumHitsOn(plant.drum, s)) continue;
                const instrument = DRUM_INSTRUMENT[plant.drum.drum];
                out.push({
                    plantId: plant.id,
                    instrument,
                    midi: instrument === 'kick' ? this.kickMidi : UNPITCHED_MIDI,
                    velocity: plant.loudness,
                    steps: instrument === 'kick' ? 2 : 1,
                    pan: plant.pan,
                    step: s,
                });
            }
        }
        return out;
    }
}
