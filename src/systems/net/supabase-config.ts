/**
 * @file src/systems/net/supabase-config.ts
 * @brief Is a Supabase backend configured? Reads the build env only, so `app`
 * can ask without loading the `net` chunk (or supabase-js).
 */

export interface SupabaseConfig {
    url: string;
    anonKey: string;
}

export function getSupabaseConfig(): SupabaseConfig | null {
    const url = import.meta.env?.VITE_SUPABASE_URL;
    const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;
    if (typeof url !== 'string' || url.length === 0) return null;
    if (typeof anonKey !== 'string' || anonKey.length === 0) return null;
    return { url, anonKey };
}

/** Presence and shared worlds both need `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. */
export function isSupabaseConfigured(): boolean {
    return getSupabaseConfig() !== null;
}
