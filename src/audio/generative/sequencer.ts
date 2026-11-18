import type { BiomeMusicProfile } from './biome-profiles.ts';
import { SeededRng } from './prng.ts';
import { scaleNote, noteNameToChromaticIndex, type NoteName } from './scales.ts';

export const NUM_CHANNELS = 8;
export const STEPS_PER_BAR = 16;

export interface NoteEvent {
    channel: number;
    note: string;
    velocity: number;
    /** Step index within pattern (0–15). */
    step: number;
}

export interface ChannelVoiceConfig {
    /** Oscillator type per channel role. */
    wave: OscillatorType;
    /** Base octave offset from profile root. */
    octave: number;
    /** Degree selection strategy. */
    pattern: 'bass' | 'melody' | 'arp' | 'pad' | 'kick' | 'hat' | 'fx';
    /** Note length in steps (1 = staccato). */
    length: number;
}

/** Tracker channel roles aligned with music-bindings.json. */
export const CHANNEL_VOICES: readonly ChannelVoiceConfig[] = [
    { wave: 'sine', octave: 2, pattern: 'kick', length: 1 }, // 0 kick/bass
    { wave: 'triangle', octave: 4, pattern: 'pad', length: 4 }, // 1 lead pad
    { wave: 'sine', octave: 5, pattern: 'melody', length: 2 }, // 2 melody
    { wave: 'triangle', octave: 5, pattern: 'arp', length: 1 }, // 3 arpeggio A
    { wave: 'sine', octave: 6, pattern: 'arp', length: 1 }, // 4 arpeggio B
    { wave: 'sawtooth', octave: 3, pattern: 'pad', length: 8 }, // 5 pad/hue
    { wave: 'triangle', octave: 4, pattern: 'fx', length: 2 }, // 6 global shimmer
    { wave: 'sine', octave: 5, pattern: 'fx', length: 1 }, // 7 global hue
];

/**
 * A player-authored pattern (structurally `GrovePattern`, `world/document/grove-pattern.ts`):
 * per channel, one scale degree per step, or a negative number for a rest.
 */
export interface AuthoredPattern {
    readonly channels: ReadonlyArray<{ readonly notes: readonly number[] }>;
}

/** Authored notes play at a fixed velocity: the profile's density shapes only generated ones. */
export const AUTHORED_VELOCITY = 104;

/**
 * The note an authored degree plays on `channel` in `profile`'s key and scale. Degrees count
 * scale steps above the voice's root octave, so the same pattern stays in key in every biome.
 */
export function authoredNote(profile: BiomeMusicProfile, channel: number, degree: number): string {
    const voice = CHANNEL_VOICES[channel] ?? CHANNEL_VOICES[0];
    const low = voice.pattern === 'kick' || voice.pattern === 'pad';
    return scaleNote(profile.root, profile.scale, degree, voice.octave - (low ? 1 : 0));
}

/**
 * Deterministic 16-step sequencer per channel.
 * Produces note events from seeded patterns + biome profile, or from an
 * authored pattern while one is set (the grove composer's music stones).
 */
export class GenerativeSequencer {
    readonly seed: number;
    private step = 0;
    private bar = 0;
    private readonly patterns: boolean[][] = [];
    private readonly degrees: number[][] = [];
    private profile: BiomeMusicProfile;
    private readonly pendingEvents: NoteEvent[] = [];
    private authored: AuthoredPattern | null = null;

