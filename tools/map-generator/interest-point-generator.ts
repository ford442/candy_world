/**
 * Interest Point Generator (POI)
 * Places musical shrines, puzzle locations, and scenic viewpoints
 */

import { NoiseGenerator } from './biome-generator.ts';
import { PathPoint } from './path-generator.ts';

export type POIType = 'musical_shrine' | 'puzzle_location' | 'scenic_viewpoint' | 'spawn_point' | 'landmark';

export interface POI {
    id: string;
    type: POIType;
    name: string;
    position: PathPoint;
    radius: number;
    importance: number; // 1-10, affects path connection priority
    biome: string;
    connections: string[]; // IDs of connected POIs
    metadata: Record<string, any>;
}

export interface POIGeneratorOptions {
    seed: number;
    bounds: {
        minX: number;
        minZ: number;
        maxX: number;
        maxZ: number;
    };
    elevationFn: (x: number, z: number) => number;
    biomeFn: (x: number, z: number) => string;
    waterLevel?: number;
    poiCount?: number;
    minDistance?: number;
}

export interface POIPlacementRules {
    type: POIType;
    minElevation: number;
    maxElevation: number;
    preferredBiomes: string[];
    avoidBiomes: string[];
    minDistanceFromOthers: number;
    maxCount: number;
    importanceRange: [number, number];
}

export class POIGenerator {
    private noise: NoiseGenerator;
    private bounds: POIGeneratorOptions['bounds'];
    private elevationFn: (x: number, z: number) => number;
    private biomeFn: (x: number, z: number) => string;
    private waterLevel: number;
    private poiCount: number;
    private minDistance: number;
    private placedPOIs: POI[] = [];

    private placementRules: POIPlacementRules[] = [
        {
            type: 'spawn_point',
            minElevation: 0,
            maxElevation: 10,
            preferredBiomes: ['meadow', 'forest'],
            avoidBiomes: ['lake', 'cave', 'neonCorruption'],
            minDistanceFromOthers: 0,
            maxCount: 1,
            importanceRange: [10, 10]
        },
        {
            type: 'musical_shrine',
            minElevation: 2,
            maxElevation: 20,
            preferredBiomes: ['meadow', 'forest', 'mountain'],
            avoidBiomes: ['lake', 'neonCorruption'],
            minDistanceFromOthers: 30,
            maxCount: 5,
            importanceRange: [8, 10]
        },
        {
            type: 'puzzle_location',
            minElevation: 0,
            maxElevation: 25,
            preferredBiomes: ['forest', 'cave', 'mountain', 'neonCorruption'],
            avoidBiomes: ['lake'],
            minDistanceFromOthers: 25,
            maxCount: 8,
            importanceRange: [5, 8]
        },
        {
            type: 'scenic_viewpoint',
            minElevation: 10,
            maxElevation: 30,
            preferredBiomes: ['mountain', 'meadow', 'forest'],
            avoidBiomes: ['cave', 'lake'],
            minDistanceFromOthers: 40,
            maxCount: 6,
            importanceRange: [4, 7]
        },
        {
            type: 'landmark',
            minElevation: -5,
            maxElevation: 25,
            preferredBiomes: ['meadow', 'forest', 'lake', 'mountain'],
            avoidBiomes: [],
            minDistanceFromOthers: 50,
            maxCount: 4,
            importanceRange: [6, 9]
        }
    ];

    constructor(options: POIGeneratorOptions) {
        this.noise = new NoiseGenerator(options.seed);
        this.bounds = options.bounds;
        this.elevationFn = options.elevationFn;
        this.biomeFn = options.biomeFn;
        this.waterLevel = options.waterLevel ?? -1;
        this.poiCount = options.poiCount ?? 15;
        this.minDistance = options.minDistance ?? 20;
    }

    /**
     * Generate a unique ID for a POI
     */
    private generateId(type: string, index: number): string {
        return `${type}_${index}_${Math.random().toString(36).substr(2, 5)}`;
    }

