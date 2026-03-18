/**
 * Map Validation
 * Validates generated maps for correctness and performance
 */

import { PlacedEntity } from './poisson-disc-sampler.ts';
import { Path, PathPoint } from './path-generator.ts';
import { POI } from './interest-point-generator.ts';

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
    stats: ValidationStats;
}

export interface ValidationError {
    type: 'ground_collision' | 'overlap' | 'unreachable' | 'budget_exceeded' | 'out_of_bounds';
    message: string;
    entity?: string;
    position?: PathPoint;
}

export interface ValidationWarning {
    type: 'high_density' | 'low_connectivity' | 'performance_risk' | 'biome_imbalance';
    message: string;
    details?: any;
}

export interface ValidationStats {
    totalEntities: number;
    entityCounts: Record<string, number>;
    totalPaths: number;
    totalPOIs: number;
    bounds: {
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
    };
    estimatedMemoryMB: number;
}

export interface ValidatorOptions {
    groundLevel?: number;
    maxEntities?: number;
    bounds: {
        minX: number;
        minZ: number;
        maxX: number;
        maxZ: number;
    };
    maxColliderRadius?: number;
    elevationFn?: (x: number, z: number) => number;
    waterLevel?: number;
}

export class MapValidator {
    private options: ValidatorOptions;
    private errors: ValidationError[] = [];
    private warnings: ValidationWarning[] = [];

    constructor(options: ValidatorOptions) {
        this.options = {
            groundLevel: 0,
            maxEntities: 10000,
            maxColliderRadius: 5,
            ...options
        };
    }

    /**
     * Validate a complete map
     */
    validate(
        entities: PlacedEntity[],
        paths: Path[],
        pois: POI[]
    ): ValidationResult {
        this.errors = [];
        this.warnings = [];

        // Run all validation checks
        this.validateGroundCollision(entities);
        this.validateOverlappingColliders(entities);
        this.validateBounds(entities, paths, pois);
        this.validatePerformanceBudget(entities, paths);
        this.validatePOIAccessibility(pois);
        this.validatePathConnectivity(paths, pois);

        const stats = this.calculateStats(entities, paths, pois);

        return {
            isValid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings,
            stats
        };
    }

    /**
     * Validate no entities are below ground
     */
    private validateGroundCollision(entities: PlacedEntity[]): void {
        const groundLevel = this.options.groundLevel ?? 0;
        const elevationFn = this.options.elevationFn;
        const waterLevel = this.options.waterLevel ?? -2;

        for (const entity of entities) {
            // Get actual ground elevation if function provided
            const actualGround = elevationFn ? elevationFn(entity.x, entity.z) : groundLevel;
            
            // Allow some entities to be slightly below ground (e.g., partially buried)
            // For lake biomes, allow entities to be below water level
            const tolerance = entity.type === 'mushroom' ? 0.5 : 
                             (actualGround < waterLevel ? 2.0 : 0.5);
            
            // Check if entity is below the actual terrain (with tolerance)
            if (entity.y < actualGround - tolerance) {
                this.errors.push({
                    type: 'ground_collision',
                    message: `Entity '${entity.type}' at (${entity.x.toFixed(2)}, ${entity.y.toFixed(2)}, ${entity.z.toFixed(2)}) is below ground level ${actualGround.toFixed(2)}`,
                    entity: entity.type,
                    position: { x: entity.x, y: entity.y, z: entity.z }
                });
            }
        }
    }

