/**
 * @file src/world/document/session.ts
 * @brief The open WorldDocument: its command log follows the edit history.
 *
 * `doc.commands` is two runs:
 *
 *   base — commands no undo step can reach any more (replayed from the
 *          document at load, pushed past the history cap, or folded by
 *          compaction). Stored serialized.
 *   live — WorldCommands still tracked by the EditHistory, in the order they
 *          took effect. Undo removes that command; redo appends it again.
 *
 * Commands are matched by identity, not by stack position, so a command the
 * history drops (its revert threw, so its effect is still in the world) simply
 * stays in the log. Once the unreachable prefix of `live` passes
 * COMPACTION_THRESHOLD it is folded into `base` (`compaction.ts`).
 */

import type { EditHistory, EditHistoryEvent, WorldCommand } from '../../systems/edit-history.ts';
import { deserializeWorldCommand } from '../../systems/world-commands.ts';
import { COMPACTION_THRESHOLD, compactCommands } from './compaction.ts';
import { mergeLiveProgress, readLiveProgress, unionProgress } from './progress-bridge.ts';
import type { DocumentCommand, DocumentPlayer, WorldDocumentV1 } from './schema.ts';
import type { DocumentStore } from './store.ts';

export interface SessionDeps {
    history: EditHistory;
    store: DocumentStore;
    /** Live player pose for `capture()`; the document's own pose is kept when absent. */
    readPlayer?: () => DocumentPlayer;
    /** Live progress for `capture()`; tests inject a fixture. */
    readProgress?: () => WorldDocumentV1['progress'];
    /** Debounce between an edit and the save it schedules (ms). */
    saveDelayMs?: number;
}

export interface ReplayResult {
    applied: number;
    failed: number;
}

function cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Run `fn` on each command, newest first; collect failures instead of stopping. */
function revertAll(commands: readonly WorldCommand[]): number {
    let failed = 0;
    for (let i = commands.length - 1; i >= 0; i--) {
        try {
            commands[i].revert();
        } catch (err) {
            failed++;
            console.warn('[WorldDocument] Could not revert a command:', err);
        }
    }
    return failed;
}

export class WorldDocumentSession {
    private doc: WorldDocumentV1;
    private base: DocumentCommand[];
    private live: WorldCommand[] = [];
    private readonly unsubscribe: () => void;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private lastSavedJson = '';
    private readonly listeners: Array<() => void> = [];
    private commandSource: (() => DocumentCommand[]) | null = null;

    constructor(
        doc: WorldDocumentV1,
        private readonly deps: SessionDeps
    ) {
        this.doc = cloneJson(doc);
        this.base = this.doc.commands.slice();
        this.unsubscribe = deps.history.subscribe((event, cmd) => this.onHistory(event, cmd));
    }

    get id(): string {
        return this.doc.id;
    }

    get title(): string | undefined {
        return this.doc.meta.title;
    }

    /**
     * Hand the command log to someone else: a shared world's co-editing
     * replica (#1975) holds the merged log of every peer's edits, so the saved
     * document is its log, not this session's undo-ordered one. Null restores
     * the session's own.
     */
    setCommandSource(source: (() => DocumentCommand[]) | null): void {
        this.commandSource = source;
    }

    /** Authored edits, in replay order. */
    commands(): DocumentCommand[] {
        if (this.commandSource) return this.commandSource();
        const out = this.base.slice();
        for (const cmd of this.live) {
            const data = cmd.serialize();
            if (data) out.push(data as unknown as DocumentCommand);
        }
        return out;
    }

    /** Called after every change to the command log (HUD counters, autosave). */
    onChange(listener: () => void): () => void {
        this.listeners.push(listener);
        return () => {
            const i = this.listeners.indexOf(listener);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }

    private onHistory(event: EditHistoryEvent, cmd: WorldCommand): void {
        if (event === 'undo') {
            const i = this.live.lastIndexOf(cmd);
            if (i >= 0) this.live.splice(i, 1);
        } else {
            this.live.push(cmd);
        }
        this.compact();
        for (const listener of this.listeners.slice()) listener();
        this.scheduleSave();
    }

    /** Fold the unreachable prefix of `live` into `base` once it is long enough. */
    compact(threshold = COMPACTION_THRESHOLD): void {
        if (this.commandSource) return;
        let n = 0;
        while (n < this.live.length && !this.deps.history.isUndoable(this.live[n])) n++;
        if (n === 0) return;
        const folded = this.live.splice(0, n);
        for (const cmd of folded) {
            const data = cmd.serialize();
            if (data) this.base.push(data as unknown as DocumentCommand);
        }
        if (this.base.length >= threshold) this.base = compactCommands(this.base);
    }

    /** The document as it stands now: commands, live progress, player pose. */
    capture(now = Date.now()): WorldDocumentV1 {
        const progress = this.deps.readProgress?.() ?? readLiveProgress(now);
        const doc: WorldDocumentV1 = {
            ...this.doc,
            commands: this.commands(),
            progress: unionProgress(this.doc.progress, progress),
            player: this.deps.readPlayer?.() ?? this.doc.player,
            meta: { ...this.doc.meta, updatedAt: now },
        };
        return cloneJson(doc);
    }

    setTitle(title: string): void {
        this.doc.meta.title = title.slice(0, 120);
        this.scheduleSave();
    }

    /** Write the captured document to the store; skipped when nothing changed. */
    async save(force = false): Promise<WorldDocumentV1> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const doc = this.capture();
        const json = JSON.stringify({ ...doc, meta: { ...doc.meta, updatedAt: 0 } });
        if (force || json !== this.lastSavedJson) {
            await this.deps.store.save(doc);
            this.lastSavedJson = json;
        }
        this.doc = { ...doc, commands: this.doc.commands };
        return doc;
    }

    scheduleSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.save().catch((err) => console.warn('[WorldDocument] Autosave failed:', err));
        }, this.deps.saveDelayMs ?? 1500);
    }

    /**
     * Apply the document's commands to the world (after the base world has
     * generated). They are not undo steps. A command that fails (a type this
     * build lacks, an entity with no removal path) stays in the log, so a build
     * that can apply it later still gets it.
     */
    replay(): ReplayResult {
        const result: ReplayResult = { applied: 0, failed: 0 };
        for (const data of this.base) {
            try {
                deserializeWorldCommand(data).apply();
                result.applied++;
            } catch (err) {
                result.failed++;
                console.warn(`[WorldDocument] Replay skipped a "${data.type}" command:`, err);
            }
        }
        return result;
    }

    /** Merge the document's progress into the live systems. */
    mergeProgress(): Promise<void> {
        return mergeLiveProgress(this.doc.progress);
    }

    /**
     * Take every authored edit back out of the world (newest first), leaving
     * the generated base world. The history is cleared: its commands are gone.
     */
    revertAll(): number {
        let failed = revertAll(this.live);
        const base: WorldCommand[] = [];
        for (const data of this.base) {
            try {
                base.push(deserializeWorldCommand(data));
            } catch {
                failed++;
            }
        }
        failed += revertAll(base);
        this.live = [];
        this.deps.history.clear();
        return failed;
    }

    /** Replace the open document with `next`: revert this one's edits, replay next's. */
    async switchTo(next: WorldDocumentV1): Promise<ReplayResult> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.revertAll();
        this.doc = cloneJson(next);
        this.base = this.doc.commands.slice();
        this.lastSavedJson = '';
        await this.mergeProgress();
        const result = this.replay();
        for (const listener of this.listeners.slice()) listener();
        return result;
    }

    dispose(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.unsubscribe();
        this.listeners.length = 0;
    }
}
