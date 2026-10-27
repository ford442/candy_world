/**
 * @file src/world/document/active.ts
 * @brief The player's open world: loaded after world generation, autosaved, exportable.
 *
 * One active document per world seed (a `?seed=` share link is another world).
 * Boot order: open the stored document for this seed → else import the legacy
 * stores once (while `FEATURE_FLAGS.legacyRead`) → else start an empty one;
 * then merge its progress into the live systems and replay its commands.
 */

import * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';
import { cameraRef } from '../../core/game-loop-core.ts';
import { editHistory } from '../../systems/edit-history.ts';
import { player } from '../../systems/physics/index.ts';
import { log } from '../../utils/log.ts';
import { getMapVersion, getWorldSeed } from '../world-seed.ts';
import { candyWorldFileName, decodeCandyWorld, encodeCandyWorld } from './codec.ts';
import { importLegacyStoresOnce } from './legacy-import.ts';
import type { ParseResult } from './migrations.ts';
import { createEmptyDocument, type DocumentPlayer, type WorldDocumentV1 } from './schema.ts';
import { WorldDocumentSession, type ReplayResult } from './session.ts';
import { LocalStorageSyncMetaStore } from './shared-sync.ts';
import { createDefaultDocumentStore, type DocumentStore } from './store.ts';

const ACTIVE_KEY_PREFIX = 'candy_world_active_document:';
const PERIODIC_SAVE_MS = 30_000;

let _store: DocumentStore | null = null;
let _session: WorldDocumentSession | null = null;
let _opening: Promise<WorldDocumentSession> | null = null;

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

export function getDocumentStore(): DocumentStore {
    if (!_store) _store = createDefaultDocumentStore();
    return _store;
}

/** The open session, or null before `ensureActiveWorldDocument` has resolved. */
export function getActiveSession(): WorldDocumentSession | null {
    return _session;
}

function activeKey(): string {
    return ACTIVE_KEY_PREFIX + getWorldSeed();
}

function readActiveId(): string | null {
    try {
        return localStorage.getItem(activeKey());
    } catch {
        return null;
    }
}

function writeActiveId(id: string): void {
    try {
        localStorage.setItem(activeKey(), id);
    } catch {
        // Private mode: the document still saves; next boot starts a fresh one.
    }
}

function readPlayerPose(): DocumentPlayer {
    const p = player.position;
    let yaw = 0;
    if (cameraRef) yaw = _euler.setFromQuaternion(cameraRef.quaternion, 'YXZ').y;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return { position: [round(p.x), round(p.y), round(p.z)], yaw: round(yaw) };
}

function restorePlayerPose(pose: DocumentPlayer): void {
    const [x, y, z] = pose.position;
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    if (cameraRef) cameraRef.rotation.set(0, pose.yaw, 0, 'YXZ');
}

async function openInitial(store: DocumentStore): Promise<WorldDocumentV1> {
    const seed = getWorldSeed();
    const mapVersion = getMapVersion();
    const activeId = readActiveId();
    let doc = activeId ? await store.load(activeId) : null;
    if (doc && doc.seed !== seed) doc = null;
    if (!doc && FEATURE_FLAGS.legacyRead) {
        try {
            const imported = await importLegacyStoresOnce(store, { seed, mapVersion });
            if (imported) {
                doc = imported.doc;
                log.info('WorldDocument', 'Imported legacy stores:', imported.report.imported);
            }
        } catch (err) {
            console.warn('[WorldDocument] Legacy import failed; starting fresh:', err);
        }
    }
    return doc ?? createEmptyDocument({ seed, mapVersion, title: 'My Candy World' });
}

/** Fired (detail: the saved document) when a published world is saved locally. */
export const SHARED_DOCUMENT_SAVED_EVENT = 'candy:shared-document-saved';

/**
 * A world that has been published syncs on save too (#1975): the local copy
 * stays the source of truth, and `shared-worlds-lazy.ts` pushes it when it
 * can. Unpublished worlds never load the `net` chunk.
 */
function syncIfShared(doc: WorldDocumentV1): void {
    if (!new LocalStorageSyncMetaStore().get(doc.id)) return;
    window.dispatchEvent(new CustomEvent(SHARED_DOCUMENT_SAVED_EVENT, { detail: doc }));
}