    /**
     * Check if a position is valid for POI placement
     */
    private isValidPosition(x: number, z: number, rule: POIPlacementRules): boolean {
        const elevation = this.elevationFn(x, z);
        const biome = this.biomeFn(x, z);

        // Check elevation range
        if (elevation < rule.minElevation || elevation > rule.maxElevation) {
            return false;
        }

        // Check biome constraints
        if (rule.avoidBiomes.includes(biome)) {
            return false;
        }
        if (rule.preferredBiomes.length > 0 && !rule.preferredBiomes.includes(biome)) {
            return false;
        }

        // Check distance from other POIs
        for (const poi of this.placedPOIs) {
            const dist = Math.sqrt(Math.pow(poi.position.x - x, 2) + Math.pow(poi.position.z - z, 2));
            if (dist < Math.max(rule.minDistanceFromOthers, this.minDistance)) {
                return false;
            }
        }

        // Additional checks for specific POI types
        if (rule.type === 'scenic_viewpoint') {
            // Viewpoints need elevated positions with good visibility
            const slope = this.calculateSlope(x, z);
            if (slope < 0.1) return false; // Needs some elevation change
        }

        if (rule.type === 'musical_shrine') {
            // Shrines prefer flat areas
            const slope = this.calculateSlope(x, z);
            if (slope > 0.3) return false;
        }

        return true;
    }

    /**
     * Calculate slope at a position
     */
    private calculateSlope(x: number, z: number): number {
        const delta = 2;
        const e = this.elevationFn(x, z);
        const ex = this.elevationFn(x + delta, z);
        const ez = this.elevationFn(x, z + delta);
        
        const slopeX = Math.abs(ex - e) / delta;
        const slopeZ = Math.abs(ez - e) / delta;
        
        return Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
    }

    /**
     * Find valid POI placement candidates
     */
    private findCandidates(rule: POIPlacementRules, count: number): Array<{ x: number; z: number; score: number }> {
        const candidates: Array<{ x: number; z: number; score: number }> = [];
        const attempts = count * 50; // Try many times to find good spots

        for (let i = 0; i < attempts; i++) {
            const x = this.bounds.minX + Math.random() * (this.bounds.maxX - this.bounds.minX);
            const z = this.bounds.minZ + Math.random() * (this.bounds.maxZ - this.bounds.minZ);

            if (this.isValidPosition(x, z, rule)) {
                const score = this.scorePosition(x, z, rule);
                candidates.push({ x, z, score });
            }
        }

        // Sort by score and return top candidates
        return candidates.sort((a, b) => b.score - a.score).slice(0, count);
    }

    /**
     * Score a position for POI placement
     */
    private scorePosition(x: number, z: number, rule: POIPlacementRules): number {
        let score = 0;
        const elevation = this.elevationFn(x, z);
        const biome = this.biomeFn(x, z);

        // Prefer preferred biomes
        if (rule.preferredBiomes.includes(biome)) {
            score += 10;
        }

        // Scenic viewpoints prefer higher elevations
        if (rule.type === 'scenic_viewpoint') {
            score += (elevation / 30) * 10;
        }

        // Puzzle locations prefer interesting terrain
        if (rule.type === 'puzzle_location') {
            const slope = this.calculateSlope(x, z);
            score += slope * 5;
        }

        // Add some noise for variety
        score += this.noise.noise2D(x * 0.01, z * 0.01) * 3;

        return score;
    }

