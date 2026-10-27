/**
 * Lazy start-screen "Worlds" panel (#1975) — only when a Supabase backend is
 * configured; the panel and supabase-js load in the `net` chunk after boot.
 */
import { isSupabaseConfigured } from '../systems/net/supabase-config.ts';

export function installWorldsStartScreenUI(): void {
    if (!isSupabaseConfigured()) return;
    void import('./worlds-panel.ts')
        .then((m) => m.installWorldsStartScreenUI())
        .catch((err) => console.warn('[SharedWorlds] Worlds panel failed to load:', err));
}
