/**
 * @file region-manager-core.ts
 * @description Grid-based region management for asset streaming - Core types and class
 */

// ============================================================================
// TYPES & ENUMS
// ============================================================================

export enum CellState {
    UNLOADED = 'unloaded',
    QUEUED = 'queued',
    LOADING = 'loading',
    LOADED = 'loaded',
    UNLOADING = 'unloading'
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
    lodRadii: [0, 50, 100, 200],
    enableSeamlessTransitions: true,
    maxCellsInMemory: 100
};

// ============================================================================
// CELL KEY UTILITIES
// ============================================================================

export function getCellKey(x: number, z: number): string {
    return `${x},${z}`;
}

const _scratchCellCoord = { x: 0, z: 0 };
const _scratchCells: GridCell[] = [];

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
    return {
        x: Math.floor(worldX / cellSize),
        z: Math.floor(worldZ / cellSize)
    };
}

export function cellToBounds(
    cellX: number,
    cellZ: number,
    cellSize: number
): CellBounds {
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
        centerZ: (minZ + maxZ) / 2
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

// ============================================================================
// REGION MANAGER CLASS
// ============================================================================

import * as LOD from './region-manager-lod.ts';

export class RegionManager {
    public cells: Map<string, GridCell> = new Map();
    public config: RegionConfig;
    public playerCellX: number = 0;
    public playerCellZ: number = 0;
    public playerWorldX: number = 0;
    public playerWorldZ: number = 0;
    public lastUpdate: number = 0;

    public loadQueue: GridCell[] = [];
    public unloadSchedule: Map<string, number> = new Map();

    public loadTimes: number[] = [];
    public transitionCallbacks: Array<(transition: LODTransition) => void> = [];
    public stateChangeCallbacks: Array<(cell: GridCell, oldState: CellState, newState: CellState) => void> = [];

    constructor(config: Partial<RegionConfig> = {}) {
        this.config = { ...DEFAULT_REGION_CONFIG, ...config };
    }

    updatePlayerPosition(worldX: number, worldZ: number): void {
        this.playerWorldX = worldX;
        this.playerWorldZ = worldZ;

        const newCell = worldToCell(worldX, worldZ, this.config.cellSize);

        if (newCell.x !== this.playerCellX || newCell.z !== this.playerCellZ) {
            this.playerCellX = newCell.x;
            this.playerCellZ = newCell.z;
            this.handleCellChange();
        }

        this.updateLODLevels();
        this.processScheduledUnloads();
        this.lastUpdate = performance.now();
    }

    getPlayerCell(): { x: number; z: number } {
        return { x: this.playerCellX, z: this.playerCellZ };
    }

    getPlayerPosition(): { x: number; z: number } {
        return { x: this.playerWorldX, z: this.playerWorldZ };
    }

    registerCell(cellX: number, cellZ: number, assetIds: string[] = []): GridCell {
        const key = getCellKey(cellX, cellZ);
        let cell = this.cells.get(key);
        if (!cell) {
            cell = {
                key,
                x: cellX,
                z: cellZ,
                state: CellState.UNLOADED,
                priority: 0,
                assetIds: [],
                lodLevel: 3,
                lastAccessed: performance.now(),
                dependenciesLoaded: false
            };
            this.cells.set(key, cell);
        }

        for (const id of assetIds) {
            if (!cell.assetIds.includes(id)) {
                cell.assetIds.push(id);
            }
        }

        return cell;
    }

    unregisterCell(cellX: number, cellZ: number): boolean {
        const key = getCellKey(cellX, cellZ);
        const cell = this.cells.get(key);

        if (!cell) return false;

        if (cell.state === CellState.LOADED || cell.state === CellState.LOADING) {
            this.transitionCell(cell, CellState.UNLOADED);
        }

        this.cells.delete(key);
        this.unloadSchedule.delete(key);
        return true;
    }

    getCell(cellX: number, cellZ: number): GridCell | undefined {
        return this.cells.get(getCellKey(cellX, cellZ));
    }

    getCellAtPosition(worldX: number, worldZ: number): GridCell | undefined {
        const cell = worldToCell(worldX, worldZ, this.config.cellSize);
        return this.getCell(cell.x, cell.z);
    }

    getAllCells(): GridCell[] {
        return Array.from(this.cells.values());
    }

    getCellsByState(state: CellState): GridCell[] {
        _scratchCells.length = 0;
        for (const cell of this.cells.values()) {
            if (cell.state === state) {
                _scratchCells.push(cell);
            }
        }
        return _scratchCells;
    }

    getCellsToLoad(centerX?: number, centerZ?: number, radius?: number): GridCell[] {
        return LOD.getCellsToLoad(this, centerX, centerZ, radius);
    }

    getCellsToUnload(centerX?: number, centerZ?: number, radius?: number): GridCell[] {
        return LOD.getCellsToUnload(this, centerX, centerZ, radius);
    }

    getCellsInRadius(centerX: number, centerZ: number, radius: number): string[] {
        return LOD.getCellsInRadius(centerX, centerZ, radius);
    }

    getDistantCells(minRadius: number): GridCell[] {
        return LOD.getDistantCells(this, minRadius);
    }

    queryBoundingBox(minX: number, maxX: number, minZ: number, maxZ: number): GridCell[] {
        return LOD.queryBoundingBox(this, minX, maxX, minZ, maxZ);
    }

    queryCircle(centerX: number, centerZ: number, radius: number): GridCell[] {
        return LOD.queryCircle(this, centerX, centerZ, radius);
    }

    queryDetailed(options: { centerX: number; centerZ: number; radius: number; onlyLoaded?: boolean; }): SpatialQueryResult {
        return LOD.queryDetailed(this, options);
    }

    getLODLevelForCell(cell: GridCell): number {
        return LOD.getLODLevelForCell(this, cell);
    }

    setCellLOD(cellX: number, cellZ: number, lodLevel: number): boolean {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return false;

        if (cell.lodLevel !== lodLevel) {
            const oldLOD = cell.lodLevel;
            cell.lodLevel = lodLevel;

            if (this.config.enableSeamlessTransitions) {
                this.notifyLODTransition(cell, oldLOD, lodLevel);
            }
        }

        return true;
    }

    onLODTransition(callback: (transition: LODTransition) => void): void {
        this.transitionCallbacks.push(callback);
    }

    onStateChange(callback: (cell: GridCell, oldState: CellState, newState: CellState) => void): void {
        this.stateChangeCallbacks.push(callback);
    }

    setConfig(config: Partial<RegionConfig>): void {
        this.config = { ...this.config, ...config };

        if (config.loadRadius !== undefined || config.unloadRadius !== undefined) {
            this.handleCellChange();
        }
    }

    getConfig(): RegionConfig {
        return { ...this.config };
    }

    getStats(): RegionStats {
        const loadedCells = this.getCellsByState(CellState.LOADED);
        const loadingCells = this.getCellsByState(CellState.LOADING);
        const queuedCells = this.getCellsByState(CellState.QUEUED);
        const unloadingCells = this.getCellsByState(CellState.UNLOADING);

        const avgLoadTime = this.loadTimes.length > 0
            ? this.loadTimes.reduce((a, b) => a + b, 0) / this.loadTimes.length
            : 0;

        let memoryEstimate = 0;
        for (const cell of loadedCells) {
            memoryEstimate += cell.assetIds.length * 1024 * 1024;
        }

        return {
            totalCells: this.cells.size,
            loadedCells: loadedCells.length,
            loadingCells: loadingCells.length,
            queuedCells: queuedCells.length,
            unloadingCells: unloadingCells.length,
            currentPlayerCellX: this.playerCellX,
            currentPlayerCellZ: this.playerCellZ,
            avgLoadTime,
            memoryEstimate
        };
    }

    markCellLoaded(cellX: number, cellZ: number, loadTimeMs?: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return;

        cell.loadTime = performance.now();
        cell.state = CellState.LOADED;
        cell.dependenciesLoaded = true;

        if (loadTimeMs !== undefined) {
            this.loadTimes.push(loadTimeMs);
            if (this.loadTimes.length > 100) {
                this.loadTimes.shift();
            }
        }

        this.notifyStateChange(cell, CellState.LOADING, CellState.LOADED);
    }

    scheduleCellUnload(cellX: number, cellZ: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell || cell.state !== CellState.LOADED) return;

        cell.state = CellState.UNLOADING;
        this.unloadSchedule.set(cell.key, performance.now() + this.config.unloadDelayMs);

        this.notifyStateChange(cell, CellState.LOADED, CellState.UNLOADING);
    }

    forceUnloadCell(cellX: number, cellZ: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return;

        this.transitionCell(cell, CellState.UNLOADED);
    }

    clear(): void {
        for (const cell of this.cells.values()) {
            if (cell.state === CellState.LOADED || cell.state === CellState.LOADING) {
                this.transitionCell(cell, CellState.UNLOADED);
            }
        }
        this.cells.clear();
        this.loadQueue = [];
        this.unloadSchedule.clear();
    }

    public handleCellChange(): void {
        const toLoad = this.getCellsToLoad();
        for (const cell of toLoad) {
            if (cell.state === CellState.UNLOADED) {
                this.queueCellForLoading(cell);
            }
        }

        const toUnload = this.getCellsToUnload();
        for (const cell of toUnload) {
            if (cell.state === CellState.LOADED) {
                this.scheduleCellUnload(cell.x, cell.z);
            }
        }
    }

    public queueCellForLoading(cell: GridCell): void {
        const dx = cell.x - this.playerCellX;
        const dz = cell.z - this.playerCellZ;
        const distanceSq = dx * dx + dz * dz;

        cell.priority = distanceSq;

        cell.state = CellState.QUEUED;
        this.loadQueue.push(cell);

        this.loadQueue.sort((a, b) => a.priority - b.priority);

        this.notifyStateChange(cell, CellState.UNLOADED, CellState.QUEUED);
    }

    public updateLODLevels(): void {
        for (const cell of this.cells.values()) {
            const newLOD = this.getLODLevelForCell(cell);

            if (cell.lodLevel !== newLOD) {
                const oldLOD = cell.lodLevel;
                cell.lodLevel = newLOD;

                if (this.config.enableSeamlessTransitions) {
                    this.notifyLODTransition(cell, oldLOD, newLOD);
                }
            }
        }
    }

    public processScheduledUnloads(): void {
        const now = performance.now();

        for (const [key, scheduledTime] of this.unloadSchedule) {
            if (now >= scheduledTime) {
                const cell = this.cells.get(key);
                if (cell && cell.state === CellState.UNLOADING) {
                    this.transitionCell(cell, CellState.UNLOADED);
                }
                this.unloadSchedule.delete(key);
            }
        }
    }

    public transitionCell(cell: GridCell, newState: CellState): void {
        const oldState = cell.state;

        if (oldState === newState) return;

        cell.state = newState;

        if (newState === CellState.UNLOADED) {
            cell.loadTime = undefined;
            cell.dependenciesLoaded = false;
            cell.lodLevel = 3;
        }

        this.notifyStateChange(cell, oldState, newState);
    }

    public notifyStateChange(cell: GridCell, oldState: CellState, newState: CellState): void {
        for (const callback of this.stateChangeCallbacks) {
            try {
                callback(cell, oldState, newState);
            } catch (e) {
                console.error('Error in state change callback:', e);
            }
        }
    }

    public notifyLODTransition(cell: GridCell, fromLOD: number, toLOD: number): void {
        const transition: LODTransition = {
            cell,
            fromLOD,
            toLOD,
            progress: 0
        };

        for (const callback of this.transitionCallbacks) {
            try {
                callback(transition);
            } catch (e) {
                console.error('Error in LOD transition callback:', e);
            }
        }
    }

    getCellBounds(cellX: number, cellZ: number): CellBounds {
        return cellToBounds(cellX, cellZ, this.config.cellSize);
    }

    getCellWithBounds(cellX: number, cellZ: number): CellWithBounds | undefined {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return undefined;

        return {
            ...cell,
            bounds: this.getCellBounds(cellX, cellZ)
        };
    }

    isPositionLoaded(worldX: number, worldZ: number): boolean {
        const cell = this.getCellAtPosition(worldX, worldZ);
        return cell?.state === CellState.LOADED;
    }

    getNextCellToLoad(): GridCell | undefined {
        return this.loadQueue.find(c => c.state === CellState.QUEUED);
    }

    getLoadingQueue(): GridCell[] {
        _scratchCells.length = 0;
        for (let i = 0; i < this.loadQueue.length; i++) {
            if (this.loadQueue[i].state === CellState.QUEUED) {
                _scratchCells.push(this.loadQueue[i]);
            }
        }
        return _scratchCells;
    }

    getQueueLength(): number {
        let count = 0;
        for (let i = 0; i < this.loadQueue.length; i++) {
            if (this.loadQueue[i].state === CellState.QUEUED) {
                count++;
            }
        }
        return count;
    }
}
