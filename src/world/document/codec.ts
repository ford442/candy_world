/**
 * @file src/world/document/codec.ts
 * @brief `.candyworld` files: a WorldDocument as gzipped JSON.
 *
 * Gzip goes through the platform `CompressionStream` (browsers, Node 18+).
 * Where it is missing the file is written as plain JSON, and decoding accepts
 * either, so a file always opens on the build that wrote it.
 */

import { parseWorldDocument, type MigrationContext, type ParseResult } from './migrations.ts';
import { WorldDocumentError, type WorldDocumentV1 } from './schema.ts';

export const CANDYWORLD_EXTENSION = '.candyworld';
export const CANDYWORLD_MIME = 'application/x-candyworld';
/** Larger files are refused before they are decompressed or parsed. */
export const MAX_CANDYWORLD_BYTES = 8 * 1024 * 1024;
const MAX_JSON_CHARS = 32 * 1024 * 1024;

function hasCompressionStreams(): boolean {
    return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

async function pipeBytes(
    bytes: Uint8Array,
    transform: CompressionStream | DecompressionStream
): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

function isGzip(bytes: Uint8Array): boolean {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Serialize a document to `.candyworld` bytes. */
export async function encodeCandyWorld(doc: WorldDocumentV1): Promise<Uint8Array> {
    const json = new TextEncoder().encode(JSON.stringify(doc));
    return hasCompressionStreams() ? pipeBytes(json, new CompressionStream('gzip')) : json;
}

/**
 * Read `.candyworld` bytes (gzipped or plain JSON, including a legacy
 * save-slot JSON export) into a validated current-schema document. Never
 * throws: every failure is a result with a message for the player.
 */
export async function decodeCandyWorld(
    input: Uint8Array | ArrayBuffer | string,
    ctx: Partial<MigrationContext> = {}
): Promise<ParseResult> {
    try {
        let text: string;
        if (typeof input === 'string') {
            text = input;
        } else {
            const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
            if (bytes.length > MAX_CANDYWORLD_BYTES) {
                throw new WorldDocumentError('This world file is too large to open.');
            }
            let json = bytes;
            if (isGzip(bytes)) {
                if (!hasCompressionStreams()) {
                    throw new WorldDocumentError("This browser can't open compressed world files.");
                }
                json = await pipeBytes(bytes, new DecompressionStream('gzip'));
            }
            text = new TextDecoder().decode(json);
        }
        if (text.length > MAX_JSON_CHARS) {
            throw new WorldDocumentError('This world file is too large to open.');
        }
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch (err) {
            throw new WorldDocumentError(
                "This world file is damaged and can't be read.",
                err instanceof Error ? err.message : String(err)
            );
        }
        return parseWorldDocument(raw, ctx);
    } catch (err) {
        const error =
            err instanceof WorldDocumentError
                ? err
                : new WorldDocumentError(
                      "This world file is damaged and can't be read.",
                      err instanceof Error ? err.message : String(err)
                  );
        return { ok: false, error };
    }
}

/** `my-grove.candyworld` from a document title; falls back to the id. */
export function candyWorldFileName(doc: WorldDocumentV1): string {
    const base = (doc.meta.title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return `${base || `candy-world-${doc.id.slice(0, 8)}`}${CANDYWORLD_EXTENSION}`;
}
