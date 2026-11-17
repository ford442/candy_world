/**
 * @file src/systems/composer/composer-voices.ts
 * @brief The grove composer's eight voices, and what unlocks each (#1976 slice C).
 *
 * One voice per tracker channel (`CHANNEL_VOICES` in `audio/generative/sequencer.ts`). Three are
 * open from the start, which is all the default pattern uses; the rest unlock through progress the
 * player already earns: finished Melodies (whose rewards come from #2153) and existing unlocks.
 * Nothing new is stored: availability is read from that state every time the editor opens.
 *
 * A lock only stops a player writing to a row. Playback plays every row of a pattern, so a visitor
 * hears the owner's whole pattern whatever they have unlocked themselves.
 *
 * Pure: no DOM, no Three.js.
 */

import { GROVE_CHANNELS } from '../../world/document/grove-pattern.ts';

export type VoiceRequirement =
    | { kind: 'unlock'; id: string; label: string }
    | { kind: 'melody'; id: string; label: string };

export interface ComposerVoice {
    channel: number;
    name: string;
    /** Absent: open from the start. */
    requires?: VoiceRequirement;
}

export const COMPOSER_VOICES: readonly ComposerVoice[] = [
    { channel: 0, name: 'Kick' },
    {
        channel: 1,
        name: 'Lead pad',
        requires: { kind: 'melody', id: 'meadow', label: 'Finish the Meadow Melody' },
    },
    { channel: 2, name: 'Melody' },
    { channel: 3, name: 'Arpeggio' },
    {
        channel: 4,
        name: 'High arpeggio',
        requires: { kind: 'unlock', id: 'arpeggio_shield', label: 'Earn the Arpeggio Shield' },
    },
    {
        channel: 5,
        name: 'Hue pad',
        requires: { kind: 'melody', id: 'garden-rhythm', label: 'Finish Garden Rhythm' },
    },
    {
        channel: 6,
        name: 'Shimmer',
        requires: { kind: 'unlock', id: 'resonance_tuner', label: 'Earn the Resonance Tuner' },
    },
    {
        channel: 7,
        name: 'Sparkle',
        requires: {
            kind: 'melody',
            id: 'night-market',
            label: 'Collect every Night Market stamp',
        },
    },
];

if (COMPOSER_VOICES.length !== GROVE_CHANNELS) {
    throw new Error('COMPOSER_VOICES must list one voice per grove channel');
}

/** The progress voices are unlocked by. */
export interface VoiceProgress {
    isUnlocked(id: string): boolean;
    completedMelodies: ReadonlySet<string>;
}

export function isVoiceAvailable(voice: ComposerVoice, progress: VoiceProgress): boolean {
    const req = voice.requires;
    if (!req) return true;
    return req.kind === 'unlock'
        ? progress.isUnlocked(req.id)
        : progress.completedMelodies.has(req.id);
}

/** Per channel, whether the player may write to it. */
export function availableVoices(progress: VoiceProgress): boolean[] {
    return COMPOSER_VOICES.map((voice) => isVoiceAvailable(voice, progress));
}
