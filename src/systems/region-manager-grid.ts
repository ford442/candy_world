/**
 * @file region-manager-grid.ts
 * @description Cell types and pure cell/grid helpers shared by region-manager-core
 * and region-manager-lod. Split out so the LOD module can use them without
 * importing the RegionManager class module, which imports it back (#1827).
 */

// ============================================================================
// TYPES & ENUMS
// ============================================================================

export enum CellState {
    UNLOADED = 'unloaded',
    QUEUED = 'queued',
    LOADING = 'loading',
    LOADED = 'loaded',
    UNLOADING = 'unloading',
}

export interface GridCell {
    key: string;
    x: number;
    z: number;
    state: CellState;
    priority: number;
    loadTime?: number;
    unloadScheduleTime?: number;
    assetIds: string[];
    lodLevel: number;
    lastAccessed: number;
    dependenciesLoaded: boolean;
}

export interface CellBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerZ: number;
}

export interface CellWithBounds extends GridCell {
    bounds: CellBounds;
}

export interface RegionConfig {
    cellSize: number;
    loadRadius: number;
    unloadRadius: number;
    unloadDelayMs: number;
    lodRadii: number[];
    enableSeamlessTransitions: boolean;
    maxCellsInMemory: number;
}

export interface RegionStats {
    totalCells: number;
    loadedCells: number;
    loadingCells: number;
    queuedCells: number;
    unloadingCells: number;
    currentPlayerCellX: number;
    currentPlayerCellZ: number;
    avgLoadTime: number;
    memoryEstimate: number;
}

export interface LODTransition {
    cell: GridCell;
    fromLOD: number;
    toLOD: number;
    progress: number;
}

export interface SpatialQueryResult {
    cells: GridCell[];
    totalAssets: number;
    estimatedMemory: number;
}

export const DEFAULT_REGION_CONFIG: RegionConfig = {
    cellSize: 50,
    loadRadius: 3,
    unloadRadius: 5,
    unloadDelayMs: 10000,
    lodRadii: [120, 365, 480, 640],
    enableSeamlessTransitions: true,
    maxCellsInMemory: 100,
};

// ============================================================================
// CELL KEY UTILITIES
// ============================================================================

export function getCellKey(x: number, z: number): string {
    return `${x},${z}`;
}

const _scratchCellCoord = { x: 0, z: 0 };

export function parseCellKey(key: string): { x: number; z: number } {
    const commaIdx = key.indexOf(',');
    _scratchCellCoord.x = Number(key.substring(0, commaIdx));
    _scratchCellCoord.z = Number(key.substring(commaIdx + 1));
    return _scratchCellCoord;
}

export function worldToCell(
    worldX: number,
    worldZ: number,
    cellSize: number
): { x: number; z: number } {
    // ⚡ OPTIMIZATION: Reusing module-level scratch object to prevent GC spikes in hot update loops.
    _scratchCellCoord.x = Math.floor(worldX / cellSize);
    _scratchCellCoord.z = Math.floor(worldZ / cellSize);
    return _scratchCellCoord;
}

export function cellToBounds(cellX: number, cellZ: number, cellSize: number): CellBounds {
    const minX = cellX * cellSize;
    const maxX = minX + cellSize;
    const minZ = cellZ * cellSize;
    const maxZ = minZ + cellSize;

    return {
        minX,
        maxX,
        minZ,
        maxZ,
        centerX: (minX + maxX) / 2,
        centerZ: (minZ + maxZ) / 2,
    };
}

export function distanceToCell(
    worldX: number,
    worldZ: number,
    cellX: number,
    cellZ: number,
    cellSize: number
): number {
    return Math.sqrt(distanceToCellSq(worldX, worldZ, cellX, cellZ, cellSize));
}

export function distanceToCellSq(
    worldX: number,
    worldZ: number,
    cellX: number,
    cellZ: number,
    cellSize: number
): number {
    const bounds = cellToBounds(cellX, cellZ, cellSize);
    const dx = worldX - bounds.centerX;
    const dz = worldZ - bounds.centerZ;
    return dx * dx + dz * dz;
}
