/**
 * @file src/world/document/store.ts
 * @brief Where WorldDocuments live: one adapter interface, several backends.
 *
 * `IndexedDbDocumentStore` sits on the save system's existing database
 * (`save-database.ts`, `documents` object store). `MemoryDocumentStore` backs
 * tests and browsers without IndexedDB. A remote store for shared worlds
 * (#1975) implements the same interface.
 *
 * Every `load` goes through `parseWorldDocument`, so a document written by an
 * older build is migrated on read and a damaged one is refused, not applied.
 */

import { SaveDatabase } from '../../systems/save-system/save-database.ts';
import { DOCUMENT_STORE_NAME } from '../../systems/save-system/save-types.ts';
import { parseWorldDocument } from './migrations.ts';
import type { WorldDocumentV1 } from './schema.ts';

export interface WorldDocumentSummary {
    id: string;
    title?: string;
    updatedAt: number;
    commandCount: number;
}

export interface DocumentStore {
    /** The stored document, migrated to the current schema; null when absent or unreadable. */
    load(id: string): Promise<WorldDocumentV1 | null>;
    save(doc: WorldDocumentV1): Promise<void>;
    /** Newest first. */
    list(): Promise<WorldDocumentSummary[]>;
    delete(id: string): Promise<void>;
}

function summarize(doc: WorldDocumentV1): WorldDocumentSummary {
    const summary: WorldDocumentSummary = {
        id: doc.id,
        updatedAt: doc.meta.updatedAt,
        commandCount: doc.commands.length,
    };
    if (doc.meta.title) summary.title = doc.meta.title;
    return summary;
}

function readStored(raw: unknown, id: string): WorldDocumentV1 | null {
    if (raw === undefined || raw === null) return null;
    const parsed = parseWorldDocument(raw);
    if (parsed.ok) return parsed.doc;
    console.warn(`[WorldDocument] Stored document "${id}" is unreadable:`, parsed.error.message);
    return null;
}

function newestFirst(a: WorldDocumentSummary, b: WorldDocumentSummary): number {
    return b.updatedAt - a.updatedAt;
}

/** Holds documents as JSON text, so every load is a real deserialize + validate. */
export class MemoryDocumentStore implements DocumentStore {
    private readonly docs = new Map<string, string>();

    load(id: string): Promise<WorldDocumentV1 | null> {
        const json = this.docs.get(id);
        return Promise.resolve(json === undefined ? null : readStored(JSON.parse(json), id));
    }

    save(doc: WorldDocumentV1): Promise<void> {
        this.docs.set(doc.id, JSON.stringify(doc));
        return Promise.resolve();
    }

    list(): Promise<WorldDocumentSummary[]> {
        const out: WorldDocumentSummary[] = [];
        for (const [id, json] of this.docs) {
            const doc = readStored(JSON.parse(json), id);
            if (doc) out.push(summarize(doc));
        }
        return Promise.resolve(out.sort(newestFirst));
    }

    delete(id: string): Promise<void> {
        this.docs.delete(id);
        return Promise.resolve();
    }
}

export class IndexedDbDocumentStore implements DocumentStore {
    constructor(private readonly db: SaveDatabase = new SaveDatabase()) {}

    async load(id: string): Promise<WorldDocumentV1 | null> {
        return readStored(await this.db.getRecord(DOCUMENT_STORE_NAME, id), id);
    }

    async save(doc: WorldDocumentV1): Promise<void> {
        await this.db.putRecord(DOCUMENT_STORE_NAME, doc);
    }

    async list(): Promise<WorldDocumentSummary[]> {
        const out: WorldDocumentSummary[] = [];
        for (const raw of await this.db.getAllRecords(DOCUMENT_STORE_NAME)) {
            const id = (raw as { id?: unknown })?.id;
            const doc = readStored(raw, typeof id === 'string' ? id : '?');
            if (doc) out.push(summarize(doc));
        }
        return out.sort(newestFirst);
    }

    async delete(id: string): Promise<void> {
        await this.db.deleteRecord(DOCUMENT_STORE_NAME, id);
    }
}

/** IndexedDB in browsers that have it, memory otherwise (private mode, Node). */
export function createDefaultDocumentStore(): DocumentStore {
    return typeof indexedDB === 'undefined'
        ? new MemoryDocumentStore()
        : new IndexedDbDocumentStore();
}
