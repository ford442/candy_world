// src/world/chunk-streamer.ts
// Spatial chunk streaming for the "play" boot path (#1546 / #1548).
//
// Loads only the entities inside the player's spawn tile (+1 ring) synchronously
// so Enter -> pointer-lock stays fast, then streams the rest of the map in around
// the player as they walk, driven by ChunkStreamer.update(camera.position) from
// the game loop. Reuses RegionManager (region-manager-core.ts) for cell
// bookkeeping/spiral ordering instead of forking a parallel grid.
import * as THREE from 'three';
import { globalBackgroundProcessor } from '../utils/background-processor.ts';
import { populatePhysicsGrids } from '../systems/physics/index.ts';
import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';
import { optimizedDiscovery } from '../systems/discovery-optimized.ts';
import { mushroomBatcher } from '../foliage/mushroom-batcher.ts';
import { processMapEntity } from './generation-entities.ts';
import { CellState, RegionManager, type GridCell } from '../systems/region-manager-core.ts';
import {
    DEFAULT_MAP_CHUNK_STREAM_SIZE,
    type LoadedCandyMap,
    type LoadedMapEntity,
    type MapChunkIndex,
} from './map-loader.ts';
import type { WeatherSystem } from './generation-utils.ts';
import {
    animatedFoliage,
    cpuAnimatedFoliage,
    foliageGroup,
    foliageMushrooms,
    foliageClouds,
    foliageTrampolines,
    foliagePanningPads,
    foliageGeysers,
    foliageTraps,
    foliagePortamentoPines,
    foliageVineLadders,
    interactiveObjects,
    computeFoliageObjects,
    vineSwings,
} from './state.ts';

/** World-space chunk size (metres). Re-exported for callers; canonical value lives in map-loader.ts. */
export const CHUNK_SIZE = DEFAULT_MAP_CHUNK_STREAM_SIZE;

const DEFAULT_LOAD_RING_CHUNKS = 2;
const DEFAULT_EVICT_RING_CHUNKS = 4;
const DEFAULT_SPAWN_ENTITY_CAP = 80;
// While a burst of chunk entities streams in, each spawn sets physicsDirty —
// without a floor, a full populatePhysicsGrids() rebuild (scans all of
// animatedFoliage + friends) could run on nearly every frame. Cap it to at
// most once per this interval; the flag stays set until the next eligible
// frame, so a rebuild is never silently dropped, only delayed.
const PHYSICS_REBUILD_MIN_INTERVAL_MS = 150;

const EMPTY_IDS: readonly string[] = [];

interface ChunkRecord {
    /** Objects that can be safely despawned (non-batched, or batched with a removeInstance API). */
    evictable: THREE.Object3D[];
    /** Objects loaded into this chunk that are NOT safely removable (leave spawned permanently). */
    permanentCount: number;
}

/**
 * Mirrors the `isBatched` predicate in generation-entities.ts::safeAddFoliage.
 * Kept in sync manually — that file is out of scope for this change. Batched
 * types (besides mushroom, which has MushroomBatcher.removeInstance) have no
 * public instance-removal API, so evicting them would corrupt/leak InstancedMesh
 * capacity. We never evict them; they stay spawned once loaded.
 */
function isKnownBatchedType(obj: THREE.Object3D): boolean {
    const t = obj.userData?.type;
    return !!(
        obj.userData?.isBatched ||
        t === 'lanternFlower' ||
        t === 'arpeggio_fern' ||
        t === 'portamento_pine' ||
        t === 'gem_canopy_tree' ||
        t === 'glass_mushroom' ||
        t === 'prismRoseBush' ||
        obj.userData?.isFlower
    );
}

type EvictionClass = 'full' | 'mushroom' | 'never';

function classifyForEviction(obj: THREE.Object3D): EvictionClass {
    const t = obj.userData?.type;
    if (t === 'mushroom') return 'mushroom';
    // Caves register with the WASM collision system (registerPhysicsCave) and
    // weatherSystem, neither of which support removal — never evict.
    if (t === 'cave') return 'never';
    if (isKnownBatchedType(obj)) return 'never';
    return 'full';
}

