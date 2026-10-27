/**
 * @file src/systems/net/supabase-worlds-backend.ts
 * @brief `SharedWorldsBackend` over Supabase (#1975): PostgREST reads, the
 * `validate-world` edge function for writes, Storage for thumbnails.
 *
 * Row access is decided by RLS (supabase/migrations/*_shared_worlds.sql). An
 * unlisted world is readable only by naming it, which is the
 * `x-candy-world-id` header on the read.
 */

import {
    FunctionsFetchError,
    FunctionsHttpError,
    type SupabaseClient,
} from '@supabase/supabase-js';
import type {
    FetchedWorld,
    PublicPage,
    PublishOptions,
    PublishResult,
    SharedWorldSummary,
    SharedWorldsBackend,
    WorldRole,
    WorldVisibility,
} from '../../world/document/remote-store.ts';
import type { WorldDocumentV1 } from '../../world/document/schema.ts';

export const THUMBNAIL_BUCKET = 'world-thumbnails';
const SUMMARY_COLUMNS =
    'id, owner, title, visibility, remix_of, seed, map_version, rev, command_count, created_at, updated_at';

interface SummaryRow {
    id: string;
    owner: string;
    title: string;
    visibility: WorldVisibility;
    remix_of: string | null;
    seed: number;
    map_version: string;
    rev: number;
    command_count: number;
    created_at: string;
    updated_at: string;
}

interface PublishResponseBody {
    ok: boolean;
    code?: string;
    message?: string;
    created?: boolean;
    world?: Omit<SummaryRow, 'command_count'>;
}

