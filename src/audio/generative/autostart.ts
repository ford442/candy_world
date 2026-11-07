import type { AudioSystem } from '../audio-system.ts';
import { resolveMusicMode } from './music-mode.ts';

/**
 * Start the generative soundtrack on the first user gesture (an AudioContext
 * cannot start before one), unless the player has loaded a tracker file by then.
 * A file loaded afterwards still takes over (`AudioSystem.loadModule`).
 */
export function armGenerativeAutostart(audioSystem: AudioSystem, target: EventTarget = window): void {
    if (resolveMusicMode() !== 'generative') return;

    const start = () => {
        target.removeEventListener('pointerdown', start, true);
        target.removeEventListener('keydown', start, true);
        if (audioSystem.getPlaylist().length > 0 || audioSystem.musicSourceMode !== 'generative') return;
        audioSystem.enableGenerativeMode().catch((err: unknown) => {
            console.warn('[AudioSystem] Generative autostart failed:', err);
        });
    };
    target.addEventListener('pointerdown', start, true);
    target.addEventListener('keydown', start, true);
}
