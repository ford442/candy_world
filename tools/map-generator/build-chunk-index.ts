/**
 * Build-time spatial chunk index for map.json entities.
 * Output: assets/map-chunks.json (consumed by src/world/chunk-streamer.ts)
 *
 * Run: npx tsx tools/map-generator/build-chunk-index.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHUNK_SIZE = 50;
const SPAWN_X = 0;
const SPAWN_Z = 0;

interface RawEntity {
    id?: string;
    type: string;
    position: [number, number, number];
}

interface MapChunkIndex {
    version: 1;
    chunkSize: number;
    spawnChunk: string;
    entityCount: number;
    chunks: Record<string, string[]>;
}

function chunkKey(x: number, z: number, chunkSize: number): string {
    const cx = Math.floor(x / chunkSize);
    const cz = Math.floor(z / chunkSize);
    return `${cx},${cz}`;
}

function main(): void {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const mapPath = join(root, 'assets/map.json');
    const outPath = join(root, 'assets/map-chunks.json');

    const raw = JSON.parse(readFileSync(mapPath, 'utf8')) as { entities: RawEntity[] };
    const chunks: Record<string, string[]> = {};

    for (let i = 0; i < raw.entities.length; i++) {
        const entity = raw.entities[i];
        const id = entity.id ?? `${entity.type}_${i}`;
        const [x, , z] = entity.position;
        const key = chunkKey(x, z, CHUNK_SIZE);
        const list = chunks[key];
        if (list) list.push(id);
        else chunks[key] = [id];
    }

    const index: MapChunkIndex = {
        version: 1,
        chunkSize: CHUNK_SIZE,
        spawnChunk: chunkKey(SPAWN_X, SPAWN_Z, CHUNK_SIZE),
        entityCount: raw.entities.length,
        chunks,
    };

    writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    console.log(
        `[build-chunk-index] Wrote ${outPath} — ${index.entityCount} entities in ${Object.keys(chunks).length} chunks (spawn=${index.spawnChunk})`
    );
}

main();
