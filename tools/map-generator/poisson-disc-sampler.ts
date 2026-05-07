/**
 * Poisson Disc Sampler for Blue Noise Distribution
 * Ensures natural, non-clustering entity placement with minimum distance constraints
 */

export interface EntityTemplate {
    type: string;
    minRadius: number;
    maxRadius: number;
    scaleRange: [number, number];
    yOffset?: number;
    elevationAdapt?: boolean;
    biomes?: string[]; // Specific biomes this entity can spawn in
}

export interface PlacedEntity {
    x: number;
    y: number;
    z: number;
    type: string;
    scale: number;
    rotation: number;
    template: EntityTemplate;
}

export interface SamplerOptions {
    width: number;
    height: number;
    minX: number;
    minZ: number;
    maxAttempts?: number;
    entityTemplates: EntityTemplate[];
}

export class PoissonDiscSampler {
    private width: number;
    private height: number;
    private minX: number;
    private minZ: number;
    private maxAttempts: number;
    private entityTemplates: EntityTemplate[];
    private placedEntities: PlacedEntity[] = [];
    private grid: Map<string, PlacedEntity> = new Map();
    private cellSize: number;

    constructor(options: SamplerOptions) {
        this.width = options.width;
        this.height = options.height;
        this.minX = options.minX;
        this.minZ = options.minZ;
        this.maxAttempts = options.maxAttempts || 30;
        this.entityTemplates = options.entityTemplates;
        
        // Find minimum radius across all templates
        const minRadius = Math.min(...this.entityTemplates.map(t => t.minRadius));
        this.cellSize = minRadius / Math.sqrt(2);
    }

    /**
     * Get grid cell key for spatial hashing
     */
    private getCellKey(x: number, z: number): string {
        const cellX = Math.floor((x - this.minX) / this.cellSize);
        const cellZ = Math.floor((z - this.minZ) / this.cellSize);
        return `${cellX},${cellZ}`;
    }

