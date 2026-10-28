import { CONFIG, FEATURE_FLAGS } from '../../core/config.ts';

export type MusicSourceMode = 'tracker' | 'generative';

/** Resolve effective music mode from CONFIG + feature flags + optional localStorage override. */
export function resolveMusicMode(): MusicSourceMode {
    const cfg = CONFIG.audio.musicMode;
    if (cfg === 'generative') return 'generative';
    if (cfg === 'tracker') return 'tracker';
    // auto: generative unless opted out in the URL or by a saved preference.
    if (!FEATURE_FLAGS.generativeMusic) return 'tracker';

    try {
        if (localStorage.getItem('candy.musicMode') === 'tracker') return 'tracker';
    } catch {
        /* non-browser */
    }

    return 'generative';
}

export function setMusicModePreference(mode: MusicSourceMode): void {
    try {
        localStorage.setItem('candy.musicMode', mode);
    } catch {
        /* ignore */
    }
}

export function isGenerativeMusicEnabled(): boolean {
    return resolveMusicMode() === 'generative';
}
