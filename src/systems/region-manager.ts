/**
 * @file region-manager.ts
 * @description Grid-based region management for asset streaming
 * 
 * Divides the world into grid cells (e.g., 50x50m) and manages:
 * - Cell loading/unloading based on player position
 * - Seamless LOD transitions between regions
 * - Delay buffers to prevent thrashing
 * - Spatial queries for efficient asset lookup
 * 
 * Cell lifecycle:
 * UNLOADED → LOADING → LOADED → UNLOADING → UNLOADED
 * 
 * The manager prevents rapid load/unload cycles by:
 * - Hysteresis: unloadRadius > loadRadius
 * - Delay buffer: cells stay loaded for X seconds outside radius
 * - Priority queue: cells closer to player load first
 */

// ============================================================================
// TYPES & ENUMS
// ============================================================================

/** Cell loading state */
export enum CellState {
    UNLOADED = 'unloaded',
    QUEUED = 'queued',       // Waiting to load
    LOADING = 'loading',     // Currently loading
    LOADED = 'loaded',       // Fully loaded
    UNLOADING = 'unloading'  // Scheduled for unload
}

/** Grid cell data structure */
export interface GridCell {
    key: string;              // "x,z" format for map key
    x: number;                // Grid coordinates
    z: number;
    state: CellState;
    priority: number;         // Load priority (distance-based)
    loadTime?: number;        // When cell was loaded
    unloadScheduleTime?: number;  // When to actually unload
    assetIds: string[];       // Asset IDs in this cell
    lodLevel: number;         // Current LOD (0 = full detail)
    lastAccessed: number;     // For LRU eviction
    dependenciesLoaded: boolean;
}

/** Cell bounds in world coordinates */
export interface CellBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerZ: number;
}

/** Cell with world-space bounds */
export interface CellWithBounds extends GridCell {
    bounds: CellBounds;
}

/** Region configuration */
export interface RegionConfig {
    cellSize: number;           // Meters per cell
    loadRadius: number;         // Cells to load
    unloadRadius: number;       // Cells to keep (hysteresis)
    unloadDelayMs: number;      // Delay before unload
    lodRadii: number[];         // LOD distance thresholds
    enableSeamlessTransitions: boolean;
    maxCellsInMemory: number;   // Hard limit
}

/** Region statistics */
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

/** LOD transition info */
export interface LODTransition {
    cell: GridCell;
    fromLOD: number;
    toLOD: number;
    progress: number;     // 0-1 transition progress
}

/** Query result for spatial lookups */
export interface SpatialQueryResult {
    cells: GridCell[];
    totalAssets: number;
    estimatedMemory: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_REGION_CONFIG: RegionConfig = {
    cellSize: 50,
    loadRadius: 3,
    unloadRadius: 5,
    unloadDelayMs: 10000,
    lodRadii: [0, 50, 100, 200],  // Full, high, medium, low detail
    enableSeamlessTransitions: true,
    maxCellsInMemory: 100
};

// ============================================================================
// CELL KEY UTILITIES
// ============================================================================

/** Generate cell key from coordinates */
export function getCellKey(x: number, z: number): string {
    return `${x},${z}`;
}

// ⚡ OPTIMIZATION: Module-level scratch object for zero-allocation parsing
const _scratchCellCoord = { x: 0, z: 0 };

/** Parse cell key into coordinates */
export function parseCellKey(key: string): { x: number; z: number } {
    const commaIdx = key.indexOf(',');
    _scratchCellCoord.x = Number(key.substring(0, commaIdx));
    _scratchCellCoord.z = Number(key.substring(commaIdx + 1));
    return _scratchCellCoord;
}

/** Convert world position to cell coordinates */
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

/** Convert cell coordinates to world bounds */
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

/** Get distance from world position to cell center */
export function distanceToCell(
    worldX: number,
    worldZ: number,
    cellX: number,
    cellZ: number,
    cellSize: number
): number {
    return Math.sqrt(distanceToCellSq(worldX, worldZ, cellX, cellZ, cellSize));
}

/** Get squared distance from world position to cell center (Optimized) */
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

/**
 * Manages world grid cells for efficient streaming.
 * 
 * Key features:
 * - Spiral iteration for priority loading (closest first)
 * - Hysteresis to prevent thrashing
 * - LOD transitions based on distance
 * - Spatial queries for efficient lookup
 */
export class RegionManager {
    private cells: Map<string, GridCell> = new Map();
    private config: RegionConfig;
    private playerCellX: number = 0;
    private playerCellZ: number = 0;
    private playerWorldX: number = 0;
    private playerWorldZ: number = 0;
    private lastUpdate: number = 0;
    
