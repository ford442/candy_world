#!/usr/bin/env node
/**
 * Build-time spatial chunk index generator (#1546 / #1548).
 *
 * Reads assets/map.json, runs it through the SAME normalization pipeline the
 * game uses at runtime (map-loader.ts::loadMap — including legacy-setpiece
 * injection and id assignment), then buckets every resulting entity into a
 * 32m chunk grid keyed by "cx,cz". The output only stores entity ids (not
 * full entity payloads) — ChunkStreamer looks the ids up against the map
 * already loaded in the browser, so this avoids scanning all ~2,219 entities
 * per boot without duplicating map.json's content.
 *
 * Usage: npm run generate:chunk-index
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadMap, type CandyMapData } from '../../src/world/map-loader.ts';

const CHUNK_SIZE = 32;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const MAP_SOURCE_PATH = path.join(REPO_ROOT, 'assets/map.json');
const OUTPUT_PATH = path.join(REPO_ROOT, 'assets/map-chunks.json');
const META_KEY = '__meta__';

function chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
}

async function main(): Promise<void> {
    const raw = JSON.parse(readFileSync(MAP_SOURCE_PATH, 'utf-8')) as CandyMapData;
    const sourceEntityCount = Array.isArray(raw.entities) ? raw.entities.length : 0;

    // Reuse the exact runtime normalization pipeline (id assignment + legacy
    // setpiece injection) so the ids in the index match what the game spawns.
    const loaded = await loadMap(raw);

    const chunks = new Map<string, string[]>();
    const seenIds = new Set<string>();
    let duplicateIds = 0;

    for (const entity of loaded.entities) {
        if (seenIds.has(entity.id)) {
            duplicateIds++;
        } else {
            seenIds.add(entity.id);
        }
        const [x, , z] = entity.position;
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);
        const key = chunkKey(cx, cz);
        let bucket = chunks.get(key);
        if (!bucket) {
            bucket = [];
            chunks.set(key, bucket);
        }
        bucket.push(entity.id);
    }

    const out: Record<string, unknown> = {
        [META_KEY]: {
            chunkSize: CHUNK_SIZE,
            entityCount: loaded.entities.length,
            sourceEntityCount,
            generatedAt: new Date().toISOString(),
        },
    };
    // Deterministic key order keeps the diff small across regenerations.
    for (const key of [...chunks.keys()].sort()) {
        out[key] = chunks.get(key);
    }

    writeFileSync(OUTPUT_PATH, `${JSON.stringify(out)}\n`);

    console.log(
        `[build-chunk-index] Wrote ${chunks.size} chunks covering ${loaded.entities.length} entities ` +
            `(${sourceEntityCount} raw + ${loaded.entities.length - sourceEntityCount} legacy setpieces) ` +
            `to ${path.relative(REPO_ROOT, OUTPUT_PATH)}`
    );
    if (duplicateIds > 0) {
        console.warn(
            `[build-chunk-index] WARNING: ${duplicateIds} duplicate entity ids encountered.`
        );
    }
}

main().catch((error) => {
    console.error('[build-chunk-index] Failed:', error);
    process.exitCode = 1;
});