    constructor(seed: number, profile: BiomeMusicProfile) {
        this.seed = seed;
        this.profile = profile;
        for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            this.patterns[ch] = this.generatePattern(ch);
            this.degrees[ch] = this.generateDegrees(ch);
        }
    }

    setProfile(profile: BiomeMusicProfile): void {
        this.profile = profile;
    }

    getProfile(): Readonly<BiomeMusicProfile> {
        return this.profile;
    }

    /**
     * Play `pattern` instead of the generated one from the next tick, or go back to generating
     * with null. The step and bar counters carry on, so the switch stays on the grid; the
     * generated patterns do not evolve meanwhile, so the soundtrack resumes where it left off.
     */
    setAuthoredPattern(pattern: AuthoredPattern | null): void {
        this.authored = pattern;
    }

    get playingAuthored(): boolean {
        return this.authored !== null;
    }

    getBpm(dayNightBias: number): number {
        // dayNightBias: 0 = night, 1 = day
        const nightFactor = 1.0 - dayNightBias * (1.0 - this.profile.nightTempoScale);
        return this.profile.tempo * nightFactor;
    }

    /** Advance one 16th note; returns note-ons fired this tick. */
    tick(_dayNightBias: number): readonly NoteEvent[] {
        this.pendingEvents.length = 0;
        const currentStep = this.step;
        const authored = this.authored;

        if (authored) {
            for (let ch = 0; ch < NUM_CHANNELS; ch++) {
                const degree = authored.channels[ch]?.notes[currentStep] ?? -1;
                if (!(degree >= 0)) continue;
                const note = authoredNote(this.profile, ch, degree);
                this.pendingEvents.push({
                    channel: ch,
                    note,
                    velocity: AUTHORED_VELOCITY,
                    step: currentStep,
                });
            }
        }

        for (let ch = 0; !authored && ch < NUM_CHANNELS; ch++) {
            if (!this.patterns[ch][currentStep]) continue;
            const density = this.profile.channelDensity[ch] ?? 0.5;
            if (density < 0.15) continue;

            const voice = CHANNEL_VOICES[ch];
            const note = this.resolveNote(ch, voice, currentStep);
            const velocity = Math.round(80 + density * 47);
            this.pendingEvents.push({ channel: ch, note, velocity, step: currentStep });
        }

        this.step++;
        if (this.step >= STEPS_PER_BAR) {
            this.step = 0;
            this.bar++;
            // Evolve patterns every 4 bars
            if (this.bar % 4 === 0 && !authored) {
                this.evolvePatterns();
            }
        }

        return this.pendingEvents;
    }

    getBeatPhase(_dayNightBias: number): number {
        const beatsPerStep = 1 / 4; // 16th notes
        const totalSteps = this.bar * STEPS_PER_BAR + this.step;
        const beat = (totalSteps * beatsPerStep) % 4;
        return beat / 4;
    }

    getRow(): number {
        return this.step;
    }

    getPatternIndex(): number {
        return this.bar % 64;
    }

    private resolveNote(_ch: number, voice: ChannelVoiceConfig, step: number): string {
        const root = this.profile.root as NoteName;
        const scale = this.profile.scale;
        const degree = this.degrees[_ch][step % this.degrees[_ch].length];

        switch (voice.pattern) {
            case 'kick':
                return scaleNote(root, scale, 0, voice.octave - 1);
            case 'bass':
                return scaleNote(root, scale, degree % 3, voice.octave);
            case 'melody':
                return scaleNote(root, scale, degree, voice.octave);
            case 'arp':
                return scaleNote(root, scale, (step + degree) % scale.length, voice.octave);
            case 'pad':
                return scaleNote(root, scale, degree % scale.length, voice.octave - 1);
            case 'hat':
                return scaleNote(root, scale, degree % 5, voice.octave + 1);
            case 'fx':
                return scaleNote(root, scale, (degree + _ch) % scale.length, voice.octave);
            default:
                return scaleNote(root, scale, 0, voice.octave);
        }
    }

    private generatePattern(ch: number): boolean[] {
        const rng = new SeededRng(this.seed + ch * 7919);
        const voice = CHANNEL_VOICES[ch];
        const pattern: boolean[] = new Array(STEPS_PER_BAR).fill(false);
        const density = this.profile.channelDensity[ch] ?? 0.5;

        for (let s = 0; s < STEPS_PER_BAR; s++) {
            let prob = density * 0.45;
            if (voice.pattern === 'kick') {
                prob = s % 4 === 0 ? 0.95 : s % 8 === 4 ? 0.35 : 0.05;
            } else if (voice.pattern === 'arp') {
                prob = 0.55 + density * 0.35;
            } else if (voice.pattern === 'melody') {
                prob = density * 0.35;
            }
            pattern[s] = rng.next() < prob;
        }
        return pattern;
    }

    private generateDegrees(ch: number): number[] {
        const rng = new SeededRng(this.seed + ch * 104729);
        const len = 4 + (ch % 5);
        const degrees: number[] = [];
        for (let i = 0; i < len; i++) {
            degrees.push(rng.int(0, 11));
        }
        return degrees;
    }

    private evolvePatterns(): void {
        const ch = this.bar % NUM_CHANNELS;
        const rng = new SeededRng(this.seed + this.bar * 31337);
        for (let s = 0; s < STEPS_PER_BAR; s++) {
            if (rng.next() < 0.25) {
                this.patterns[ch][s] = !this.patterns[ch][s];
            }
        }
        if (rng.next() < 0.4) {
            const idx = rng.int(0, this.degrees[ch].length - 1);
            this.degrees[ch][idx] = rng.int(0, 11);
        }
    }
}

/** Export chromatic helper for tests. */
export { noteNameToChromaticIndex };
