/**
 * @file src/systems/net/shared-worlds.ts
 * @brief Shared worlds in the app (#1975): open a `?world=` link, publish,
 * remix, invite, thumbnails. The lazy `net` chunk; `shared-worlds-lazy.ts` is
 * the `app` side.
 *
 * Opening a link: sign in (anonymously the first time) → redeem an invite if
 * the link carries one → `SharedWorldSync.open` (remote, local or merged copy,
 * validated) → open it as the world (its edits replay on the generated base
 * world for its seed) → join the live room when the world can be read
 * (`SharedWorldSession`). Anything that fails falls back to the player's own
 * world for the seed, with a toast saying why.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { announce } from '../../ui/announcer.ts';
import { showToast } from '../../utils/toast.ts';
import {
    documentForPublishing,
    getDocumentStore,
    openSharedDocument,
} from '../../world/document/active.ts';
import {
    RemoteDocumentStore,
    type PublishResult,
    type SharedWorldSummary,
    type WorldVisibility,
} from '../../world/document/remote-store.ts';
import type { WorldDocumentV1 } from '../../world/document/schema.ts';
import { LocalStorageSyncMetaStore, SharedWorldSync } from '../../world/document/shared-sync.ts';
import { getWorldSeed, readSharedWorldIdFromURL } from '../../world/world-seed.ts';
import { setBuildModeLock } from '../build-mode-state.ts';
import { editHistory } from '../edit-history.ts';
import { buildWorldShareUrl, readWorldInviteFromURL } from './share-links.ts';
import { SharedWorldSession } from './shared-world-session.ts';
import {
    ensureSignedIn,
    getSupabaseClient,
    linkEmail,
    type SignedInUser,
} from './supabase-client.ts';
import { SupabaseWorldsBackend } from './supabase-worlds-backend.ts';

export interface SharedWorldsContext {
    client: SupabaseClient;
    user: SignedInUser;
    backend: SupabaseWorldsBackend;
    remote: RemoteDocumentStore;
    sync: SharedWorldSync;
}

let _context: Promise<SharedWorldsContext | null> | null = null;
let _room: SharedWorldSession | null = null;
let _lastPush = 0;
const PUSH_MIN_MS = 20_000;

/** The signed-in shared-worlds services, or null without a backend (or offline). */
export function sharedWorlds(): Promise<SharedWorldsContext | null> {
    if (!_context) {
        _context = (async () => {
            const client = getSupabaseClient();
            if (!client) return null;
            const user = await ensureSignedIn(client);
            if (!user) return null;
            const backend = new SupabaseWorldsBackend(client);
            const remote = new RemoteDocumentStore(backend);
            const sync = new SharedWorldSync({
                local: getDocumentStore(),
                remote,
                meta: new LocalStorageSyncMetaStore(),
            });
            return { client, user, backend, remote, sync };
        })();
        _context.then(
            (ctx) => {
                if (!ctx) _context = null;
            },
            () => {
                _context = null;
            }
        );
    }
    return _context;
}

/** The live room for the open shared world, if any. */
export function getSharedWorldRoom(): SharedWorldSession | null {
    return _room?.active ? _room : null;
}

function stripInviteFromUrl(): void {
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('invite');
        window.history.replaceState({}, '', url.toString());
    } catch {
        // ignore
    }
}

/** Open the `?world=` world. `fallback` opens the player's own world instead. */
export async function openSharedWorldFromLink(fallback: () => void): Promise<void> {
    const id = readSharedWorldIdFromURL();
    if (!id) return fallback();
    const ctx = await sharedWorlds().catch(() => null);
    if (!ctx) {
        showToast("Shared worlds aren't available right now — opening your own world", '🌐', 5000);
        return fallback();
    }

    const invite = readWorldInviteFromURL();
    if (invite) {
        const joined = await ctx.backend.redeemInvite(id, invite);
        stripInviteFromUrl();
        if (!joined) showToast('That invite has expired; opening the world to explore', '✉️', 4000);
    }

    let opened;
    try {
        opened = await ctx.sync.open(id);
    } catch (err) {
        const message =
            (err as { userMessage?: string })?.userMessage ??
            (err instanceof Error ? err.message : String(err));
        showToast(message, '⚠️', 6000);
        return fallback();
    }
    let doc = opened.doc;
    if (doc.seed !== getWorldSeed()) {
        // The edits only make sense on their own terrain: reload on that seed.
        window.location.replace(buildWorldShareUrl(id, doc.seed));
        return;
    }

    const record = opened.record;
    const canEdit = record?.role === 'owner' || record?.role === 'editor';
    let live = true;
    if (canEdit && opened.source !== 'remote') {
        // Unsynced local edits go up first (a no-op when there are none), so
        // the room starts from one world.
        const pushed = await ctx.sync.push(doc);
        doc = pushed.doc;
        if (pushed.status === 'failed' || pushed.status === 'offline') {
            // This copy isn't the stored world: build on it alone, and let the
            // next save try the push again.
            live = false;
            showToast(
                `Couldn't share your changes yet (${pushed.message ?? pushed.status}); live co-editing is off`,
                '📡',
                6000
            );
        }
    }

    const session = await openSharedDocument(doc);
    setBuildModeLock(
        canEdit
            ? null
            : 'This shared world is view-only. Remix it from the Worlds panel to build your own.'
    );
    const title = record?.summary.title ?? doc.meta.title ?? 'a shared world';
    announce(`Opened ${title}`, 'polite');
    showToast(
        opened.source === 'offline'
            ? `Offline: opened your copy of “${title}”`
            : `Welcome to “${title}”`,
        canEdit ? '🏗️' : '🌸',
        4000
    );
    const synced = ctx.sync.syncedState(id);
    if (!record || !live || !synced) return;

    // The replica starts from the document and the row state it was synced
    // against; anything written since arrives through the room's first reconcile.
    _room = new SharedWorldSession({
        client: ctx.client,
        backend: ctx.backend,
        remote: ctx.remote,
        sync: ctx.sync,
        record,
        base: { doc, ...synced },
        session,
        history: editHistory,
        userId: ctx.user.id,
    });
    if (!(await _room.start())) {
        _room = null;
        showToast(
            'Live co-editing is unavailable; your edits sync when the world saves',
            '📡',
            5000
        );
    }
}

