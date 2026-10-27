/**
 * validate-world edge function entry: binds `handleValidateWorld` to the
 * caller's JWT through supabase-js, so RLS on `public.worlds` applies to the
 * write. Deploy: `supabase functions deploy validate-world` (docs/SHARED_WORLDS.md).
 */

import { createClient } from '@supabase/supabase-js';
import {
    WorldStoreError,
    handleValidateWorld,
    type NewWorldRow,
    type WorldPatch,
    type WorldRow,
    type WorldWriteStore,
} from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

function storeFor(req: Request, worldId: string | null): WorldWriteStore {
    const headers: Record<string, string> = {
        Authorization: req.headers.get('Authorization') ?? '',
    };
    // Lets the caller's own unlisted world be read back (see worlds_select).
    if (worldId) headers['x-candy-world-id'] = worldId;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers },
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const worlds = () => client.from('worlds');
    const raise = (error: { message: string; code?: string }): never => {
        throw new WorldStoreError(error.message, error.code);
    };

    return {
        async get(id: string): Promise<WorldRow | null> {
            const { data, error } = await worlds().select('*').eq('id', id).maybeSingle();
            if (error) raise(error);
            return (data as WorldRow | null) ?? null;
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

/** The doc id, read without trusting the body (validation happens in the handler). */
async function peekWorldId(req: Request): Promise<string | null> {
    try {
        const body = (await req.clone().json()) as { doc?: { id?: unknown } };
        return typeof body?.doc?.id === 'string' ? body.doc.id : null;
    } catch {
        return null;
    }
}

Deno.serve(async (req: Request) => {
    const worldId = req.method === 'POST' ? await peekWorldId(req) : null;
    return handleValidateWorld(req, storeFor(req, worldId));
});
