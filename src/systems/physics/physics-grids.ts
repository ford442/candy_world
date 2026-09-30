/**
 * physics-grids.ts
 *
 * Spatial grids for the player's proximity checks, and the one function that
 * fills them from world state.
 *
 * A leaf on purpose: physics-core, physics-updates and physics-abilities all
 * read these grids, and while the instances lived in physics-core each of the
 * other two closed an import cycle through it (#1827 Part C.1). Import only
 * leaf data modules here, never anything else under systems/physics/.
 */

import {
    foliageTraps,
    foliageGeysers,
    foliagePortamentoPines,
    foliagePanningPads,
    animatedFoliage,
} from '../../world/state.ts';
import { DISCOVERY_MAP } from '../discovery-map.ts';

// --- Lightweight Physics Spatial Grid (⚡ OPTIMIZATION) ---
let _globalQueryId = 0;

export class PhysicsSpatialGrid {
    private cellSize: number;
    private cells: Map<number, any[]>;
    // ⚡ OPTIMIZATION: Reusable array to avoid GC spikes on findNearby
    private _queryResult: any[] = [];

    constructor(cellSize: number) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    private getHash(x: number, z: number): number {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        // Pack into a single numeric key (assuming coordinates don't exceed +/- 32767 chunks)
        // using 16 bits for x and 16 bits for z
        return ((cx & 0xffff) << 16) | (cz & 0xffff);
    }

    insert(obj: any): void {
        if (!obj || !obj.position) return;
        const hash = this.getHash(obj.position.x, obj.position.z);
        let cell = this.cells.get(hash);
        if (!cell) {
            cell = [];
            this.cells.set(hash, cell);
        }
        cell.push(obj);
    }

    clear(): void {
        this.cells.clear();
    }

    findNearby(x: number, z: number, radius: number): any[] {
        _globalQueryId++;
        this._queryResult.length = 0;

        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minZ = Math.floor((z - radius) / this.cellSize);
        const maxZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = ((cx & 0xffff) << 16) | (cz & 0xffff);
                const cell = this.cells.get(hash);
                if (cell) {
                    for (let i = 0; i < cell.length; i++) {
                        const obj = cell[i];
                        if (obj._gridStamp !== _globalQueryId) {
                            obj._gridStamp = _globalQueryId;
                            this._queryResult.push(obj);
                        }
                    }
                }
            }
        }
        return this._queryResult;
    }
}

// Global grids for different collision types
export const physicsFoliageGrid = new PhysicsSpatialGrid(30);
export const physicsDiscoveryGrid = new PhysicsSpatialGrid(30);
export const physicsTrapsGrid = new PhysicsSpatialGrid(30);
export const physicsGeysersGrid = new PhysicsSpatialGrid(30);
export const physicsPinesGrid = new PhysicsSpatialGrid(30);
export const physicsPanningPadsGrid = new PhysicsSpatialGrid(30);

/**
 * Populates physics grids from world state.
 * Called during initialization and when world regenerates.
 */
export function populatePhysicsGrids() {
    physicsFoliageGrid.clear();
    physicsDiscoveryGrid.clear();
    physicsTrapsGrid.clear();
    physicsGeysersGrid.clear();
    physicsPinesGrid.clear();
    physicsPanningPadsGrid.clear();

    for (let i = 0; i < animatedFoliage.length; i++) {
        const obj = animatedFoliage[i];
        if (obj.userData?.type && DISCOVERY_MAP[obj.userData.type]) {
            physicsDiscoveryGrid.insert(obj);
        }
        if (
            obj.userData?.type === 'retrigger_mushroom' ||
            obj.userData?.type === 'vibratoViolet' ||
            (obj.userData?.type === 'flower' && obj.userData?.animationType === 'batchedCymbal')
        ) {
            physicsFoliageGrid.insert(obj);
        }
    }
    for (let i = 0; i < foliageTraps.length; i++) {
        physicsTrapsGrid.insert(foliageTraps[i]);
    }
    for (let i = 0; i < foliageGeysers.length; i++) {
        physicsGeysersGrid.insert(foliageGeysers[i]);
    }
    for (let i = 0; i < foliagePortamentoPines.length; i++) {
        physicsPinesGrid.insert(foliagePortamentoPines[i]);
    }
    for (let i = 0; i < foliagePanningPads.length; i++) {
        physicsPanningPadsGrid.insert(foliagePanningPads[i]);
    }
}