/** A published world was saved locally: push it, unless a live room is saving it. */
export async function onSharedDocumentSaved(doc: WorldDocumentV1): Promise<void> {
    if (_room?.active && _room.worldId === doc.id) return;
    const now = Date.now();
    if (now - _lastPush < PUSH_MIN_MS) return;
    _lastPush = now;
    const ctx = await sharedWorlds().catch(() => null);
    if (!ctx) return;
    const result = await ctx.sync.push(doc);
    if (result.status === 'failed') console.warn('[SharedWorlds] Sync failed:', result.message);
}

/** Publish this seed's world (the open one, or the stored one on the start screen). */
export async function publishCurrentWorld(options: {
    title: string;
    visibility: WorldVisibility;
}): Promise<PublishResult & { url?: string }> {
    const ctx = await sharedWorlds();
    if (!ctx) return { ok: false, code: 'offline', message: 'Shared worlds are not available.' };
    const doc = await documentForPublishing();
    const pushed = await ctx.sync.push(doc, {
        title: options.title,
        visibility: options.visibility,
        force: true,
    });
    if (!pushed.world)
        return { ok: false, code: pushed.status, message: pushed.message ?? 'Publishing failed.' };
    return {
        ok: true,
        world: pushed.world,
        created: pushed.status === 'synced',
        url: buildWorldShareUrl(doc.id, doc.seed),
    };
}

export async function listWorlds(
    tab: 'mine' | 'shared' | 'public',
    cursor: string | null = null
): Promise<{
    worlds: SharedWorldSummary[];
    next: string | null;
}> {
    const ctx = await sharedWorlds();
    if (!ctx) return { worlds: [], next: null };
    if (tab === 'mine') return { worlds: await ctx.remote.listMine(), next: null };
    if (tab === 'shared') return { worlds: await ctx.remote.listShared(), next: null };
    return ctx.remote.listPublic(cursor, 24);
}

export async function remixWorld(id: string): Promise<PublishResult & { url?: string }> {
    const ctx = await sharedWorlds();
    if (!ctx) return { ok: false, code: 'offline', message: 'Shared worlds are not available.' };
    const result = await ctx.remote.remix(id);
    return result.ok
        ? { ...result, url: buildWorldShareUrl(result.world.id, result.world.seed) }
        : result;
}

export async function deleteWorld(id: string): Promise<void> {
    const ctx = await sharedWorlds();
    await ctx?.remote.delete(id);
    new LocalStorageSyncMetaStore().delete(id);
}

export async function setWorldVisibility(id: string, visibility: WorldVisibility): Promise<void> {
    const ctx = await sharedWorlds();
    await ctx?.backend.setWorldDetails(id, { visibility });
}

/** An editor invite link for a world the caller owns. */
export async function createInviteLink(world: SharedWorldSummary): Promise<string | null> {
    const ctx = await sharedWorlds();
    if (!ctx) return null;
    const token = await ctx.backend.createInvite(world.id);
    return buildWorldShareUrl(world.id, world.seed, { invite: token });
}

export function shareLinkFor(world: SharedWorldSummary): string {
    return buildWorldShareUrl(world.id, world.seed);
}

export async function currentUser(): Promise<SignedInUser | null> {
    return (await sharedWorlds().catch(() => null))?.user ?? null;
}

/** Keep anonymous worlds across browsers: attach an email to the account. */
export async function keepWorldsWithEmail(email: string): Promise<string | null> {
    const ctx = await sharedWorlds();
    if (!ctx) return 'Shared worlds are not available.';
    return linkEmail(ctx.client, email);
}

/** Photo mode's "Set as world thumbnail", while an editable shared world is open. */
export function thumbnailAction(): { label: string; run(image: Blob): Promise<string> } | null {
    const room = getSharedWorldRoom();
    if (!room || !room.editable) return null;
    return {
        label: 'Set as world thumbnail',
        async run(image: Blob): Promise<string> {
            const ctx = await sharedWorlds();
            if (!ctx) throw new Error('Shared worlds are not available.');
            return ctx.backend.uploadThumbnail(room.worldId, image);
        },
    };
}