    // Pending operations
    private loadQueue: GridCell[] = [];
    private unloadSchedule: Map<string, number> = new Map();  // cell key -> scheduled time
    
    // Statistics
    private loadTimes: number[] = [];
    private transitionCallbacks: Array<(transition: LODTransition) => void> = [];
    private stateChangeCallbacks: Array<(cell: GridCell, oldState: CellState, newState: CellState) => void> = [];

    constructor(config: Partial<RegionConfig> = {}) {
        this.config = { ...DEFAULT_REGION_CONFIG, ...config };
    }

    // ========================================================================
    // PUBLIC API - PLAYER TRACKING
    // ========================================================================

    /**
     * Update player position and trigger cell loading/unloading.
     * Call this each frame with current player position.
     */
    updatePlayerPosition(worldX: number, worldZ: number): void {
        this.playerWorldX = worldX;
        this.playerWorldZ = worldZ;
        
        const newCell = worldToCell(worldX, worldZ, this.config.cellSize);
        
        // Only update if cell changed
        if (newCell.x !== this.playerCellX || newCell.z !== this.playerCellZ) {
            this.playerCellX = newCell.x;
            this.playerCellZ = newCell.z;
            this.handleCellChange();
        }

        // Update LOD levels based on new distance
        this.updateLODLevels();

        // Process scheduled unloads
        this.processScheduledUnloads();

        this.lastUpdate = performance.now();
    }

    /**
     * Get current player cell coordinates.
     */
    getPlayerCell(): { x: number; z: number } {
        return { x: this.playerCellX, z: this.playerCellZ };
    }

    /**
     * Get current player world position.
     */
    getPlayerPosition(): { x: number; z: number } {
        return { x: this.playerWorldX, z: this.playerWorldZ };
    }

    // ========================================================================
    // PUBLIC API - CELL MANAGEMENT
    // ========================================================================

    /**
     * Register a cell with associated assets.
     * Creates cell if it doesn't exist.
     */
    registerCell(
        cellX: number,
        cellZ: number,
        assetIds: string[] = []
    ): GridCell {
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
                lodLevel: 3,  // Start at lowest LOD
                lastAccessed: performance.now(),
                dependenciesLoaded: false
            };
            this.cells.set(key, cell);
        }

        // Merge asset IDs
        for (const id of assetIds) {
            if (!cell.assetIds.includes(id)) {
                cell.assetIds.push(id);
            }
        }

