/**
 * @file src/systems/net/supabase-client.ts
 * @brief The one Supabase client (one socket for presence and shared worlds).
 *
 * Lives in the lazy `net` chunk with supabase-js; nothing in `app` imports it.
 * Shared worlds need a user, so `ensureSignedIn` signs in anonymously the first
 * time; `linkEmail` upgrades that user to a permanent account so its worlds
 * survive a cleared browser (docs/SHARED_WORLDS.md).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './supabase-config.ts';

let _client: SupabaseClient | null = null;

/** Realtime events per second for the whole socket: poses, cursors and edits share it. */
const REALTIME_EVENTS_PER_SECOND = 30;

export function getSupabaseClient(): SupabaseClient | null {
    if (_client) return _client;
    const cfg = getSupabaseConfig();
    if (!cfg) return null;
    // Realtime servers older than the client's default protocol (some local
    // `supabase start` stacks) crash on its binary frames; `1.0.0` is JSON.
    const vsn = import.meta.env?.VITE_SUPABASE_REALTIME_VSN;
    _client = createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'candy-world-auth' },
        realtime: {
            params: { eventsPerSecond: REALTIME_EVENTS_PER_SECOND },
            ...(vsn ? { vsn } : {}),
        },
    });
    return _client;
}

export interface SignedInUser {
    id: string;
    isAnonymous: boolean;
    email?: string;
}

/** The current user, signing in anonymously when there is none. Null when that fails. */
export async function ensureSignedIn(client: SupabaseClient): Promise<SignedInUser | null> {
    const { data } = await client.auth.getSession();
    let user = data.session?.user ?? null;
    if (!user) {
        const { data: signed, error } = await client.auth.signInAnonymously();
        if (error) {
            console.warn('[SharedWorlds] Anonymous sign-in failed:', error.message);
            return null;
        }
        user = signed.user;
    }
    if (!user) return null;
    // Private channels authorize with the session's JWT.
    const session = (await client.auth.getSession()).data.session;
    if (session) await client.realtime.setAuth(session.access_token);
    return { id: user.id, isAnonymous: user.is_anonymous ?? false, email: user.email ?? undefined };
}

/** Attach an email to the (anonymous) user; Supabase sends a confirmation link. */
export async function linkEmail(client: SupabaseClient, email: string): Promise<string | null> {
    const { error } = await client.auth.updateUser({ email });
    return error ? error.message : null;
}
