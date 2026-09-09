import type { CandyMapData, LoadedCandyMap, LoadedMapEntity, Vec3 } from './map-loader-types.ts';
import { normalizeType } from './map-loader-normalize.ts';

const DEFAULT_SPATIAL_CELL_SIZE = 40;

interface NearestScratch {
    entity: LoadedMapEntity;
    priorityRank: number;
    distSq: number;
}

function getOriginXZ(origin: Vec3 | { x: number; z: number }): { x: number; z: number } {
    if (Array.isArray(origin)) {
        return { x: origin[0], z: origin[2] };
    }
    return { x: origin.x, z: origin.z };
}

function cellKey(cellX: number, cellZ: number): string {
    return `${cellX},${cellZ}`;
}

function toCellCoord(value: number, cellSize: number): number {
    return Math.floor(value / cellSize);
}

export class LoadedCandyMapImpl implements LoadedCandyMap {
    source: string;
    data: CandyMapData;
    entities: LoadedMapEntity[];
    private cellSize: number;
    private cellIndex: Map<string, LoadedMapEntity[]> = new Map();
    private byType: Map<string, LoadedMapEntity[]> = new Map();
    private byBiome: Map<string, LoadedMapEntity[]> = new Map();
    private byId: Map<string, LoadedMapEntity> = new Map();
    private nearestScratch: NearestScratch[] = [];
    private nearestScratchCount: number = 0;
    private streamScratch: LoadedMapEntity[] = [];
    private streamChunkScratch: LoadedMapEntity[] = [];
    private expectedInstanceCounts: Readonly<Record<string, number>>;

    constructor(source: string, data: CandyMapData, entities: LoadedMapEntity[]) {
        this.source = source;
        this.data = data;
        this.entities = entities;
        this.cellSize = DEFAULT_SPATIAL_CELL_SIZE;
        this.buildIndexes();
        this.expectedInstanceCounts = this.buildExpectedInstanceCounts();
    }

    private buildExpectedInstanceCounts(): Readonly<Record<string, number>> {
        const explicit = this.data.metadata?.expectedInstanceCounts;
        if (explicit && typeof explicit === 'object') {
            const normalized: Record<string, number> = {};
            for (const [rawType, value] of Object.entries(explicit)) {
                if (!Number.isInteger(value) || value < 0) continue;
                normalized[normalizeType(rawType)] = value;
            }
            return normalized;
        }
        const derived: Record<string, number> = {};
        for (const entity of this.entities) {
            derived[entity.type] = (derived[entity.type] ?? 0) + 1;
        }
        return derived;
    }

    private buildIndexes(): void {
        for (const entity of this.entities) {
            this.byId.set(entity.id, entity);

            const typeList = this.byType.get(entity.type);
            if (typeList) typeList.push(entity);
            else this.byType.set(entity.type, [entity]);

            const biomeTag = entity.biome ?? entity.music?.biomeTag;
            if (biomeTag) {
                const biomeList = this.byBiome.get(biomeTag);
                if (biomeList) biomeList.push(entity);
                else this.byBiome.set(biomeTag, [entity]);
            }

            const [x, , z] = entity.position;
            const cx = toCellCoord(x, this.cellSize);
            const cz = toCellCoord(z, this.cellSize);
            const key = cellKey(cx, cz);
            const cellEntities = this.cellIndex.get(key);
            if (cellEntities) {
                cellEntities.push(entity);
            } else {
                this.cellIndex.set(key, [entity]);
            }
        }
    }

    getEntitiesByType(type: string): LoadedMapEntity[] {
        const normalized = normalizeType(type);
        return this.byType.get(normalized) ?? [];
    }

    getEntitiesByBiome(biome: string): LoadedMapEntity[] {
        return this.byBiome.get(biome) ?? [];
    }

    getEntityById(id: string): LoadedMapEntity | undefined {
        return this.byId.get(id);
    }

    getEntitiesByIds(ids: readonly string[], out: LoadedMapEntity[] = []): LoadedMapEntity[] {
        out.length = 0;
        for (let i = 0; i < ids.length; i++) {
            const entity = this.byId.get(ids[i]);
            if (entity) out.push(entity);
        }
        return out;
    }

    getEntitiesInBounds(bounds: {
        minX: number;
        minY?: number;
        minZ: number;
        maxX: number;
        maxY?: number;
        maxZ: number;
    }): LoadedMapEntity[] {
        const minY = bounds.minY ?? Number.NEGATIVE_INFINITY;
        const maxY = bounds.maxY ?? Number.POSITIVE_INFINITY;
        return this.getNearestEntities({
            origin: { x: (bounds.minX + bounds.maxX) * 0.5, z: (bounds.minZ + bounds.maxZ) * 0.5 },
            // Half the diagonal covers the box from its center — the exact
            // filter below keeps results correct either way, this just
            // trims the number of spatial cells scanned to find them.
            radius: Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5,
            out: [],
        }).filter((entity) => {
            const [x, y, z] = entity.position;
            return (
                x >= bounds.minX &&
                x <= bounds.maxX &&
                y >= minY &&
                y <= maxY &&
                z >= bounds.minZ &&
                z <= bounds.maxZ
            );
        });
    }

