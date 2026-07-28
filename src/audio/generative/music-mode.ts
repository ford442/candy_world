import { CONFIG, FEATURE_FLAGS } from '../../core/config.ts';

export type MusicSourceMode = 'tracker' | 'generative';

/** Resolve effective music mode from CONFIG + feature flags + optional localStorage override. */
export function resolveMusicMode(): MusicSourceMode {
    const cfg = CONFIG.audio.musicMode;
    if (cfg === 'generative') return 'generative';
    if (cfg === 'tracker') return 'tracker';
    // auto
    if (FEATURE_FLAGS.generativeMusic) return 'generative';

    try {
        const stored = localStorage.getItem('candy.musicMode');
        if (stored === 'generative' || stored === 'tracker') return stored;
    } catch {
        /* non-browser */
    }

    return 'tracker';
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