    /**
     * Validate no colliders overlap
     */
    private validateOverlappingColliders(entities: PlacedEntity[]): void {
        // Build spatial hash for efficient collision detection
        const cellSize = this.options.maxColliderRadius! * 2;
        const grid = new Map<string, PlacedEntity[]>();

        const getCellKey = (x: number, z: number) => {
            const cellX = Math.floor(x / cellSize);
            const cellZ = Math.floor(z / cellSize);
            return `${cellX},${cellZ}`;
        };

        // Populate grid
        for (const entity of entities) {
            const key = getCellKey(entity.x, entity.z);
            if (!grid.has(key)) {
                grid.set(key, []);
            }
            grid.get(key)!.push(entity);
        }

        // Check for overlaps
        const checked = new Set<string>();

        for (const entity of entities) {
            const cellX = Math.floor(entity.x / cellSize);
            const cellZ = Math.floor(entity.z / cellSize);

            // Check neighboring cells
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${cellX + dx},${cellZ + dz}`;
                    const cellEntities = grid.get(key);

                    if (cellEntities) {
                        for (const other of cellEntities) {
                            if (entity === other) continue;

                            const pairKey = [entity.type + entity.x, other.type + other.x].sort().join('-');
                            if (checked.has(pairKey)) continue;
                            checked.add(pairKey);

                            const dx_pos = entity.x - other.x;
                            const dz_pos = entity.z - other.z;
                            const dy_pos = entity.y - other.y;
                            const distance = Math.sqrt(dx_pos * dx_pos + dz_pos * dz_pos);
                            
                            // Skip if entities are at very different heights (vertical separation)
                            // This handles clouds vs ground entities, etc.
                            if (Math.abs(dy_pos) > 5) {
                                continue;
                            }

                            // Calculate minimum distance based on entity scales
                            const minDistance = this.getColliderRadius(entity) + this.getColliderRadius(other);

                            // Skip overlap check for grass and small ground cover
                            // These are meant to be under/around larger plants
                            if (entity.type === 'grass' || other.type === 'grass') {
                                continue;
                            }

                            if (distance < minDistance * 0.5) { // Only flag severe overlap
                                this.errors.push({
                                    type: 'overlap',
                                    message: `Entities '${entity.type}' and '${other.type}' severely overlap at distance ${distance.toFixed(2)} (min: ${minDistance.toFixed(2)})`,
                                    position: { x: entity.x, y: entity.y, z: entity.z }
                                });
                            } else if (distance < minDistance * 0.8) { // Warn about moderate overlap
                                this.warnings.push({
                                    type: 'performance_risk',
                                    message: `Entities '${entity.type}' and '${other.type}' have minor overlap at distance ${distance.toFixed(2)} (min: ${minDistance.toFixed(2)})`
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * Get collider radius for an entity type
     */
    private getColliderRadius(entity: PlacedEntity): number {
        // Approximate collider sizes based on entity type
        const colliderSizes: Record<string, number> = {
            grass: 0.3,
            flower: 0.5,
            mushroom: 0.8,
            starflower: 0.6,
            tremolo_tulip: 0.5,
            vibrato_violet: 0.4,
            balloon_bush: 1.5,
            portamento_pine: 2.0,
            bubble_willow: 2.5,
            fiber_optic_willow: 2.0,
            arpeggio_fern: 1.0,
            prism_rose_bush: 1.5,
            wisteria_cluster: 1.8,
            helix_plant: 0.8,
            snare_trap: 1.0,
            subwoofer_lotus: 1.5,
            accordion_palm: 2.0,
            cymbal_dandelion: 1.0,
            kick_drum_geyser: 1.5,
            floating_orb: 0.5,
            cloud: 3.0
        };

        const baseRadius = colliderSizes[entity.type] ?? 1.0;
        return baseRadius * entity.scale;
    }

    /**
     * Validate all elements are within bounds
     */
    private validateBounds(
        entities: PlacedEntity[],
        paths: Path[],
        pois: POI[]
    ): void {
        const bounds = this.options.bounds;
        const margin = 10; // Allow some margin outside bounds

        // Check entities
        for (const entity of entities) {
            if (entity.x < bounds.minX - margin || entity.x > bounds.maxX + margin ||
                entity.z < bounds.minZ - margin || entity.z > bounds.maxZ + margin) {
                this.errors.push({
                    type: 'out_of_bounds',
                    message: `Entity '${entity.type}' at (${entity.x.toFixed(2)}, ${entity.z.toFixed(2)}) is outside map bounds`,
                    entity: entity.type,
                    position: { x: entity.x, y: entity.y, z: entity.z }
                });
            }
        }

        // Check POIs
        for (const poi of pois) {
            if (poi.position.x < bounds.minX || poi.position.x > bounds.maxX ||
                poi.position.z < bounds.minZ || poi.position.z > bounds.maxZ) {
                this.errors.push({
                    type: 'out_of_bounds',
                    message: `POI '${poi.name}' is outside map bounds`,
                    position: poi.position
                });
            }
        }
    }

    /**
     * Validate performance budget
     */
    private validatePerformanceBudget(entities: PlacedEntity[], paths: Path[]): void {
        const maxEntities = this.options.maxEntities ?? 10000;

        if (entities.length > maxEntities) {
            this.errors.push({
                type: 'budget_exceeded',
                message: `Entity count (${entities.length}) exceeds maximum (${maxEntities})`
            });
        }

        // Warn about high entity counts
        if (entities.length > maxEntities * 0.8) {
            this.warnings.push({
                type: 'performance_risk',
                message: `Entity count (${entities.length}) is approaching limit (${maxEntities})`,
                details: { count: entities.length, limit: maxEntities }
            });
        }

        // Warn about high density areas
        const densityGrid = this.calculateDensityGrid(entities);
        const highDensityCells = densityGrid.filter(d => d.count > 20);
        
        if (highDensityCells.length > 0) {
            this.warnings.push({
                type: 'high_density',
                message: `Found ${highDensityCells.length} high-density areas with >20 entities per 10x10 cell`,
                details: highDensityCells
            });
        }
    }

    /**
     * Calculate density grid for analysis
     */
    private calculateDensityGrid(entities: PlacedEntity[]): Array<{ x: number; z: number; count: number }> {
        const cellSize = 10;
        const grid = new Map<string, number>();

        for (const entity of entities) {
            const cellX = Math.floor(entity.x / cellSize);
            const cellZ = Math.floor(entity.z / cellSize);
            const key = `${cellX},${cellZ}`;
            grid.set(key, (grid.get(key) || 0) + 1);
        }

        return Array.from(grid.entries()).map(([key, count]) => {
            const [cellX, cellZ] = key.split(',').map(Number);
            return { x: cellX * cellSize, z: cellZ * cellSize, count };
        });
    }

    /**
     * Validate POI accessibility
     */
    private validatePOIAccessibility(pois: POI[]): void {
        const spawn = pois.find(p => p.type === 'spawn_point');
        if (!spawn) {
            this.errors.push({
                type: 'unreachable',
                message: 'No spawn point found in POIs'
            });
            return;
        }

        // BFS to find all reachable POIs
        const visited = new Set<string>();
        const queue: string[] = [spawn.id];
        visited.add(spawn.id);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const current = pois.find(p => p.id === currentId);

            if (current) {
                for (const connectionId of current.connections) {
                    if (!visited.has(connectionId)) {
                        visited.add(connectionId);
                        queue.push(connectionId);
                    }
                }
            }
        }

        // Check for unreachable POIs
        for (const poi of pois) {
            if (!visited.has(poi.id)) {
                this.errors.push({
                    type: 'unreachable',
                    message: `POI '${poi.name}' (${poi.type}) is not reachable from spawn`,
                    position: poi.position
                });
            }
        }

        // Warn about POIs with low connectivity
        const lowConnectivityPOIs = pois.filter(p => p.connections.length < 1 && p.type !== 'spawn_point');
        if (lowConnectivityPOIs.length > 0) {
            this.warnings.push({
                type: 'low_connectivity',
                message: `${lowConnectivityPOIs.length} POIs have no connections`,
                details: lowConnectivityPOIs.map(p => p.name)
            });
        }
    }

    /**
     * Validate path connectivity
     */
    private validatePathConnectivity(paths: Path[], pois: POI[]): void {
        // Check that paths connect POIs
        const connectedPOIs = new Set<string>();

        for (const path of paths) {
            if (path.startPOI) connectedPOIs.add(path.startPOI);
            if (path.endPOI) connectedPOIs.add(path.endPOI);
        }

        // Warn about unconnected POIs
        const unconnectedPOIs = pois.filter(p => !connectedPOIs.has(p.id) && p.type !== 'spawn_point');
        if (unconnectedPOIs.length > 3) { // Allow a few decorative POIs
            this.warnings.push({
                type: 'low_connectivity',
                message: `${unconnectedPOIs.length} POIs are not connected by paths`,
                details: unconnectedPOIs.map(p => p.name)
            });
        }

        // Check for paths with too few points
        const shortPaths = paths.filter(p => p.points.length < 3);
        if (shortPaths.length > 0) {
            this.warnings.push({
                type: 'performance_risk',
                message: `${shortPaths.length} paths have fewer than 3 points`,
                details: shortPaths.map(p => `${p.type}: ${p.points.length} points`)
            });
        }
    }

    /**
     * Calculate validation statistics
     */
    private calculateStats(
        entities: PlacedEntity[],
        paths: Path[],
        pois: POI[]
    ): ValidationStats {
        // Count entities by type
        const entityCounts: Record<string, number> = {};
        for (const entity of entities) {
            entityCounts[entity.type] = (entityCounts[entity.type] || 0) + 1;
        }

        // Calculate bounds
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;

        for (const entity of entities) {
            minX = Math.min(minX, entity.x);
            maxX = Math.max(maxX, entity.x);
            minZ = Math.min(minZ, entity.z);
            maxZ = Math.max(maxZ, entity.z);
        }

        // Estimate memory usage (rough approximation)
        // Each entity: ~200 bytes for base data + variable for strings
        const estimatedMemoryMB = (entities.length * 200 + paths.length * 1000) / (1024 * 1024);

        return {
            totalEntities: entities.length,
            entityCounts,
            totalPaths: paths.length,
            totalPOIs: pois.length,
            bounds: { minX, maxX, minZ, maxZ },
            estimatedMemoryMB: Math.round(estimatedMemoryMB * 100) / 100
        };
    }

    /**
     * Quick validation for a single entity
     */
    validateEntity(entity: PlacedEntity): { valid: boolean; error?: string } {
        const groundLevel = this.options.groundLevel ?? 0;
        const bounds = this.options.bounds;

        if (entity.y < groundLevel - 0.5) {
            return { valid: false, error: 'Entity below ground' };
        }

        if (entity.x < bounds.minX || entity.x > bounds.maxX ||
            entity.z < bounds.minZ || entity.z > bounds.maxZ) {
            return { valid: false, error: 'Entity out of bounds' };
        }

        return { valid: true };
    }
}

export default MapValidator;