    /**
     * Generate all POIs for the map
     */
    generate(): POI[] {
        this.placedPOIs = [];

        // Always place spawn point first
        const spawnRule = this.placementRules.find(r => r.type === 'spawn_point')!;
        const spawnCandidates = this.findCandidates(spawnRule, 10);
        
        if (spawnCandidates.length > 0) {
            const best = spawnCandidates[0];
            this.placedPOIs.push({
                id: 'spawn_point_main',
                type: 'spawn_point',
                name: 'Player Spawn',
                position: {
                    x: best.x,
                    y: this.elevationFn(best.x, best.z),
                    z: best.z
                },
                radius: 5,
                importance: 10,
                biome: this.biomeFn(best.x, best.z),
                connections: [],
                metadata: { isMainSpawn: true }
            });
        }

        // Place other POI types
        const remainingRules = this.placementRules.filter(r => r.type !== 'spawn_point');
        const poiPerType = Math.ceil((this.poiCount - 1) / remainingRules.length);

        for (const rule of remainingRules) {
            const count = Math.min(rule.maxCount, poiPerType);
            const candidates = this.findCandidates(rule, count);

            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                const importance = rule.importanceRange[0] + 
                    Math.random() * (rule.importanceRange[1] - rule.importanceRange[0]);

                this.placedPOIs.push({
                    id: this.generateId(rule.type, i),
                    type: rule.type,
                    name: this.generatePOIName(rule.type, i),
                    position: {
                        x: candidate.x,
                        y: this.elevationFn(candidate.x, candidate.z),
                        z: candidate.z
                    },
                    radius: this.getPOIRadius(rule.type),
                    importance: Math.round(importance),
                    biome: this.biomeFn(candidate.x, candidate.z),
                    connections: [],
                    metadata: this.generateMetadata(rule.type, candidate.x, candidate.z)
                });
            }
        }

        // Connect POIs based on importance and proximity
        this.connectPOIs();