function removeFromArray<T>(arr: T[], item: T): void {
    const idx = arr.indexOf(item);
    if (idx !== -1) arr.splice(idx, 1);
}

function chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
}

/** Spiral cell coordinates, nearest ring first — reused so loadSpawnPlayable stays predictable. */
function ringCoords(
    centerCx: number,
    centerCz: number,
    radiusChunks: number
): Array<{ cx: number; cz: number }> {
    const out: Array<{ cx: number; cz: number }> = [{ cx: centerCx, cz: centerCz }];
    for (let r = 1; r <= radiusChunks; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
                out.push({ cx: centerCx + dx, cz: centerCz + dz });
            }
        }
    }
    return out;
}

export class ChunkStreamer {
    private readonly chunkSize: number;
    private readonly loadedMap: LoadedCandyMap;
    private readonly weatherSystem: WeatherSystem;
    private readonly chunkIndex: Map<string, string[]> | null;
    private readonly region: RegionManager;

    private readonly records = new Map<string, ChunkRecord>();
    private readonly spawnedIds = new Set<string>();
    private readonly discoveryRegisteredIds = new Set<string>();

    private readonly loadRingChunks: number;
    private readonly evictRingChunks: number;

    private lastCx = Number.NaN;
    private lastCz = Number.NaN;
    private physicsDirty = false;
    private lastPhysicsRebuildAt = 0;
    private disposed = false;

    constructor(
        loadedMap: LoadedCandyMap,
        weatherSystem: WeatherSystem,
        chunkIndex: MapChunkIndex | null,
        options?: { loadRingChunks?: number; evictRingChunks?: number; chunkSize?: number }
    ) {
        this.loadedMap = loadedMap;
        this.weatherSystem = weatherSystem;
        this.chunkSize = options?.chunkSize ?? chunkIndex?.chunkSize ?? CHUNK_SIZE;
        this.chunkIndex = chunkIndex?.chunks ?? null;
        this.loadRingChunks = Math.max(1, options?.loadRingChunks ?? DEFAULT_LOAD_RING_CHUNKS);
        this.evictRingChunks = Math.max(
            this.loadRingChunks + 1,
            options?.evictRingChunks ?? DEFAULT_EVICT_RING_CHUNKS
        );

        this.region = new RegionManager({
            cellSize: this.chunkSize,
            loadRadius: this.loadRingChunks,
            unloadRadius: this.evictRingChunks,
            unloadDelayMs: 0,
            enableSeamlessTransitions: false,
        });

        // Pre-register every known chunk (id lists only — no spawning) so
        // getCellsToLoad/getCellsToUnload can operate without per-frame scans
        // over all ~2,219 map entities.
        if (this.chunkIndex) {
            for (const [key, ids] of this.chunkIndex) {
                const parsed = parseChunkKey(key);
                if (!parsed) continue;
                this.region.registerCell(parsed.cx, parsed.cz, ids);
            }
        }
    }

    /** Entity ids in a chunk, using the build-time index when available, else a bounding-box fallback. */
    private idsForChunk(cx: number, cz: number): readonly string[] {
        const key = chunkKey(cx, cz);
        if (this.chunkIndex) {
            return this.chunkIndex.get(key) ?? EMPTY_IDS;
        }
        const minX = cx * this.chunkSize;
        const minZ = cz * this.chunkSize;
        const entities = this.loadedMap.getEntitiesInBounds({
            minX,
            maxX: minX + this.chunkSize,
            minZ,
            maxZ: minZ + this.chunkSize,
        });
        return entities.map((e) => e.id);
    }

    private getOrRegisterCell(cx: number, cz: number): GridCell {
        const existing = this.region.getCell(cx, cz);
        if (existing) return existing;
        // Copy rather than cast — idsForChunk can return the shared EMPTY_IDS
        // constant, and registerCell must never be handed a reference it
        // (or a future caller) might mutate.
        return this.region.registerCell(cx, cz, [...this.idsForChunk(cx, cz)]);
    }