    getNearestEntities(query: {
        origin: Vec3 | { x: number; z: number };
        radius: number;
        limit?: number;
        priorityTypes?: readonly string[];
        excludeIds?: ReadonlySet<string>;
        out?: LoadedMapEntity[];
    }): LoadedMapEntity[] {
        const { x: originX, z: originZ } = getOriginXZ(query.origin);
        const radius = Math.max(0, query.radius);
        const radiusSq = radius * radius;
        const maxCount = query.limit ?? Number.POSITIVE_INFINITY;
        const out = query.out ?? [];
        out.length = 0;

        const priorityMap = new Map<string, number>();
        if (query.priorityTypes) {
            for (let i = 0; i < query.priorityTypes.length; i++) {
                priorityMap.set(normalizeType(query.priorityTypes[i]), i);
            }
        }
        const defaultRank = priorityMap.size + 1;

        let minCellX = Number.NEGATIVE_INFINITY;
        let maxCellX = Number.POSITIVE_INFINITY;
        let minCellZ = Number.NEGATIVE_INFINITY;
        let maxCellZ = Number.POSITIVE_INFINITY;
        if (Number.isFinite(radius)) {
            minCellX = toCellCoord(originX - radius, this.cellSize);
            maxCellX = toCellCoord(originX + radius, this.cellSize);
            minCellZ = toCellCoord(originZ - radius, this.cellSize);
            maxCellZ = toCellCoord(originZ + radius, this.cellSize);
        }

        this.nearestScratchCount = 0;
        if (Number.isFinite(radius)) {
            for (let cz = minCellZ; cz <= maxCellZ; cz++) {
                for (let cx = minCellX; cx <= maxCellX; cx++) {
                    const cellEntities = this.cellIndex.get(cellKey(cx, cz));
                    if (!cellEntities) continue;
                    for (const entity of cellEntities) {
                        if (query.excludeIds?.has(entity.id)) continue;
                        const dx = entity.position[0] - originX;
                        const dz = entity.position[2] - originZ;
                        const distSq = dx * dx + dz * dz;
                        if (distSq > radiusSq) continue;
                        const rank = priorityMap.get(entity.type) ?? defaultRank;
                        const slot = this.nearestScratch[this.nearestScratchCount] ?? {
                            entity,
                            priorityRank: rank,
                            distSq,
                        };
                        slot.entity = entity;
                        slot.priorityRank = rank;
                        slot.distSq = distSq;
                        this.nearestScratch[this.nearestScratchCount] = slot;
                        this.nearestScratchCount++;
                    }
                }
            }
        } else {
            for (const entity of this.entities) {
                if (query.excludeIds?.has(entity.id)) continue;
                const dx = entity.position[0] - originX;
                const dz = entity.position[2] - originZ;
                const distSq = dx * dx + dz * dz;
                const rank = priorityMap.get(entity.type) ?? defaultRank;
                const slot = this.nearestScratch[this.nearestScratchCount] ?? {
                    entity,
                    priorityRank: rank,
                    distSq,
                };
                slot.entity = entity;
                slot.priorityRank = rank;
                slot.distSq = distSq;
                this.nearestScratch[this.nearestScratchCount] = slot;
                this.nearestScratchCount++;
            }
        }

        this.nearestScratch.length = this.nearestScratchCount;
        this.nearestScratch.sort((a, b) => {
            if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
            return a.distSq - b.distSq;
        });

        const count = Math.min(this.nearestScratchCount, maxCount);
        for (let i = 0; i < count; i++) {
            out.push(this.nearestScratch[i].entity);
        }
        return out;
    }

    *streamEntitiesNear(
        origin: Vec3 | { x: number; z: number },
        maxRadius: number,
        priorityTypes?: readonly string[],
        options?: {
            ringSize?: number;
            chunkSize?: number;
            excludeIds?: ReadonlySet<string>;
        }
    ): IterableIterator<LoadedMapEntity[]> {
        const ringSize = Math.max(8, options?.ringSize ?? 36);
        const chunkSize = Math.max(10, options?.chunkSize ?? 40);
        const { x: originX, z: originZ } = getOriginXZ(origin);
        const ordered = this.getNearestEntities({
            origin,
            radius: maxRadius,
            priorityTypes,
            excludeIds: options?.excludeIds,
            out: this.streamScratch,
        });

        let currentRing = -1;
        let currentChunkSize = 0;
        this.streamChunkScratch.length = 0;
        for (const entity of ordered) {
            const dx = entity.position[0] - originX;
            const dz = entity.position[2] - originZ;
            const ring = Math.floor(Math.hypot(dx, dz) / ringSize);
            if ((currentRing !== -1 && ring !== currentRing) || currentChunkSize >= chunkSize) {
                yield [...this.streamChunkScratch];
                this.streamChunkScratch.length = 0;
                currentChunkSize = 0;
            }
            currentRing = ring;
            this.streamChunkScratch.push(entity);
            currentChunkSize++;
        }
        if (this.streamChunkScratch.length > 0) {
            yield [...this.streamChunkScratch];
            this.streamChunkScratch.length = 0;
        }
    }

    getExpectedInstanceCounts(): Readonly<Record<string, number>> {
        return this.expectedInstanceCounts;
    }
}