        return this.placedPOIs;
    }

    /**
     * Generate a name for a POI
     */
    private generatePOIName(type: POIType, index: number): string {
        const names: Record<POIType, string[]> = {
            spawn_point: ['Home Base', 'Starting Point', 'Journey\'s Beginning'],
            musical_shrine: [
                'Harmony Shrine', 'Melody Temple', 'Rhythm Sanctuary',
                'Echo Chamber', 'Resonance Hall', 'Symphony Spire'
            ],
            puzzle_location: [
                'Riddle Grove', 'Enigma Clearing', 'Mystery Hollow',
                'Secret Garden', 'Whispering Stones', 'Crystal Maze'
            ],
            scenic_viewpoint: [
                'Panorama Peak', 'Vista Point', 'Horizon Lookout',
                'Eagle\'s Perch', 'Sunset Ridge', 'Cloud Observatory'
            ],
            landmark: [
                'Ancient Monolith', 'Crystal Formation', 'Giant Mushroom',
                'Falling Star Site', 'Rainbow Arch', 'Echo Falls'
            ]
        };

        const typeNames = names[type];
        return typeNames[index % typeNames.length] || `${type} ${index + 1}`;
    }

    /**
     * Get radius for a POI type
     */
    private getPOIRadius(type: POIType): number {
        const radii: Record<POIType, number> = {
            spawn_point: 5,
            musical_shrine: 8,
            puzzle_location: 6,
            scenic_viewpoint: 4,
            landmark: 10
        };
        return radii[type];
    }

    /**
     * Generate metadata for a POI
     */
    private generateMetadata(type: POIType, x: number, z: number): Record<string, any> {
        const baseMetadata: Record<POIType, Record<string, any>> = {
            spawn_point: { hasCheckpoint: true },
            musical_shrine: {
                instrument: ['harp', 'flute', 'drum', 'bell'][Math.floor(Math.random() * 4)],
                melodyComplexity: Math.floor(Math.random() * 5) + 1
            },
            puzzle_location: {
                difficulty: Math.floor(Math.random() * 5) + 1,
                type: ['pattern', 'timing', 'musical', 'environmental'][Math.floor(Math.random() * 4)]
            },
            scenic_viewpoint: {
                viewQuality: Math.floor(Math.random() * 5) + 5,
                timeOfDay: ['sunrise', 'sunset', 'midnight', 'noon'][Math.floor(Math.random() * 4)]
            },
            landmark: {
                scale: 0.8 + Math.random() * 0.7,
                isInteractive: Math.random() > 0.5
            }
        };

        return { ...baseMetadata[type], x, z };
    }

    /**
     * Connect POIs with paths based on importance and proximity
     * Ensures all POIs are connected to the spawn point network
     */
    private connectPOIs(): void {
        const spawn = this.placedPOIs.find(p => p.type === 'spawn_point');
        if (!spawn) return;

        // Start with spawn point as the root of our connected network
        const connectedIds = new Set<string>([spawn.id]);
        const unconnected = this.placedPOIs.filter(p => p.id !== spawn.id);

        // Connect POIs one by one, always connecting to the existing network
        while (unconnected.length > 0) {
            let bestConnection: { from: POI; to: POI; dist: number } | null = null;

            // Find the closest pair between connected and unconnected POIs
            for (const connectedId of connectedIds) {
                const connected = this.placedPOIs.find(p => p.id === connectedId)!;
                
                for (const candidate of unconnected) {
                    const dist = Math.sqrt(
                        Math.pow(connected.position.x - candidate.position.x, 2) +
                        Math.pow(connected.position.z - candidate.position.z, 2)
                    );

                    if (dist < 200 && (!bestConnection || dist < bestConnection.dist)) {
                        bestConnection = { from: connected, to: candidate, dist };
                    }
                }
            }

            if (bestConnection) {
                // Connect the POIs
                bestConnection.from.connections.push(bestConnection.to.id);
                bestConnection.to.connections.push(bestConnection.from.id);
                
                // Mark as connected
                connectedIds.add(bestConnection.to.id);
                const index = unconnected.findIndex(p => p.id === bestConnection!.to.id);
                if (index > -1) {
                    unconnected.splice(index, 1);
                }
            } else {
                // No valid connection found - connect remaining to nearest connected
                for (const remaining of unconnected) {
                    let nearest: POI | null = null;
                    let nearestDist = Infinity;
                    
                    for (const connectedId of connectedIds) {
                        const connected = this.placedPOIs.find(p => p.id === connectedId)!;
                        const dist = Math.sqrt(
                            Math.pow(connected.position.x - remaining.position.x, 2) +
                            Math.pow(connected.position.z - remaining.position.z, 2)
                        );
                        if (dist < nearestDist) {
                            nearestDist = dist;
                            nearest = connected;
                        }
                    }
                    
                    if (nearest) {
                        nearest.connections.push(remaining.id);
                        remaining.connections.push(nearest.id);
                        connectedIds.add(remaining.id);
                    }
                }
                break;
            }
        }
    }

    /**
     * Find the nearest POI to a given POI
     */
    private findNearestPOI(poi: POI): POI | null {
        let nearest: POI | null = null;
        let nearestDist = Infinity;

        for (const other of this.placedPOIs) {
            if (other.id === poi.id) continue;

            const dist = Math.sqrt(
                Math.pow(poi.position.x - other.position.x, 2) +
                Math.pow(poi.position.z - other.position.z, 2)
            );

            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = other;
            }
        }

        return nearest;
    }

    /**
     * Check accessibility - can player reach all POIs from spawn?
     */
    validateAccessibility(): { isValid: boolean; unreachablePOIs: string[] } {
        const spawn = this.placedPOIs.find(p => p.type === 'spawn_point');
        if (!spawn) {
            return { isValid: false, unreachablePOIs: this.placedPOIs.map(p => p.id) };
        }

        // BFS to find all reachable POIs
        const visited = new Set<string>();
        const queue: string[] = [spawn.id];
        visited.add(spawn.id);

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const current = this.placedPOIs.find(p => p.id === currentId);

            if (current) {
                for (const connectionId of current.connections) {
                    if (!visited.has(connectionId)) {
                        visited.add(connectionId);
                        queue.push(connectionId);
                    }
                }
            }
        }

        const unreachablePOIs = this.placedPOIs
            .filter(p => !visited.has(p.id))
            .map(p => p.id);

        return {
            isValid: unreachablePOIs.length === 0,
            unreachablePOIs
        };
    }

    /**
     * Get spawn point position
     */
    getSpawnPoint(): PathPoint | null {
        const spawn = this.placedPOIs.find(p => p.type === 'spawn_point');
        return spawn ? spawn.position : null;
    }
}

export default POIGenerator;
