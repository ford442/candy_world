/**
 * validate-world edge function entry: binds `handleValidateWorld` to
 * supabase-js. The caller comes from the request's JWT (checked by the auth
 * server); reads and writes use the service role, because clients have no
 * write grant on a world's document and the handler is the access check.
 * Deploy: `supabase functions deploy validate-world` (docs/SHARED_WORLDS.md).
 */

import { createClient } from '@supabase/supabase-js';
import {
    WorldStoreError,
    handleValidateWorld,
    type NewWorldRow,
    type WorldCaller,
    type WorldPatch,
    type WorldRow,
    type WorldWriteStore,
} from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const raise = (error: { message: string; code?: string }): never => {
    throw new WorldStoreError(error.message, error.code);
};

function storeFor(req: Request): WorldWriteStore {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const worlds = () => admin.from('worlds');

    return {
        async caller(): Promise<WorldCaller | null> {
            if (!jwt) return null;
            const { data, error } = await admin.auth.getUser(jwt);
            if (error || !data.user) return null;
            return { id: data.user.id, anonymous: data.user.is_anonymous === true };
        },
        async get(id: string): Promise<WorldRow | null> {
            const { data, error } = await worlds().select('*').eq('id', id).maybeSingle();
            if (error) raise(error);
            return (data as WorldRow | null) ?? null;
        },
        async memberRole(worldId: string, userId: string): Promise<'editor' | 'viewer' | null> {
            const { data, error } = await admin
                .from('world_editors')
                .select('role')
                .eq('world_id', worldId)
                .eq('user_id', userId)
                .maybeSingle();
            if (error) raise(error);
            const role = (data as { role?: unknown } | null)?.role;
            return role === 'editor' || role === 'viewer' ? role : null;
        },
        async insert(row: NewWorldRow): Promise<WorldRow> {
            const { data, error } = await worlds().insert(row).select('*').single();
            if (error) raise(error);
            return data as WorldRow;
        },
        async update(id: string, patch: WorldPatch, expected?: string): Promise<WorldRow | null> {
            let query = worlds().update(patch).eq('id', id);
            if (expected) query = query.eq('updated_at', expected);
            const { data, error } = await query.select('*').maybeSingle();
            if (error) raise(error);
            return (data as WorldRow | null) ?? null;
        },
    };
}

Deno.serve((req: Request) => handleValidateWorld(req, storeFor(req)));