    /**
     * Synchronously spawns the spawn chunk (0,0) plus `radiusChunks` ring,
     * capped at `maxEntities` total. Entities beyond the cap (or in chunks that
     * don't fully fit the remaining budget) are left for the runtime streamer
     * to pick up on the very next update() tick — nothing is silently dropped.
     */
    loadSpawnPlayable(radiusChunks = 1, maxEntities = DEFAULT_SPAWN_ENTITY_CAP): number {
        const coords = ringCoords(0, 0, radiusChunks);
        let spawned = 0;

        for (const { cx, cz } of coords) {
            if (spawned >= maxEntities) break;
            const cell = this.getOrRegisterCell(cx, cz);
            if (cell.state !== CellState.UNLOADED) continue;

            const ids = cell.assetIds;
            const remaining = maxEntities - spawned;
            if (ids.length === 0) {
                cell.state = CellState.LOADED;
                continue;
            }
            if (ids.length > remaining) {
                // Whole chunk doesn't fit the boot budget — leave it UNLOADED so
                // the runtime streamer finishes it on the first update() tick.
                continue;
            }

            spawned += this.spawnChunkSync(cx, cz, cell, ids);
        }

        this.lastCx = 0;
        this.lastCz = 0;
        // Anything that didn't fit the synchronous boot budget still needs to
        // load even if the player never moves — background-enqueue it now
        // rather than waiting for a chunk-boundary crossing that may not come.
        this.enqueueChunkLoads(0, 0);
        return spawned;
    }

    private spawnChunkSync(cx: number, cz: number, cell: GridCell, ids: readonly string[]): number {
        const record = this.recordFor(chunkKey(cx, cz));
        let count = 0;
        for (const id of ids) {
            if (this.spawnedIds.has(id)) continue;
            const entity = this.loadedMap.getEntityById(id);
            if (!entity) continue;
            this.spawnEntity(entity, record, false);
            count++;
        }
        cell.state = CellState.LOADED;
        this.physicsDirty = true;
        return count;
    }

    private recordFor(key: string): ChunkRecord {
        let record = this.records.get(key);
        if (!record) {
            record = { evictable: [], permanentCount: 0 };
            this.records.set(key, record);
        }
        return record;
    }

    private spawnEntity(entity: LoadedMapEntity, record: ChunkRecord, streamed: boolean): void {
        // Mark spawned in `finally` — processMapEntity has its own internal
        // try/catch so it shouldn't normally throw, but if it ever does, the
        // id must still be added (dedup on this id is what stops it being
        // re-enqueued in a loop); an id that never gets marked spawned would
        // otherwise re-attempt indefinitely without a ChunkRecord to evict it.
        const before = animatedFoliage.length;
        try {
            processMapEntity(entity, this.weatherSystem, { streamed });
        } finally {
            this.spawnedIds.add(entity.id);
        }
        if (animatedFoliage.length <= before) return;

        for (let i = before; i < animatedFoliage.length; i++) {
            const obj = animatedFoliage[i] as unknown as THREE.Object3D;
            this.trackSpawnedObject(obj, record);
        }
    }

    private trackSpawnedObject(obj: THREE.Object3D, record: ChunkRecord): void {
        const objType = obj.userData?.type;
        if (objType && !this.discoveryRegisteredIds.has(obj.uuid)) {
            this.discoveryRegisteredIds.add(obj.uuid);
            optimizedDiscovery.registerObject(obj.position, objType);
        }

        const evictionClass = classifyForEviction(obj);
        if (evictionClass === 'never') {
            record.permanentCount++;
        } else {
            (obj.userData as Record<string, unknown>).__evictionClass = evictionClass;
            record.evictable.push(obj);
        }
    }

    /**
     * Per-frame hot path. Zero-allocation unless the player has actually
     * crossed a chunk boundary (rare relative to 60fps) — the common case is
     * two Math.floor calls and an equality check.
     */
    update(position: { x: number; z: number }): void {
        if (this.disposed) return;
        const cx = Math.floor(position.x / this.chunkSize);
        const cz = Math.floor(position.z / this.chunkSize);

        if (cx === this.lastCx && cz === this.lastCz) {
            this.maybeRebuildPhysicsGrids();
            return;
        }

        this.lastCx = cx;
        this.lastCz = cz;
        this.onChunkBoundaryCrossed(cx, cz);
        this.maybeRebuildPhysicsGrids();
    }

