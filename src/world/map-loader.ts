import { DEFAULT_MAP_CHUNK_STREAM_SIZE } from './map-chunk-size.ts';
import type { CandyMapData, LoadedCandyMap } from './map-loader-types.ts';
import { normalizeEntity } from './map-loader-normalize.ts';
import { validateMapShape } from './map-loader-validate.ts';
import { addLegacySetpieces } from './map-loader-setpieces.ts';
import { LoadedCandyMapImpl } from './map-loader-spatial-index.ts';

export { DEFAULT_MAP_CHUNK_STREAM_SIZE } from './map-chunk-size.ts';

export type {
    Vec3,
    Quat,
    MapRotation,
    MapScale,
    MapMusicHints,
    MapMusicChannelBinding,
    MapWeatherBinding,
    MapMusicOverrides,
    MapRegion,
    CandyMapEntity,
    CandyMapData,
    LoadedMapEntity,
    LoadedCandyMap,
} from './map-loader-types.ts';

async function fetchMapJson(source: string): Promise<unknown> {
    if (typeof window === 'undefined') {
        throw new Error('[MapLoader] String map sources require a browser environment.');
    }
    const url = new URL(source, window.location.href);
    if (url.origin !== window.location.origin) {
        throw new Error(`[MapLoader] Refusing cross-origin map source: ${source}`);
    }
    const response = await fetch(url.toString(), { credentials: 'same-origin' });
    if (!response.ok) {
        throw new Error(
            `[MapLoader] Failed to load map "${source}" (${response.status} ${response.statusText})`
        );
    }
    return response.json();
}

export function getMapSourceFromUrl(
    defaultSource: string = new URL('../../assets/map.json', import.meta.url).href
): string {
    if (typeof window === 'undefined') return defaultSource;
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('map');
    if (!fromQuery || fromQuery.trim().length === 0) return defaultSource;
    return fromQuery;
}

export async function loadMap(source: string | CandyMapData): Promise<LoadedCandyMap> {
    const sourceLabel = typeof source === 'string' ? source : '[inline-map]';
    const raw = typeof source === 'string' ? await fetchMapJson(source) : source;
    validateMapShape(raw, sourceLabel);
    const withSetpieces = addLegacySetpieces(raw);
    validateMapShape(withSetpieces, sourceLabel);

    const entities = withSetpieces.entities.map((entity, index) => normalizeEntity(entity, index));
    const data: CandyMapData = {
        ...withSetpieces,
        metadata: {
            ...withSetpieces.metadata,
            version: withSetpieces.metadata?.version ?? '1.0',
        },
        entities,
        music: withSetpieces.music,
    };

    return new LoadedCandyMapImpl(sourceLabel, data, entities);
}

// --- Build-time spatial chunk index (assets/map-chunks.json) ---
// Produced by tools/map-generator/build-chunk-index.ts. Maps "cx,cz" chunk keys
// (world position divided by chunkSize, floored) to the entity ids inside that
// chunk, so ChunkStreamer can look up "what's near the spawn tile" without
// scanning every entity in the map. A reserved "__meta__" key carries the
// chunk size and total indexed entity count used for the CI parity check.
//
// Canonical chunk size: src/world/map-chunk-size.ts (re-exported above).

export interface MapChunkIndex {
    chunkSize: number;
    entityCount: number;
    chunks: Map<string, string[]>;
}

interface RawMapChunkIndexFile {
    __meta__?: { chunkSize?: number; entityCount?: number };
    [chunkKey: string]: unknown;
}

const CHUNK_INDEX_META_KEY = '__meta__';

/**
 * Fetch and parse the build-time chunk index. Returns null (never throws) when
 * the artifact is missing, stale, or malformed — callers must fall back to
 * computing chunk membership from the loaded map directly (dev / hot-reload
 * without a regenerated index).
 */
export async function loadMapChunkIndex(
    source: string = new URL('../../assets/map-chunks.json', import.meta.url).href
): Promise<MapChunkIndex | null> {
    try {
        const raw = (await fetchMapJson(source)) as RawMapChunkIndexFile;
        if (!raw || typeof raw !== 'object') return null;
        const meta = raw[CHUNK_INDEX_META_KEY];
        const chunkSize =
            typeof meta?.chunkSize === 'number' && meta.chunkSize > 0
                ? meta.chunkSize
                : DEFAULT_MAP_CHUNK_STREAM_SIZE;
        const entityCount = typeof meta?.entityCount === 'number' ? meta.entityCount : -1;

        const chunks = new Map<string, string[]>();
        for (const [key, value] of Object.entries(raw)) {
            if (key === CHUNK_INDEX_META_KEY) continue;
            if (!Array.isArray(value)) continue;
            const ids = value.filter((v): v is string => typeof v === 'string');
            chunks.set(key, ids);
        }
        if (chunks.size === 0) return null;
        return { chunkSize, entityCount, chunks };
    } catch (error) {
        console.warn(
            `[MapLoader] Chunk index unavailable (${source}); falling back to bounding-box queries.`,
            error
        );
        return null;
    }
}

export function setupMapHotReload(source: string, onReload: () => void): void {
    const hot = (import.meta as any).hot;
    if (!hot || typeof source !== 'string') return;
    hot.on('vite:beforeUpdate', (payload: { updates?: Array<{ path?: string }> }) => {
        if (!payload?.updates) return;
        const normalizedSource = source.replace(/^\.\//, '').replace(/^\//, '');
        const shouldReload = payload.updates.some((update) => {
            const path = update.path ?? '';
            return path.endsWith(normalizedSource) || path.endsWith(source);
        });
        if (shouldReload) onReload();
    });
}