        return cell;
    }

    /**
     * Unregister a cell completely.
     * Forces unload if cell is loaded.
     */
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

    /**
     * Get a cell by coordinates.
     */
    getCell(cellX: number, cellZ: number): GridCell | undefined {
        return this.cells.get(getCellKey(cellX, cellZ));
    }

    /**
     * Get cell at world position.
     */
    getCellAtPosition(worldX: number, worldZ: number): GridCell | undefined {
        const cell = worldToCell(worldX, worldZ, this.config.cellSize);
        return this.getCell(cell.x, cell.z);
    }

    /**
     * Get all cells.
     */
    getAllCells(): GridCell[] {
        return Array.from(this.cells.values());
    }

    /**
     * Get cells by state.
     */
    getCellsByState(state: CellState): GridCell[] {
        // ⚡ OPTIMIZATION: Eliminate Array.from().filter() to prevent GC spikes
        _scratchCells.length = 0;
        for (const cell of this.cells.values()) {
            if (cell.state === state) {
                _scratchCells.push(cell);
            }
        }
        return _scratchCells;
    }

    // ========================================================================
    // PUBLIC API - REGION QUERIES
    // ========================================================================

    /**
     * Get cells that should be loaded around a position.
     */
    getCellsToLoad(centerX?: number, centerZ?: number, radius?: number): GridCell[] {
        const cx = centerX ?? this.playerCellX;
        const cz = centerZ ?? this.playerCellZ;
        const r = radius ?? this.config.loadRadius;

        const result: GridCell[] = [];
        
        // Spiral iteration for priority ordering
        const spiral = this.getSpiralCells(cx, cz, r);
        
        for (const { x, z } of spiral) {
            const cell = this.getCell(x, z);
            if (cell && (cell.state === CellState.UNLOADED || cell.state === CellState.QUEUED)) {
                result.push(cell);
            }
        }

        return result;
    }

    /**
     * Get cells that should be unloaded.
     */
    getCellsToUnload(centerX?: number, centerZ?: number, radius?: number): GridCell[] {
        const cx = centerX ?? this.playerCellX;
        const cz = centerZ ?? this.playerCellZ;
        const r = radius ?? this.config.unloadRadius;
        const rSq = r * r;

        const result: GridCell[] = [];
        
        for (const cell of this.cells.values()) {
            const dx = cell.x - cx;
            const dz = cell.z - cz;
            const distanceSq = dx * dx + dz * dz;
            
            if (distanceSq > rSq && cell.state === CellState.LOADED) {
                result.push(cell);
            }
        }

        return result;
    }

    /**
     * Get cells in a radius.
     */
    getCellsInRadius(centerX: number, centerZ: number, radius: number): string[] {
        const keys: string[] = [];
        
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (dx * dx + dz * dz <= radius * radius) {
                    keys.push(getCellKey(centerX + dx, centerZ + dz));
                }
            }
        }
        
        return keys;
    }

    /**
     * Get distant cells for memory pressure unloading.
     */
    getDistantCells(minRadius: number): GridCell[] {
        const result: GridCell[] = [];
        const minRadiusSq = minRadius * minRadius;
        
        for (const cell of this.cells.values()) {
            const dx = cell.x - this.playerCellX;
            const dz = cell.z - this.playerCellZ;
            const distanceSq = dx * dx + dz * dz;
            
            if (distanceSq >= minRadiusSq && cell.state === CellState.LOADED) {
                result.push(cell);
            }
        }

        // Sort by distance (farthest first)
        result.sort((a, b) => {
            const dxA = a.x - this.playerCellX;
            const dzA = a.z - this.playerCellZ;
            const da = dxA * dxA + dzA * dzA;

            const dxB = b.x - this.playerCellX;
            const dzB = b.z - this.playerCellZ;
            const db = dxB * dxB + dzB * dzB;

            return db - da;
        });

        return result;
    }

    /**
     * Get cells intersecting a world-space bounding box.
     */
    queryBoundingBox(minX: number, maxX: number, minZ: number, maxZ: number): GridCell[] {
        const minCell = worldToCell(minX, minZ, this.config.cellSize);
        const maxCell = worldToCell(maxX, maxZ, this.config.cellSize);
        
        const result: GridCell[] = [];
        
        for (let x = minCell.x; x <= maxCell.x; x++) {
            for (let z = minCell.z; z <= maxCell.z; z++) {
                const cell = this.getCell(x, z);
                if (cell) result.push(cell);
            }
        }

        return result;
    }

    /**
     * Get cells intersecting a world-space circle.
     */
    queryCircle(centerX: number, centerZ: number, radius: number): GridCell[] {
        const minCellX = Math.floor((centerX - radius) / this.config.cellSize);
        const maxCellX = Math.floor((centerX + radius) / this.config.cellSize);
        const minCellZ = Math.floor((centerZ - radius) / this.config.cellSize);
        const maxCellZ = Math.floor((centerZ + radius) / this.config.cellSize);
        
        const result: GridCell[] = [];
        const radiusSq = radius * radius;
        
        for (let x = minCellX; x <= maxCellX; x++) {
            for (let z = minCellZ; z <= maxCellZ; z++) {
                const bounds = cellToBounds(x, z, this.config.cellSize);
                const dx = Math.max(bounds.minX - centerX, 0, centerX - bounds.maxX);
                const dz = Math.max(bounds.minZ - centerZ, 0, centerZ - bounds.maxZ);
                
                if (dx * dx + dz * dz <= radiusSq) {
                    const cell = this.getCell(x, z);
                    if (cell) result.push(cell);
                }
            }
        }

        return result;
    }

    /**
     * Spatial query with asset aggregation.
     */
    queryDetailed(options: {
        centerX: number;
        centerZ: number;
        radius: number;
        onlyLoaded?: boolean;
    }): SpatialQueryResult {
        const cells = this.queryCircle(options.centerX, options.centerZ, options.radius);
        
        const filteredCells = options.onlyLoaded 
            ? cells.filter(c => c.state === CellState.LOADED)
            : cells;

        let totalAssets = 0;
        for (const cell of filteredCells) {
            totalAssets += cell.assetIds.length;
        }

        // Rough memory estimate (would be more precise with actual asset data)
        const estimatedMemory = totalAssets * 1024 * 1024;  // Assume 1MB per asset

        return {
            cells: filteredCells,
            totalAssets,
            estimatedMemory
        };
    }

    // ========================================================================
    // PUBLIC API - LOD MANAGEMENT
    // ========================================================================

    /**
     * Get appropriate LOD level for a cell based on distance.
     */
    getLODLevelForCell(cell: GridCell): number {
        const distanceSq = distanceToCellSq(
            this.playerWorldX,
            this.playerWorldZ,
            cell.x,
            cell.z,
            this.config.cellSize
        );

        for (let i = 0; i < this.config.lodRadii.length; i++) {
            if (distanceSq <= this.config.lodRadii[i] * this.config.lodRadii[i]) {
                return i;
            }
        }

        return this.config.lodRadii.length - 1;
    }

    /**
     * Force LOD level for a cell.
     */
    setCellLOD(cellX: number, cellZ: number, lodLevel: number): boolean {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return false;

        if (cell.lodLevel !== lodLevel) {
            const oldLOD = cell.lodLevel;
            cell.lodLevel = lodLevel;

            // Notify transition
            if (this.config.enableSeamlessTransitions) {
                this.notifyLODTransition(cell, oldLOD, lodLevel);
            }
        }

        return true;
    }

    /**
     * Register LOD transition callback.
     */
    onLODTransition(callback: (transition: LODTransition) => void): void {
        this.transitionCallbacks.push(callback);
    }

    /**
     * Register cell state change callback.
     */
    onStateChange(callback: (cell: GridCell, oldState: CellState, newState: CellState) => void): void {
        this.stateChangeCallbacks.push(callback);
    }

    // ========================================================================
    // PUBLIC API - CONFIGURATION
    // ========================================================================

    /**
     * Update configuration.
     */
    setConfig(config: Partial<RegionConfig>): void {
        this.config = { ...this.config, ...config };
        
        // Re-evaluate cells if radius changed
        if (config.loadRadius !== undefined || config.unloadRadius !== undefined) {
            this.handleCellChange();
        }
    }

    /**
     * Get current configuration.
     */
    getConfig(): RegionConfig {
        return { ...this.config };
    }

    /**
     * Get current statistics.
     */
    getStats(): RegionStats {
        const loadedCells = this.getCellsByState(CellState.LOADED);
        const loadingCells = this.getCellsByState(CellState.LOADING);
        const queuedCells = this.getCellsByState(CellState.QUEUED);
        const unloadingCells = this.getCellsByState(CellState.UNLOADING);

        // Calculate average load time
        const avgLoadTime = this.loadTimes.length > 0
            ? this.loadTimes.reduce((a, b) => a + b, 0) / this.loadTimes.length
            : 0;

        // Estimate memory
        let memoryEstimate = 0;
        for (const cell of loadedCells) {
            memoryEstimate += cell.assetIds.length * 1024 * 1024;  // 1MB per asset estimate
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

    // ========================================================================
    // PUBLIC API - LIFECYCLE
    // ========================================================================

    /**
     * Mark a cell as loaded.
     * Call when all assets for a cell are loaded.
     */
    markCellLoaded(cellX: number, cellZ: number, loadTimeMs?: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return;

        cell.loadTime = performance.now();
        cell.state = CellState.LOADED;
        cell.dependenciesLoaded = true;

        if (loadTimeMs !== undefined) {
            this.loadTimes.push(loadTimeMs);
            // Keep last 100 measurements
            if (this.loadTimes.length > 100) {
                this.loadTimes.shift();
            }
        }

        this.notifyStateChange(cell, CellState.LOADING, CellState.LOADED);
    }

    /**
     * Mark a cell for unloading with delay.
     */
    scheduleCellUnload(cellX: number, cellZ: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell || cell.state !== CellState.LOADED) return;

        cell.state = CellState.UNLOADING;
        this.unloadSchedule.set(cell.key, performance.now() + this.config.unloadDelayMs);
        
        this.notifyStateChange(cell, CellState.LOADED, CellState.UNLOADING);
    }

    /**
     * Immediately unload a cell.
     */
    forceUnloadCell(cellX: number, cellZ: number): void {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return;

        this.transitionCell(cell, CellState.UNLOADED);
    }

    /**
     * Clear all cells.
     */
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

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private handleCellChange(): void {
        // Queue cells to load
        const toLoad = this.getCellsToLoad();
        for (const cell of toLoad) {
            if (cell.state === CellState.UNLOADED) {
                this.queueCellForLoading(cell);
            }
        }

        // Schedule cells to unload
        const toUnload = this.getCellsToUnload();
        for (const cell of toUnload) {
            if (cell.state === CellState.LOADED) {
                this.scheduleCellUnload(cell.x, cell.z);
            }
        }
    }

    private queueCellForLoading(cell: GridCell): void {
        // Calculate priority based on distance
        const dx = cell.x - this.playerCellX;
        const dz = cell.z - this.playerCellZ;
        const distanceSq = dx * dx + dz * dz;

        cell.priority = distanceSq;
        
        cell.state = CellState.QUEUED;
        this.loadQueue.push(cell);
        
        // Sort by priority (closest first)
        this.loadQueue.sort((a, b) => a.priority - b.priority);
        
        this.notifyStateChange(cell, CellState.UNLOADED, CellState.QUEUED);
    }

    private updateLODLevels(): void {
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

    private processScheduledUnloads(): void {
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

    private transitionCell(cell: GridCell, newState: CellState): void {
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

    private notifyStateChange(cell: GridCell, oldState: CellState, newState: CellState): void {
        for (const callback of this.stateChangeCallbacks) {
            try {
                callback(cell, oldState, newState);
            } catch (e) {
                console.error('Error in state change callback:', e);
            }
        }
    }

    private notifyLODTransition(cell: GridCell, fromLOD: number, toLOD: number): void {
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

    /**
     * Generate cells in spiral order for priority loading.
     * Closest cells are returned first.
     */
    private getSpiralCells(centerX: number, centerZ: number, radius: number): Array<{ x: number; z: number }> {
        const result: Array<{ x: number; z: number }> = [];
        
        // Center cell first
        result.push({ x: centerX, z: centerZ });
        
        // Spiral outward
        for (let r = 1; r <= radius; r++) {
            // Top edge (left to right, excluding corners)
            for (let x = centerX - r + 1; x <= centerX + r - 1; x++) {
                result.push({ x, z: centerZ - r });
            }
            
            // Right edge (top to bottom, excluding corners)
            for (let z = centerZ - r + 1; z <= centerZ + r - 1; z++) {
                result.push({ x: centerX + r, z });
            }
            
            // Bottom edge (right to left, excluding corners)
            for (let x = centerX + r - 1; x >= centerX - r + 1; x--) {
                result.push({ x, z: centerZ + r });
            }
            
            // Left edge (bottom to top, excluding corners)
            for (let z = centerZ + r - 1; z >= centerZ - r + 1; z--) {
                result.push({ x: centerX - r, z });
            }
            
            // Corners (in clockwise order)
            result.push({ x: centerX - r, z: centerZ - r });  // Top-left
            result.push({ x: centerX + r, z: centerZ - r });  // Top-right
            result.push({ x: centerX + r, z: centerZ + r });  // Bottom-right
            result.push({ x: centerX - r, z: centerZ + r });  // Bottom-left
        }

        return result;
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Get cell bounds in world space.
     */
    getCellBounds(cellX: number, cellZ: number): CellBounds {
        return cellToBounds(cellX, cellZ, this.config.cellSize);
    }

    /**
     * Get cell with bounds.
     */
    getCellWithBounds(cellX: number, cellZ: number): CellWithBounds | undefined {
        const cell = this.getCell(cellX, cellZ);
        if (!cell) return undefined;

        return {
            ...cell,
            bounds: this.getCellBounds(cellX, cellZ)
        };
    }

    /**
     * Check if a world position is within a loaded cell.
     */
    isPositionLoaded(worldX: number, worldZ: number): boolean {
        const cell = this.getCellAtPosition(worldX, worldZ);
        return cell?.state === CellState.LOADED;
    }

    /**
     * Get the next cell that should be loaded.
     */
    getNextCellToLoad(): GridCell | undefined {
        return this.loadQueue.find(c => c.state === CellState.QUEUED);
    }

    /**
     * Get loading queue (cells waiting to load).
     */
    getLoadingQueue(): GridCell[] {
        // ⚡ OPTIMIZATION: Eliminate .filter() to prevent GC spikes
        _scratchCells.length = 0;
        for (let i = 0; i < this.loadQueue.length; i++) {
            if (this.loadQueue[i].state === CellState.QUEUED) {
                _scratchCells.push(this.loadQueue[i]);
            }
        }
        return _scratchCells;
    }

    /**
     * Get number of cells waiting to load.
     */
    getQueueLength(): number {
        // ⚡ OPTIMIZATION: Eliminate .filter() to prevent GC spikes
        let count = 0;
        for (let i = 0; i < this.loadQueue.length; i++) {
            if (this.loadQueue[i].state === CellState.QUEUED) {
                count++;
            }
        }
        return count;
    }
}

// ============================================================================
// CELL LOADER HELPER
// ============================================================================

/**
 * Helper class for loading cell assets with progress tracking.
 */
export class CellLoader {
    private loadingCells: Map<string, {
        cell: GridCell;
        loadedAssets: number;
        totalAssets: number;
        startTime: number;
    }> = new Map();

    /**
     * Start loading a cell.
     */
    startLoading(cell: GridCell): void {
        cell.state = CellState.LOADING;
        
        this.loadingCells.set(cell.key, {
            cell,
            loadedAssets: 0,
            totalAssets: cell.assetIds.length,
            startTime: performance.now()
        });
    }

    /**
     * Mark an asset as loaded.
     */
    markAssetLoaded(cellKey: string, assetId: string): void {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return;

        loading.loadedAssets++;
        loading.cell.lastAccessed = performance.now();
    }

    /**
     * Check if cell loading is complete.
     */
    isComplete(cellKey: string): boolean {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return false;

        return loading.loadedAssets >= loading.totalAssets;
    }

    /**
     * Get loading progress for a cell.
     */
    getProgress(cellKey: string): number {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return 0;

        return loading.loadedAssets / Math.max(1, loading.totalAssets);
    }

    /**
     * Finish loading a cell.
     */
    finishLoading(cellKey: string): number {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return 0;

        const loadTime = performance.now() - loading.startTime;
        this.loadingCells.delete(cellKey);
        
        return loadTime;
    }

    /**
     * Cancel loading for a cell.
     */
    cancelLoading(cellKey: string): void {
        this.loadingCells.delete(cellKey);
    }

    /**
     * Get all currently loading cells.
     */
    getLoadingCells(): GridCell[] {
        // ⚡ OPTIMIZATION: Eliminate Array.from().map() to prevent GC spikes
        _scratchCells.length = 0;
        for (const loadingInfo of this.loadingCells.values()) {
            _scratchCells.push(loadingInfo.cell);
        }
        return _scratchCells;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default RegionManager;