    /** Throttled to at most once per PHYSICS_REBUILD_MIN_INTERVAL_MS — see constant comment. */
    private maybeRebuildPhysicsGrids(): void {
        if (!this.physicsDirty) return;
        const now = performance.now();
        if (now - this.lastPhysicsRebuildAt < PHYSICS_REBUILD_MIN_INTERVAL_MS) return;
        this.physicsDirty = false;
        this.lastPhysicsRebuildAt = now;
        populatePhysicsGrids();
    }

    private onChunkBoundaryCrossed(cx: number, cz: number): void {
        this.enqueueChunkLoads(cx, cz);
        this.evictFarChunks(cx, cz);
    }

    private enqueueChunkLoads(cx: number, cz: number): void {
        // Ensure every chunk coordinate in range is registered before asking
        // RegionManager for the spiral-ordered load list — getCellsToLoad only
        // considers already-registered cells.
        for (const { cx: ccx, cz: ccz } of ringCoords(cx, cz, this.loadRingChunks)) {
            this.getOrRegisterCell(ccx, ccz);
        }
        const toLoad = this.region.getCellsToLoad(cx, cz, this.loadRingChunks);
        for (const cell of toLoad) {
            if (cell.state !== CellState.UNLOADED) continue;
            cell.state = CellState.LOADING;
            this.enqueueChunkEntities(cell.x, cell.z, cell);
        }
    }

    private enqueueChunkEntities(cx: number, cz: number, cell: GridCell): void {
        const ids = cell.assetIds;
        if (ids.length === 0) {
            cell.state = CellState.LOADED;
            return;
        }
        const key = chunkKey(cx, cz);
        const record = this.recordFor(key);
        const generationTokenAtEnqueue = (window as any).__currentWorldGenerationToken ?? 0;
        let remaining = ids.length;

        for (const id of ids) {
            if (this.spawnedIds.has(id)) {
                remaining--;
                if (remaining === 0) cell.state = CellState.LOADED;
                continue;
            }
            globalBackgroundProcessor.enqueue({
                id: `chunk_stream_${key}_${id}`,
                priority: 40,
                execute: () => {
                    // Every non-disposal path below MUST settle() so `remaining`
                    // eventually hits 0 and `cell.state` leaves LOADING — a cell
                    // stuck in LOADING is invisible to both enqueueChunkLoads
                    // (only picks up UNLOADED) and evictFarChunks (only evicts
                    // LOADED), leaking its ChunkRecord forever.
                    if (this.disposed) return;
                    const settle = () => {
                        remaining--;
                        if (remaining <= 0) cell.state = CellState.LOADED;
                    };
                    const currentToken = (window as any).__currentWorldGenerationToken ?? 0;
                    if (
                        generationTokenAtEnqueue !== -1 &&
                        generationTokenAtEnqueue !== currentToken &&
                        !(window as any).__IS_FULL_BOOT_TEST
                    ) {
                        settle();
                        return;
                    }
                    if (!this.spawnedIds.has(id)) {
                        const entity = this.loadedMap.getEntityById(id);
                        if (entity) {
                            this.spawnEntity(entity, record, true);
                            this.physicsDirty = true;
                        }
                    }
                    settle();
                },
            });
        }
    }

    /**
     * Deliberately does NOT use RegionManager.getCellsToUnload() — that helper
     * routes through the WASM batchDistanceCull path (region-manager-lod.ts),
     * which was dormant/never exercised by a live caller before this feature
     * and returns every LOADED cell as an unload candidate regardless of
     * distance in this environment (root cause not chased down further; that
     * file is out of scope for this change — see .swarm-state.md). Distance
     * filtering is done directly here instead; RegionManager is still used
     * for cell state bookkeeping (forceUnloadCell) so getCellsToLoad stays
     * consistent afterward.
     */
    private evictFarChunks(cx: number, cz: number): void {
        const evictRadiusSq = this.evictRingChunks * this.evictRingChunks;
        for (const [key, record] of this.records) {
            if (record.evictable.length === 0) continue;
            const parsed = parseChunkKey(key);
            if (!parsed) continue;
            const dx = parsed.cx - cx;
            const dz = parsed.cz - cz;
            if (dx * dx + dz * dz <= evictRadiusSq) continue;

            const cell = this.region.getCell(parsed.cx, parsed.cz);
            if (cell && cell.state !== CellState.LOADED) continue; // don't race an in-flight load

            this.evictChunk(key, record);
            if (cell) this.region.forceUnloadCell(parsed.cx, parsed.cz);
        }
    }

