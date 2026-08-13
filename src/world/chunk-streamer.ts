/**
 * Spatial chunk loader (#1548) — spawn tile first, stream rings as the player moves.
 *
 * Play path (small/medium map): bootstrap spawn chunk + 1 ring (≤80 entities),
 * defer horizon via background processor. Large map uses full legacy streaming.
 */

import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import type { LoadedCandyMap, LoadedMapEntity } from './map-loader.ts';
import { processMapEntity } from './generation-entities.ts';
import type { MapEntity, WeatherSystem } from './generation-utils.ts';

export const PLAY_INITIAL_ENTITY_CAP = 80;
export const PLAY_BOOTSTRAP_RING = 1;
export const STREAM_ACTIVE_RING = 2;
export const STREAM_EVICT_RING = 4;

export interface MapChunkIndex {
    version: number;
    chunkSize: number;
    spawnChunk: string;
    entityCount: number;
    chunks: Record<string, string[]>;
}

let _index: MapChunkIndex | null = null;
let _entityById: Map<string, LoadedMapEntity> | null = null;
let _loadedChunks = new Set<string>();
let _weatherSystem: WeatherSystem | null = null;
let _generationToken = 0;
let _enabled = false;
let _lastPlayerChunk = '';
let _updateAccumulator = 0;

function parseChunkKey(key: string): { cx: number; cz: number } {
    const [cx, cz] = key.split(',').map(Number);
    return { cx, cz };
}

function chunkKeyFromXZ(x: number, z: number, chunkSize: number): string {
    return `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
}

function neighborKeys(cx: number, cz: number, ring: number): string[] {
    const keys: string[] = [];
    for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
            keys.push(`${cx + dx},${cz + dz}`);
        }
    }
    return keys;
}

export function isChunkStreamingActive(): boolean {
    return _enabled;
}

export async function loadChunkIndex(): Promise<MapChunkIndex> {
    if (_index) return _index;
    const url = new URL('../../assets/map-chunks.json', import.meta.url).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[ChunkStreamer] Failed to load map-chunks.json (${res.status})`);
    _index = (await res.json()) as MapChunkIndex;
    return _index;
}

/** Entity ids for spawn chunk + bootstrap ring, capped for Play path. */
export function getBootstrapEntityIds(index: MapChunkIndex): string[] {
    const { cx, cz } = parseChunkKey(index.spawnChunk);
    const keys = neighborKeys(cx, cz, PLAY_BOOTSTRAP_RING);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const key of keys) {
        const list = index.chunks[key];
        if (!list) continue;
        for (const id of list) {
            if (seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
            if (ids.length >= PLAY_INITIAL_ENTITY_CAP) return ids;
        }
    }
    return ids;
}

export function initChunkStreamer(
    loadedMap: LoadedCandyMap,
    index: MapChunkIndex,
    weatherSystem: WeatherSystem,
    generationToken: number
): void {
    _enabled = true;
    _index = index;
    _weatherSystem = weatherSystem;
    _generationToken = generationToken;
    _entityById = new Map(loadedMap.entities.map((e) => [e.id, e]));
    _loadedChunks.clear();
    const { cx, cz } = parseChunkKey(index.spawnChunk);
    for (const key of neighborKeys(cx, cz, PLAY_BOOTSTRAP_RING)) {
        _loadedChunks.add(key);
    }
    _lastPlayerChunk = index.spawnChunk;
}

function queueEntitySpawn(entity: LoadedMapEntity, streamed: boolean, priority: number): void {
    if (!_weatherSystem) return;
    const taskToken = _generationToken;
    globalBackgroundProcessor.enqueue({
        id: `chunk_stream_${entity.type}_${entity.id}`,
        priority,
        execute: () => {
            const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
            if (
                taskToken !== -1 &&
                taskToken !== currentToken &&
                !(window as any).__IS_FULL_BOOT_TEST
            ) {
                return;
            }
            processMapEntity(entity as MapEntity, _weatherSystem!, { streamed });
        },
    });
}

function loadChunk(chunkKey: string, priority: number): void {
    if (!_index || !_entityById || _loadedChunks.has(chunkKey)) return;
    const ids = _index.chunks[chunkKey];
    if (!ids || ids.length === 0) {
        _loadedChunks.add(chunkKey);
        return;
    }
    _loadedChunks.add(chunkKey);
    for (const id of ids) {
        const entity = _entityById.get(id);
        if (!entity) continue;
        queueEntitySpawn(entity, true, priority);
    }
}

/** Call from game loop — streams rings around the player. */
export function updateChunkStreamer(
    playerX: number,
    playerZ: number,
    delta: number
): void {
    if (!_enabled || !_index) return;
    _updateAccumulator += delta;
    if (_updateAccumulator < 0.35) return;
    _updateAccumulator = 0;

    const chunkSize = _index.chunkSize;
    const playerChunk = chunkKeyFromXZ(playerX, playerZ, chunkSize);
    if (playerChunk === _lastPlayerChunk && _loadedChunks.size > 0) return;
    _lastPlayerChunk = playerChunk;

    const { cx, cz } = parseChunkKey(playerChunk);
    const toLoad = neighborKeys(cx, cz, STREAM_ACTIVE_RING);
    let batch = 0;
    for (const key of toLoad) {
        loadChunk(key, Math.max(1, 60 - batch));
        batch++;
    }

    // Evict bookkeeping for chunks far from player (spawn tasks are one-shot; no mesh teardown).
    const keep = new Set(neighborKeys(cx, cz, STREAM_EVICT_RING));
    for (const key of [..._loadedChunks]) {
        if (!keep.has(key)) _loadedChunks.delete(key);
    }
}

export function resetChunkStreamer(): void {
    _enabled = false;
    _index = null;
    _entityById = null;
    _loadedChunks.clear();
    _weatherSystem = null;
    _lastPlayerChunk = '';
    _updateAccumulator = 0;
}
