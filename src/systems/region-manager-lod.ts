/**
 * @file region-manager-lod.ts
 * @description LOD transitions and spatial queries for RegionManager
 */

import { GridCell, CellState, SpatialQueryResult, RegionManager } from './region-manager-core.ts';
import { distanceToCellSq, cellToBounds, getCellKey } from './region-manager-core.ts';
import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { updateFoliageBatcherLOD } from './batcher-lod.ts';

const _scratchCells: GridCell[] = [];

/** Generate cells in spiral order for priority loading */
export function getSpiralCells(centerX: number, centerZ: number, radius: number): Array<{ x: number; z: number }> {
    const result: Array<{ x: number; z: number }> = [];
    result.push({ x: centerX, z: centerZ });
    for (let r = 1; r <= radius; r++) {
        for (let x = centerX - r + 1; x <= centerX + r - 1; x++) result.push({ x, z: centerZ - r });
        for (let z = centerZ - r + 1; z <= centerZ + r - 1; z++) result.push({ x: centerX + r, z });
        for (let x = centerX + r - 1; x >= centerX - r + 1; x--) result.push({ x, z: centerZ + r });
        for (let z = centerZ + r - 1; z >= centerZ - r + 1; z--) result.push({ x: centerX - r, z });
        result.push({ x: centerX - r, z: centerZ - r });
        result.push({ x: centerX + r, z: centerZ - r });
        result.push({ x: centerX + r, z: centerZ + r });
        result.push({ x: centerX - r, z: centerZ + r });
    }
    return result;
}

export function getCellsToLoad(
    manager: RegionManager,
    centerX?: number,
    centerZ?: number,
    radius?: number
): GridCell[] {
    const cx = centerX ?? manager.playerCellX;
    const cz = centerZ ?? manager.playerCellZ;
    const r = radius ?? manager.config.loadRadius;

    const result: GridCell[] = [];
    const spiral = getSpiralCells(cx, cz, r);

    for (const { x, z } of spiral) {
        const cell = manager.getCell(x, z);
        if (cell && (cell.state === CellState.UNLOADED || cell.state === CellState.QUEUED)) {
            result.push(cell);
        }
    }
    return result;
}

export function getCellsToUnload(
    manager: RegionManager,
    centerX?: number,
    centerZ?: number,
    radius?: number
): GridCell[] {
    const cx = centerX ?? manager.playerCellX;
    const cz = centerZ ?? manager.playerCellZ;
    const r = radius ?? manager.config.unloadRadius;
    const rSq = r * r;

    const result: GridCell[] = [];
    for (const cell of manager.cells.values()) {
        const dx = cell.x - cx;
        const dz = cell.z - cz;
        if (dx * dx + dz * dz > rSq && cell.state === CellState.LOADED) {
            result.push(cell);
        }
    }
    return result;
}