    /**
     * Check if a position is valid (not too close to existing entities)
     */
    private isValidPosition(x: number, z: number, radius: number, biomeCheck?: (x: number, z: number) => string): boolean {
        // Get surrounding cells to check
        const cellX = Math.floor((x - this.minX) / this.cellSize);
        const cellZ = Math.floor((z - this.minZ) / this.cellSize);
        
        const searchRadius = Math.ceil(radius / this.cellSize);
        
        for (let i = -searchRadius; i <= searchRadius; i++) {
            for (let j = -searchRadius; j <= searchRadius; j++) {
                const key = `${cellX + i},${cellZ + j}`;
                const existing = this.grid.get(key);
                
                if (existing) {
                    const dx = existing.x - x;
                    const dz = existing.z - z;
                    const distance = Math.sqrt(dx * dx + dz * dz);
                    
                    // Check against this entity's required radius
                    if (distance < radius + existing.template.minRadius * 0.5) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Generate a random point in an annulus (donut) around a center point
     */
    private randomPointInAnnulus(centerX: number, centerZ: number, minR: number, maxR: number): { x: number; z: number } {
        // Use square root for uniform distribution
        const r = minR + Math.random() * (maxR - minR);
        const theta = Math.random() * Math.PI * 2;
        
        return {
            x: centerX + r * Math.cos(theta),
            z: centerZ + r * Math.sin(theta)
        };
    }

    /**
     * Try to place a new entity near an existing one
     */
    private tryPlaceNear(existing: PlacedEntity, template: EntityTemplate, 
                         biomeCheck?: (x: number, z: number) => string,
                         elevationCheck?: (x: number, z: number) => number): PlacedEntity | null {
        const radius = template.minRadius + Math.random() * (template.maxRadius - template.minRadius);
        
        for (let i = 0; i < this.maxAttempts; i++) {
            const point = this.randomPointInAnnulus(
                existing.x, 
                existing.z, 
                template.minRadius, 
                template.minRadius * 2
            );
            
            // Check bounds
            if (point.x < this.minX || point.x > this.minX + this.width ||
                point.z < this.minZ || point.z > this.minZ + this.height) {
                continue;
            }

            // Check biome compatibility if provided
            if (biomeCheck && template.biomes) {
                const currentBiome = biomeCheck(point.x, point.z);
                if (!template.biomes.includes(currentBiome)) {
                    continue;
                }
            }

            if (this.isValidPosition(point.x, point.z, radius, biomeCheck)) {
                const elevation = elevationCheck ? elevationCheck(point.x, point.z) : 0;
                const y = template.elevationAdapt !== false ? elevation + (template.yOffset || 0) : (template.yOffset || 0);
                
                const entity: PlacedEntity = {
                    x: point.x,
                    y,
                    z: point.z,
                    type: template.type,
                    scale: template.scaleRange[0] + Math.random() * (template.scaleRange[1] - template.scaleRange[0]),
                    rotation: Math.random() * Math.PI * 2,
                    template
                };

                this.addEntityToGrid(entity);
                return entity;
            }
        }

        return null;
    }

    /**
     * Add entity to spatial grid
     */
    private addEntityToGrid(entity: PlacedEntity): void {
        const key = this.getCellKey(entity.x, entity.z);
        this.grid.set(key, entity);
        this.placedEntities.push(entity);
    }

    /**
     * Generate entities using Poisson disc sampling
     */
    generate(options: {
        densityMap?: (x: number, z: number) => number;
        biomeCheck?: (x: number, z: number) => string;
        elevationCheck?: (x: number, z: number) => number;
        maxEntities?: number;
        seedPoints?: { x: number; z: number }[];
    } = {}): PlacedEntity[] {
        const { 
            densityMap, 
            biomeCheck, 
            elevationCheck, 
            maxEntities = 1000,
            seedPoints = []
        } = options;

        this.placedEntities = [];
        this.grid.clear();

        const activeList: PlacedEntity[] = [];

        // Place initial seed points
        if (seedPoints.length > 0) {
            for (const seed of seedPoints) {
                const template = this.selectTemplateForBiome(
                    biomeCheck ? biomeCheck(seed.x, seed.z) : 'meadow'
                );
                if (template && this.isValidPosition(seed.x, seed.z, template.minRadius)) {
                    const elevation = elevationCheck ? elevationCheck(seed.x, seed.z) : 0;
                    const entity: PlacedEntity = {
                        x: seed.x,
                        y: template.elevationAdapt !== false ? elevation + (template.yOffset || 0) : (template.yOffset || 0),
                        z: seed.z,
                        type: template.type,
                        scale: template.scaleRange[0] + Math.random() * (template.scaleRange[1] - template.scaleRange[0]),
                        rotation: Math.random() * Math.PI * 2,
                        template
                    };
                    this.addEntityToGrid(entity);
                    activeList.push(entity);
                }
            }
        } else {
            // Place a random starting point
            const x = this.minX + Math.random() * this.width;
            const z = this.minZ + Math.random() * this.height;
            const biome = biomeCheck ? biomeCheck(x, z) : 'meadow';
            const template = this.selectTemplateForBiome(biome);
            
            if (template) {
                const elevation = elevationCheck ? elevationCheck(x, z) : 0;
                const entity: PlacedEntity = {
                    x,
                    y: template.elevationAdapt !== false ? elevation + (template.yOffset || 0) : (template.yOffset || 0),
                    z,
                    type: template.type,
                    scale: template.scaleRange[0] + Math.random() * (template.scaleRange[1] - template.scaleRange[0]),
                    rotation: Math.random() * Math.PI * 2,
                    template
                };
                this.addEntityToGrid(entity);
                activeList.push(entity);
            }
        }

        // Generate additional points
        while (activeList.length > 0 && this.placedEntities.length < maxEntities) {
            // Pick a random active point
            const randomIndex = Math.floor(Math.random() * activeList.length);
            const activePoint = activeList[randomIndex];

            // Determine which template to use based on density/biome
            const biome = biomeCheck ? biomeCheck(activePoint.x, activePoint.z) : 'meadow';
            const density = densityMap ? densityMap(activePoint.x, activePoint.z) : 1;
            
            // Skip if density is too low
            if (Math.random() > density) {
                activeList.splice(randomIndex, 1);
                continue;
            }

            const template = this.selectTemplateForBiome(biome);
            if (!template) {
                activeList.splice(randomIndex, 1);
                continue;
            }

            // Try to place a new point near this one
            const newEntity = this.tryPlaceNear(activePoint, template, biomeCheck, elevationCheck);
            
            if (newEntity) {
                activeList.push(newEntity);
            } else {
                // Remove from active list if we couldn't place any points
                activeList.splice(randomIndex, 1);
            }
        }

        return this.placedEntities;
    }

    /**
     * Select a template based on biome weights
     */
    private selectTemplateForBiome(biome: string): EntityTemplate | null {
        const candidates = this.entityTemplates.filter(t => 
            !t.biomes || t.biomes.includes(biome)
        );

        if (candidates.length === 0) return null;

        // Weighted random selection
        const totalWeight = candidates.length;
        let random = Math.random() * totalWeight;
        
        return candidates[Math.floor(random)];
    }

    /**
     * Generate entities in a specific region with controlled density
     */
    generateForRegion(
        regionMinX: number, 
        regionMinZ: number, 
        regionMaxX: number, 
        regionMaxZ: number,
        targetDensity: number,
        biomeCheck?: (x: number, z: number) => string,
        elevationCheck?: (x: number, z: number) => number
    ): PlacedEntity[] {
        const regionWidth = regionMaxX - regionMinX;
        const regionHeight = regionMaxZ - regionMinZ;
        const area = regionWidth * regionHeight;
        
        // Estimate max entities based on area and density
        const maxEntities = Math.floor(area * targetDensity / 100);

        // Create seed points in a grid pattern for region coverage
        const seeds: { x: number; z: number }[] = [];
        const gridSize = 20;
        for (let x = regionMinX; x < regionMaxX; x += gridSize) {
            for (let z = regionMinZ; z < regionMaxZ; z += gridSize) {
                seeds.push({
                    x: x + Math.random() * gridSize,
                    z: z + Math.random() * gridSize
                });
            }
        }

        return this.generate({
            densityMap: () => targetDensity,
            biomeCheck,
            elevationCheck,
            maxEntities,
            seedPoints: seeds
        });
    }
}

/**
 * Pre-defined entity templates for Candy World
 */
export const DEFAULT_ENTITY_TEMPLATES: EntityTemplate[] = [
    // Meadow entities
    { type: 'grass', minRadius: 0.5, maxRadius: 1, scaleRange: [0.8, 1.3], elevationAdapt: true, biomes: ['meadow', 'forest', 'mountain'] },
    { type: 'flower', minRadius: 1, maxRadius: 2, scaleRange: [0.7, 1.1], elevationAdapt: true, biomes: ['meadow'] },
    { type: 'mushroom', minRadius: 2, maxRadius: 4, scaleRange: [0.8, 1.5], elevationAdapt: true, biomes: ['meadow', 'forest', 'cave'] },
    { type: 'starflower', minRadius: 1.5, maxRadius: 3, scaleRange: [0.7, 1.0], elevationAdapt: true, biomes: ['meadow', 'forest'] },
    { type: 'tremolo_tulip', minRadius: 1.2, maxRadius: 2.5, scaleRange: [0.8, 1.2], elevationAdapt: true, biomes: ['meadow', 'lake'] },
    { type: 'vibrato_violet', minRadius: 1, maxRadius: 2, scaleRange: [0.7, 1.0], elevationAdapt: true, biomes: ['meadow', 'forest', 'crystallineNebula'] },
    { type: 'balloon_bush', minRadius: 3, maxRadius: 5, scaleRange: [0.9, 1.4], elevationAdapt: true, biomes: ['meadow', 'forest'] },
    
    // Forest entities
    { type: 'portamento_pine', minRadius: 4, maxRadius: 8, scaleRange: [0.8, 1.5], elevationAdapt: true, biomes: ['forest', 'mountain'] },
    { type: 'bubble_willow', minRadius: 5, maxRadius: 10, scaleRange: [0.9, 1.6], elevationAdapt: true, biomes: ['forest', 'lake'] },
    { type: 'fiber_optic_willow', minRadius: 4, maxRadius: 7, scaleRange: [0.8, 1.3], elevationAdapt: true, biomes: ['forest', 'cave', 'neonCorruption'] },
    { type: 'arpeggio_fern', minRadius: 1.5, maxRadius: 3, scaleRange: [0.7, 1.2], elevationAdapt: true, biomes: ['forest', 'crystallineNebula'] },
    { type: 'prism_rose_bush', minRadius: 2, maxRadius: 4, scaleRange: [0.8, 1.3], elevationAdapt: true, biomes: ['forest', 'meadow'] },
    { type: 'wisteria_cluster', minRadius: 3, maxRadius: 6, scaleRange: [0.8, 1.4], elevationAdapt: true, biomes: ['forest'] },
    { type: 'helix_plant', minRadius: 1.5, maxRadius: 3, scaleRange: [0.7, 1.1], elevationAdapt: true, biomes: ['forest', 'cave', 'neonCorruption'] },
    { type: 'snare_trap', minRadius: 2, maxRadius: 4, scaleRange: [0.8, 1.0], elevationAdapt: true, biomes: ['forest', 'cave', 'crystallineNebula'] },
    
    // Lake entities
    { type: 'subwoofer_lotus', minRadius: 3, maxRadius: 6, scaleRange: [0.8, 1.3], elevationAdapt: true, yOffset: -0.5, biomes: ['lake', 'crystallineNebula'] },
    { type: 'accordion_palm', minRadius: 4, maxRadius: 8, scaleRange: [0.9, 1.5], elevationAdapt: true, biomes: ['lake', 'meadow'] },
    
    // Mountain entities
    { type: 'cymbal_dandelion', minRadius: 2, maxRadius: 4, scaleRange: [0.7, 1.1], elevationAdapt: true, biomes: ['mountain'] },
    { type: 'kick_drum_geyser', minRadius: 5, maxRadius: 10, scaleRange: [0.9, 1.4], elevationAdapt: true, biomes: ['mountain', 'neonCorruption', 'crystallineNebula'] },
    
    // Cave entities
    { type: 'floating_orb', minRadius: 3, maxRadius: 6, scaleRange: [0.8, 1.5], elevationAdapt: true, yOffset: 1, biomes: ['cave', 'neonCorruption', 'mountain'] },
    
    // Sky entities
    { type: 'cloud', minRadius: 10, maxRadius: 20, scaleRange: [1.0, 2.5], elevationAdapt: false, yOffset: 30, biomes: ['meadow', 'forest', 'mountain', 'lake'] }
];

export default PoissonDiscSampler;