function toSummary(
    row: SummaryRow | Omit<SummaryRow, 'command_count'>,
    commandCount?: number
): SharedWorldSummary {
    return {
        id: row.id,
        owner: row.owner,
        title: row.title,
        visibility: row.visibility,
        remixOf: row.remix_of,
        seed: Number(row.seed),
        mapVersion: row.map_version,
        rev: Number(row.rev),
        commandCount: 'command_count' in row ? row.command_count : (commandCount ?? 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

/** PostgREST filter values with `:` `+` `,` need double quotes. */
function quoted(value: string): string {
    return `"${value.replace(/"/g, '')}"`;
}

export interface WorldMember {
    userId: string;
    role: 'editor' | 'viewer';
    createdAt: string;
}

export class SupabaseWorldsBackend implements SharedWorldsBackend {
    constructor(readonly client: SupabaseClient) {}

    async userId(): Promise<string | null> {
        const { data } = await this.client.auth.getSession();
        return data.session?.user.id ?? null;
    }

    async publish(doc: WorldDocumentV1, options: PublishOptions): Promise<PublishResult> {
        const response = await this.client.functions.invoke<PublishResponseBody>('validate-world', {
            body: {
                doc,
                title: options.title,
                visibility: options.visibility,
                remixOf: options.remixOf,
                rev: options.rev,
                entityClock: options.entityClock,
                expectedUpdatedAt: options.expectedUpdatedAt,
            },
        });
        const error = response.error as Error | null;
        let body: PublishResponseBody | null = response.data;
        if (error) {
            if (error instanceof FunctionsFetchError) {
                return {
                    ok: false,
                    code: 'offline',
                    message: 'Could not reach the shared-worlds server.',
                };
            }
            if (error instanceof FunctionsHttpError) {
                try {
                    body = (await (error.context as Response).json()) as PublishResponseBody;
                } catch {
                    body = null;
                }
            }
            if (!body) return { ok: false, code: 'server', message: error.message };
        }
        if (!body)
            return { ok: false, code: 'server', message: 'Empty answer from validate-world.' };
        if (!body.ok || !body.world) {
            const result: PublishResult = {
                ok: false,
                code: body.code ?? 'server',
                message: body.message ?? 'Publishing failed.',
            };
            if (body.world) result.world = toSummary(body.world, doc.commands.length);
            return result;
        }
        return {
            ok: true,
            world: toSummary(body.world, doc.commands.length),
            created: body.created ?? false,
        };
    }

    async fetch(id: string): Promise<FetchedWorld | null> {
        const { data, error } = await this.client
            .from('worlds')
            .select(`${SUMMARY_COLUMNS}, doc, entity_clock`)
            .eq('id', id)
            .setHeader('x-candy-world-id', id)
            .maybeSingle();
        if (error) throw Object.assign(new Error(error.message), { code: 'offline' });
        if (!data) return null;
        const row = data as SummaryRow & { doc: unknown; entity_clock: unknown };
        const summary = toSummary(row);
        const [thumbs, role] = await Promise.all([this.thumbnails([id], id), this.roleIn(row)]);
        if (thumbs.has(id)) summary.thumbnailUrl = thumbs.get(id);
        return { summary, doc: row.doc, entityClock: row.entity_clock, role };
    }

    async listMine(): Promise<SharedWorldSummary[]> {
        const uid = await this.userId();
        if (!uid) return [];
        const { data, error } = await this.client
            .from('worlds')
            .select(SUMMARY_COLUMNS)
            .eq('owner', uid)
            .order('updated_at', { ascending: false })
            .limit(60);
        if (error) throw new Error(error.message);
        return this.withThumbnails(data ?? []);
    }

    async listShared(): Promise<SharedWorldSummary[]> {
        const uid = await this.userId();
        if (!uid) return [];
        const { data, error } = await this.client
            .from('world_editors')
            .select(`role, worlds (${SUMMARY_COLUMNS})`)
            .eq('user_id', uid)
            .limit(60);
        if (error) throw new Error(error.message);
        const rows = ((data ?? []) as unknown as Array<{ worlds: SummaryRow | null }>)
            .map((r) => r.worlds)
            .filter((w): w is SummaryRow => !!w);
        return this.withThumbnails(rows);
    }

    async listPublic(cursor: string | null, limit: number): Promise<PublicPage> {
        let query = this.client
            .from('worlds')
            .select(SUMMARY_COLUMNS)
            .eq('visibility', 'public')
            .order('updated_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(limit + 1);
        if (cursor) {
            const [updatedAt, id] = cursor.split('|');
            query = query.or(
                `updated_at.lt.${quoted(updatedAt)},and(updated_at.eq.${quoted(updatedAt)},id.lt.${quoted(id)})`
            );
        }
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as SummaryRow[];
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return {
            worlds: await this.withThumbnails(page),
            next: rows.length > limit && last ? `${last.updated_at}|${last.id}` : null,
        };
    }

    async delete(id: string): Promise<void> {
        const { error } = await this.client.from('worlds').delete().eq('id', id);
        if (error) throw new Error(error.message);
    }

    // -- Members, invites, thumbnails (owner and editor tools) ---------------

    /** An editor invite link token, valid for `days`. */
    async createInvite(worldId: string, days = 7): Promise<string> {
        const expires = new Date(Date.now() + days * 86_400_000).toISOString();
        const { data, error } = await this.client
            .from('world_invites')
            .insert({ world_id: worldId, role: 'editor', expires_at: expires })
            .select('token')
            .single();
        if (error) throw new Error(error.message);
        return String(data.token);
    }

    /** Join a world through an invite link. True when the caller is (now) a member. */
    async redeemInvite(worldId: string, token: string): Promise<boolean> {
        const uid = await this.userId();
        if (!uid) return false;
        for (const role of ['editor', 'viewer'] as const) {
            const { error } = await this.client
                .from('world_editors')
                .insert({ world_id: worldId, user_id: uid, role, invite: token });
            if (!error || error.code === '23505') return true;
        }
        return false;
    }

    async listMembers(worldId: string): Promise<WorldMember[]> {
        const { data, error } = await this.client
            .from('world_editors')
            .select('user_id, role, created_at')
            .eq('world_id', worldId);
        if (error) throw new Error(error.message);
        return (
            (data ?? []) as Array<{
                user_id: string;
                role: 'editor' | 'viewer';
                created_at: string;
            }>
        ).map((m) => ({ userId: m.user_id, role: m.role, createdAt: m.created_at }));
    }

    async removeMember(worldId: string, userId: string): Promise<void> {
        const { error } = await this.client
            .from('world_editors')
            .delete()
            .eq('world_id', worldId)
            .eq('user_id', userId);
        if (error) throw new Error(error.message);
    }

    async setWorldDetails(
        worldId: string,
        patch: { title?: string; visibility?: WorldVisibility }
    ): Promise<void> {
        const { error } = await this.client.from('worlds').update(patch).eq('id', worldId);
        if (error) throw new Error(error.message);
    }

    /** Upload a photo-mode thumbnail and make it the world's newest. Returns its URL. */
    async uploadThumbnail(worldId: string, image: Blob): Promise<string> {
        const ext =
            image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${worldId}/${Date.now()}.${ext}`;
        const { error } = await this.client.storage
            .from(THUMBNAIL_BUCKET)
            .upload(path, image, { contentType: image.type || 'image/jpeg', upsert: false });
        if (error) throw new Error(error.message);
        const { error: rowError } = await this.client
            .from('world_snapshots')
            .insert({ world_id: worldId, image_path: path });
        if (rowError) throw new Error(rowError.message);
        return this.client.storage.from(THUMBNAIL_BUCKET).getPublicUrl(path).data.publicUrl;
    }

    private async roleIn(row: SummaryRow): Promise<WorldRole | null> {
        const uid = await this.userId();
        if (!uid) return null;
        if (row.owner === uid) return 'owner';
        const { data } = await this.client
            .from('world_editors')
            .select('role')
            .eq('world_id', row.id)
            .eq('user_id', uid)
            .maybeSingle();
        return (data?.role as WorldRole | undefined) ?? null;
    }

    /** Newest thumbnail URL per world. `namedId` opens an unlisted world's snapshots. */
    private async thumbnails(ids: string[], namedId?: string): Promise<Map<string, string>> {
        const out = new Map<string, string>();
        if (ids.length === 0) return out;
        let query = this.client
            .from('world_snapshots')
            .select('world_id, image_path, ts')
            .in('world_id', ids)
            .order('ts', { ascending: false })
            .limit(ids.length * 4);
        if (namedId) query = query.setHeader('x-candy-world-id', namedId);
        const { data } = await query;
        for (const snap of (data ?? []) as Array<{ world_id: string; image_path: string }>) {
            if (out.has(snap.world_id)) continue;
            out.set(
                snap.world_id,
                this.client.storage.from(THUMBNAIL_BUCKET).getPublicUrl(snap.image_path).data
                    .publicUrl
            );
        }
        return out;
    }

    private async withThumbnails(rows: SummaryRow[]): Promise<SharedWorldSummary[]> {
        const thumbs = await this.thumbnails(rows.map((r) => r.id));
        return rows.map((r) => {
            const s = toSummary(r);
            const url = thumbs.get(r.id);
            if (url) s.thumbnailUrl = url;
            return s;
        });
    }
}