export function getCellsInRadius(centerX: number, centerZ: number, radius: number): string[] {
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

export function getDistantCells(manager: RegionManager, minRadius: number): GridCell[] {
    const result: GridCell[] = [];
    const minRadiusSq = minRadius * minRadius;

    for (const cell of manager.cells.values()) {
        const dx = cell.x - manager.playerCellX;
        const dz = cell.z - manager.playerCellZ;
        if (dx * dx + dz * dz >= minRadiusSq && cell.state === CellState.LOADED) {
            result.push(cell);
        }
    }

    result.sort((a, b) => {
        const dxA = a.x - manager.playerCellX;
        const dzA = a.z - manager.playerCellZ;
        const dxB = b.x - manager.playerCellX;
        const dzB = b.z - manager.playerCellZ;
        return (dxB * dxB + dzB * dzB) - (dxA * dxA + dzA * dzA);
    });

    return result;
}

export function queryBoundingBox(manager: RegionManager, minX: number, maxX: number, minZ: number, maxZ: number): GridCell[] {
    const minCellX = Math.floor(minX / manager.config.cellSize);
    const minCellZ = Math.floor(minZ / manager.config.cellSize);
    const maxCellX = Math.floor(maxX / manager.config.cellSize);
    const maxCellZ = Math.floor(maxZ / manager.config.cellSize);

    const result: GridCell[] = [];
    for (let x = minCellX; x <= maxCellX; x++) {
        for (let z = minCellZ; z <= maxCellZ; z++) {
            const cell = manager.getCell(x, z);
            if (cell) result.push(cell);
        }
    }
    return result;
}

export function queryCircle(manager: RegionManager, centerX: number, centerZ: number, radius: number): GridCell[] {
    const minCellX = Math.floor((centerX - radius) / manager.config.cellSize);
    const maxCellX = Math.floor((centerX + radius) / manager.config.cellSize);
    const minCellZ = Math.floor((centerZ - radius) / manager.config.cellSize);
    const maxCellZ = Math.floor((centerZ + radius) / manager.config.cellSize);

    const result: GridCell[] = [];
    const radiusSq = radius * radius;

    for (let x = minCellX; x <= maxCellX; x++) {
        for (let z = minCellZ; z <= maxCellZ; z++) {
            const bounds = cellToBounds(x, z, manager.config.cellSize);
            const dx = Math.max(bounds.minX - centerX, 0, centerX - bounds.maxX);
            const dz = Math.max(bounds.minZ - centerZ, 0, centerZ - bounds.maxZ);

            if (dx * dx + dz * dz <= radiusSq) {
                const cell = manager.getCell(x, z);
                if (cell) result.push(cell);
            }
        }
    }
    return result;
}

export function queryDetailed(
    manager: RegionManager,
    options: { centerX: number; centerZ: number; radius: number; onlyLoaded?: boolean }
): SpatialQueryResult {
    const minCellX = Math.floor((options.centerX - options.radius) / manager.config.cellSize);
    const maxCellX = Math.floor((options.centerX + options.radius) / manager.config.cellSize);
    const minCellZ = Math.floor((options.centerZ - options.radius) / manager.config.cellSize);
    const maxCellZ = Math.floor((options.centerZ + options.radius) / manager.config.cellSize);

    _scratchCells.length = 0;
    const radiusSq = options.radius * options.radius;

    for (let x = minCellX; x <= maxCellX; x++) {
        for (let z = minCellZ; z <= maxCellZ; z++) {
            const bounds = cellToBounds(x, z, manager.config.cellSize);
            const dx = Math.max(bounds.minX - options.centerX, 0, options.centerX - bounds.maxX);
            const dz = Math.max(bounds.minZ - options.centerZ, 0, options.centerZ - bounds.maxZ);

            if (dx * dx + dz * dz <= radiusSq) {
                const cell = manager.getCell(x, z);
                if (cell && (!options.onlyLoaded || cell.state === CellState.LOADED)) {
                    _scratchCells.push(cell);
                }
            }
        }
    }

    let totalAssets = 0;
    for (const cell of _scratchCells) {
        totalAssets += cell.assetIds.length;
    }

    return {
        cells: _scratchCells.slice(),
        totalAssets,
        estimatedMemory: totalAssets * 1024 * 1024
    };
}

export function getLODLevelForCell(manager: RegionManager, cell: GridCell): number {
    const distanceSq = distanceToCellSq(
        manager.playerWorldX,
        manager.playerWorldZ,
        cell.x,
        cell.z,
        manager.config.cellSize
    );

    const radii = getFoliageLodRadiiForRegion();

    for (let i = 0; i < radii.length; i++) {
        if (distanceSq <= radii[i] * radii[i]) {
            return i;
        }
    }

    return radii.length - 1;
}

/** Align region streaming LOD radii with CONFIG.foliage.lod batcher thresholds */
export function getFoliageLodRadiiForRegion(): number[] {
    const lod = CONFIG.foliage?.lod;
    if (!lod) return [120, 365, 480, 640];
    return [
        lod.heroMax ?? 120,
        lod.midMax ?? 365,
        lod.farCull ?? 480,
        (lod.farCull ?? 480) + 160
    ];
}

export function syncRegionLodConfig(manager: RegionManager): void {
    manager.config.lodRadii = getFoliageLodRadiiForRegion();
}

export function updateRegionFoliageLod(
    manager: RegionManager,
    camera: THREE.Camera,
    delta: number
): void {
    manager.playerWorldX = camera.position.x;
    manager.playerWorldZ = camera.position.z;
    updateFoliageBatcherLOD(camera, delta);
}

export class CellLoader {
    private loadingCells: Map<string, {
        cell: GridCell;
        loadedAssets: number;
        totalAssets: number;
        startTime: number;
    }> = new Map();

    startLoading(cell: GridCell): void {
        cell.state = CellState.LOADING;
        this.loadingCells.set(cell.key, {
            cell,
            loadedAssets: 0,
            totalAssets: cell.assetIds.length,
            startTime: performance.now()
        });
    }

    markAssetLoaded(cellKey: string, assetId: string): void {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return;
        loading.loadedAssets++;
        loading.cell.lastAccessed = performance.now();
    }

    isComplete(cellKey: string): boolean {
        const loading = this.loadingCells.get(cellKey);
        return loading ? loading.loadedAssets >= loading.totalAssets : false;
    }

    getProgress(cellKey: string): number {
        const loading = this.loadingCells.get(cellKey);
        return loading ? loading.loadedAssets / Math.max(1, loading.totalAssets) : 0;
    }

    finishLoading(cellKey: string): number {
        const loading = this.loadingCells.get(cellKey);
        if (!loading) return 0;
        const loadTime = performance.now() - loading.startTime;
        this.loadingCells.delete(cellKey);
        return loadTime;
    }

    cancelLoading(cellKey: string): void {
        this.loadingCells.delete(cellKey);
    }

    getLoadingCells(): GridCell[] {
        _scratchCells.length = 0;
        for (const loadingInfo of this.loadingCells.values()) {
            _scratchCells.push(loadingInfo.cell);
        }
        return _scratchCells;
    }
}