    private evictChunk(key: string, record: ChunkRecord): void {
        for (const obj of record.evictable) {
            this.evictObject(obj);
        }
        record.evictable.length = 0;
        this.physicsDirty = true;
        if (record.permanentCount === 0) {
            this.records.delete(key);
        }
    }

    private evictObject(obj: THREE.Object3D): void {
        try {
            const evictionClass = (obj.userData as Record<string, unknown>)
                .__evictionClass as EvictionClass;
            if (evictionClass === 'mushroom') {
                mushroomBatcher.removeInstance(obj);
            }
            // Free the entity id so walking back into range re-spawns it.
            // Discovery registration is intentionally left in place — the
            // discovery grid (WASM/AS) has no unregister API (see .swarm-state.md).
            const entityId = (obj.userData as Record<string, unknown>)?.mapEntityId;
            if (typeof entityId === 'string') this.spawnedIds.delete(entityId);
            removeFromArray(animatedFoliage, obj as any);
            removeFromArray(cpuAnimatedFoliage, obj as any);
            removeFromArray(foliageMushrooms, obj as any);
            removeFromArray(foliageClouds, obj as any);
            removeFromArray(foliageTrampolines, obj as any);
            removeFromArray(foliagePanningPads, obj as any);
            removeFromArray(foliageGeysers, obj as any);
            removeFromArray(foliageTraps, obj as any);
            removeFromArray(foliagePortamentoPines, obj as any);
            removeFromArray(foliageVineLadders, obj as any);
            removeFromArray(interactiveObjects, obj as any);
            removeFromArray(computeFoliageObjects, obj as any);
            for (let i = vineSwings.length - 1; i >= 0; i--) {
                if (vineSwings[i].vine === obj) vineSwings.splice(i, 1);
            }
            safeRemoveAndDispose(foliageGroup, obj);
        } catch (error) {
            console.warn('[ChunkStreamer] Failed to evict object cleanly:', error);
        }
    }

    /** Total entities spawned so far (spawn-tile + streamed). Debug/telemetry only. */
    get spawnedCount(): number {
        return this.spawnedIds.size;
    }

    dispose(): void {
        this.disposed = true;
        // Evict every tracked evictable object before dropping the records —
        // otherwise a regenerated world (new ChunkStreamer replacing this one
        // via setActiveChunkStreamer) leaves this streamer's stale objects
        // behind in foliageGroup / the state.ts tracking arrays. Permanent
        // (never-evictable) objects are intentionally left as-is: there is no
        // safe removal path for them (see classifyForEviction), consistent
        // with how they're already handled while the streamer is active.
        for (const record of this.records.values()) {
            for (const obj of record.evictable) {
                this.evictObject(obj);
            }
            record.evictable.length = 0;
        }
        this.records.clear();
    }
}

function parseChunkKey(key: string): { cx: number; cz: number } | null {
    const commaIdx = key.indexOf(',');
    if (commaIdx === -1) return null;
    const cx = Number(key.slice(0, commaIdx));
    const cz = Number(key.slice(commaIdx + 1));
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) return null;
    return { cx, cz };
}

// --- Active-streamer singleton (read by the game-loop hook) ---
let activeStreamer: ChunkStreamer | null = null;

export function setActiveChunkStreamer(streamer: ChunkStreamer | null): void {
    if (activeStreamer && activeStreamer !== streamer) {
        activeStreamer.dispose();
    }
    activeStreamer = streamer;
}

export function getActiveChunkStreamer(): ChunkStreamer | null {
    return activeStreamer;
}
