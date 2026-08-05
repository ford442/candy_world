/**
 * Lazy presence start-screen UI — only when FEATURE_FLAGS.presence.
 */
import { FEATURE_FLAGS } from '../core/config.ts';

export function installPresenceStartScreenUI(): void {
    if (!FEATURE_FLAGS.presence) return;
    void import('./presence-panel.ts').then((m) => m.installPresenceStartScreenUI());
}