function installAutosave(session: WorldDocumentSession): void {
    if (typeof window === 'undefined') return;
    const flush = () => {
        session
            .save()
            .then(syncIfShared)
            .catch((err) => console.warn('[WorldDocument] Save failed:', err));
    };
    window.setInterval(flush, PERIODIC_SAVE_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
}

/**
 * Open (once) the active document for this world seed. Call after the base
 * world has generated: replay places entities into it.
 */
export function ensureActiveWorldDocument(): Promise<WorldDocumentSession> {
    if (_session) return Promise.resolve(_session);
    if (_opening) return _opening;
    _opening = (async () => {
        const store = getDocumentStore();
        const doc = await openInitial(store);
        const session = new WorldDocumentSession(doc, {
            history: editHistory,
            store,
            readPlayer: readPlayerPose,
        });
        await session.mergeProgress();
        const result = session.replay();
        if (result.applied + result.failed > 0) {
            log.info(
                'WorldDocument',
                `Replayed ${result.applied} edits` +
                    (result.failed ? ` (${result.failed} skipped)` : '')
            );
        }
        writeActiveId(session.id);
        await session.save(true);
        installAutosave(session);
        _session = session;
        return session;
    })();
    _opening.catch(() => {
        _opening = null;
    });
    return _opening;
}

/**
 * Open a shared world's document as the open world (#1975), after the base
 * world for its seed has generated. Unlike a per-seed world it is not
 * remembered as this seed's active world: without its link, the next visit
 * opens the player's own world again.
 */
export async function openSharedDocument(doc: WorldDocumentV1): Promise<WorldDocumentSession> {
    if (_session || _opening) {
        const session = _session ?? (await _opening!);
        if (session.id !== doc.id) await session.save();
        await session.switchTo(doc);
        await session.save(true);
        return session;
    }
    _opening = (async () => {
        const session = new WorldDocumentSession(doc, {
            history: editHistory,
            store: getDocumentStore(),
            readPlayer: readPlayerPose,
        });
        await session.mergeProgress();
        const result = session.replay();
        log.info('WorldDocument', `Opened shared world ${doc.id}: ${result.applied} edits`);
        await session.save(true);
        installAutosave(session);
        _session = session;
        return session;
    })();
    _opening.catch(() => {
        _opening = null;
    });
    return _opening;
}

/**
 * The world to publish: the open one, else this seed's stored one (the
 * start screen), else a new empty one. It is stored and made this seed's
 * active world, so the published copy and the local copy are one document.
 */
export async function documentForPublishing(): Promise<WorldDocumentV1> {
    const store = getDocumentStore();
    const doc = _session ? await _session.save() : await openInitial(store);
    await store.save(doc);
    writeActiveId(doc.id);
    return doc;
}

/**
 * The entered world has generated. A document opened earlier (the save menu
 * on the start screen) replays into it; otherwise the active one opens now.
 */
export function onWorldGenerated(): Promise<WorldDocumentSession> {
    if (_session) {
        _session.replay();
        return Promise.resolve(_session);
    }
    return ensureActiveWorldDocument();
}

/**
 * Make `doc` the open world: the current one is saved first (it stays in the
 * store), its edits come out of the world, `doc`'s go in.
 */
export async function openWorldDocument(
    doc: WorldDocumentV1,
    options: { restorePlayer?: boolean } = {}
): Promise<ReplayResult> {
    const session = await ensureActiveWorldDocument();
    if (session.id !== doc.id) await session.save();
    const result = await session.switchTo(doc);
    if (options.restorePlayer) restorePlayerPose(doc.player);
    writeActiveId(session.id);
    await session.save(true);
    return result;
}

/** The open world as `.candyworld` bytes plus a file name. */
export async function exportActiveWorld(): Promise<{ bytes: Uint8Array; fileName: string }> {
    const session = await ensureActiveWorldDocument();
    const doc = await session.save();
    return { bytes: await encodeCandyWorld(doc), fileName: candyWorldFileName(doc) };
}

/**
 * Open a `.candyworld` (or legacy save JSON) file as the active world. On
 * failure nothing changes and `error.userMessage` says why.
 */
export async function importWorldFile(file: Blob): Promise<ParseResult> {
    const parsed = await decodeCandyWorld(new Uint8Array(await file.arrayBuffer()), {
        seed: getWorldSeed(),
        mapVersion: getMapVersion(),
    });
    if (!parsed.ok) return parsed;
    if (parsed.doc.seed !== getWorldSeed()) {
        // The commands only make sense on the seed they were authored on.
        const url = new URL(window.location.href);
        url.searchParams.set('seed', String(parsed.doc.seed));
        await getDocumentStore().save(parsed.doc);
        try {
            localStorage.setItem(ACTIVE_KEY_PREFIX + parsed.doc.seed, parsed.doc.id);
        } catch {
            // ignore
        }
        window.location.assign(url.toString());
        return parsed;
    }
    await openWorldDocument(parsed.doc, { restorePlayer: true });
    return parsed;
}

/** Download the open world as a `.candyworld` file. */
export async function downloadActiveWorld(): Promise<string> {
    const { bytes, fileName } = await exportActiveWorld();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/gzip' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return fileName;
}
