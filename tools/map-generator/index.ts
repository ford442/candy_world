/**
 * Main Map Generator
 * Orchestrates all generation modules to create complete maps
 */

import { BiomeGenerator, BIOMES, BiomeMapCell } from './biome-generator.ts';
import { PoissonDiscSampler, DEFAULT_ENTITY_TEMPLATES, PlacedEntity } from './poisson-disc-sampler.ts';
import { PathGenerator, Path } from './path-generator.ts';
import { POIGenerator, POI } from './interest-point-generator.ts';
import { MapValidator, ValidationResult } from './validation.ts';
import { SVGPreviewGenerator } from './svg-preview.ts';

export interface MapGenerationOptions {
    seed: number;
    size: number;
    biomes?: string[];
    poiCount?: number;
    entityDensity?: number;
    maxEntities?: number;
    generatePaths?: boolean;
    waterLevel?: number;
}

export interface GeneratedMap {
    metadata: {
        seed: number;
        version: string;
        biomes: string[];
        bounds: {
            min: [number, number];
            max: [number, number];
        };
        entityCount: number;
        pathCount: number;
        poiCount: number;
        generationTime: number;
    };
    entities: Array<{
        type: string;
        position: [number, number, number];
        scale: number;
        variant?: string;
        note?: string;
        noteIndex?: number;
        hasFace?: boolean;
        rotation?: number;
    }>;
    paths: Path[];
    pois: POI[];
    validation: ValidationResult;
}

export class MapGenerator {
    private seed: number;
    private options: Required<MapGenerationOptions>;
    private biomeGenerator: BiomeGenerator;
    private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

    constructor(options: MapGenerationOptions) {
        this.seed = options.seed;
        this.options = {
            seed: options.seed,
            size: options.size,
            biomes: options.biomes || ['meadow', 'forest', 'lake'],
            poiCount: options.poiCount || 12,
            entityDensity: options.entityDensity || 0.8,
            maxEntities: options.maxEntities || 5000,
            generatePaths: options.generatePaths ?? true,
            waterLevel: options.waterLevel ?? -1
        };

        this.bounds = {
            minX: -options.size / 2,
            maxX: options.size / 2,
            minZ: -options.size / 2,
            maxZ: options.size / 2
        };

        this.biomeGenerator = new BiomeGenerator(this.seed);
    }

    /**
     * Generate a complete map
     */
    async generate(): Promise<GeneratedMap> {
        const startTime = Date.now();
        console.log(`🗺️  Starting map generation with seed ${this.seed}...`);

        // Step 1: Generate POIs first (they guide everything else)
        console.log('📍 Generating Points of Interest...');
        const pois = this.generatePOIs();

        // Step 2: Generate paths connecting POIs
        let paths: Path[] = [];
        if (this.options.generatePaths) {
            console.log('🛤️  Generating paths...');
            paths = this.generatePaths(pois);
        }

        // Step 3: Generate entities using Poisson disc sampling
        console.log('🌿 Generating entities...');
        const entities = this.generateEntities(pois, paths);

        // Step 4: Validate the map
        console.log('✅ Validating map...');
        const validation = this.validateMap(entities, paths, pois);

        // Step 5: Generate preview
        console.log('🎨 Generating preview...');
        await this.generatePreview(entities, paths, pois);

        const generationTime = Date.now() - startTime;
        console.log(`✨ Map generation complete in ${generationTime}ms`);

        // Convert entities to map format
        const mapEntities = this.convertEntities(entities);

        // Determine which biomes are actually present
        const presentBiomes = this.getPresentBiomes();

        return {
            metadata: {
                seed: this.seed,
                version: '1.0',
                biomes: presentBiomes,
                bounds: {
                    min: [this.bounds.minX, this.bounds.minZ],
                    max: [this.bounds.maxX, this.bounds.maxZ]
                },
                entityCount: mapEntities.length,
                pathCount: paths.length,
                poiCount: pois.length,
                generationTime
            },
            entities: mapEntities,
            paths,
            pois,
            validation
        };
    }

    /**
     * Generate Points of Interest
     */
    private generatePOIs(): POI[] {
        const poiGenerator = new POIGenerator({
            seed: this.seed,
            bounds: this.bounds,
            elevationFn: (x, z) => this.biomeGenerator.getElevation(x, z),
            biomeFn: (x, z) => {
                const { biome } = this.biomeGenerator.getBiomeAt(x, z);
                return biome;
            },
            waterLevel: this.options.waterLevel,
            poiCount: this.options.poiCount,
            minDistance: this.options.size / 10
        });

        return poiGenerator.generate();
    }

    /**
     * Generate paths connecting POIs
     */
    private generatePaths(pois: POI[]): Path[] {
        const pathGenerator = new PathGenerator({
            seed: this.seed,
            bounds: this.bounds,
            elevationFn: (x, z) => this.biomeGenerator.getElevation(x, z),
            waterLevel: this.options.waterLevel
        });

        // Generate road network connecting POIs
        const paths: Path[] = [];
        
        // Connect each POI to its connected POIs
        for (const poi of pois) {
            for (const connectedId of poi.connections) {
                const connectedPOI = pois.find(p => p.id === connectedId);
                if (connectedPOI) {
                    // Avoid duplicate paths
                    const pathExists = paths.some(p => 
                        (p.startPOI === poi.id && p.endPOI === connectedId) ||
                        (p.startPOI === connectedId && p.endPOI === poi.id)
                    );
                    
                    if (!pathExists) {
                        const pathSegments = pathGenerator.generatePath(
                            poi.position,
                            connectedPOI.position,
                            'road',
                            { width: 3, startPOI: poi.id, endPOI: connectedId }
                        );
                        paths.push(...pathSegments);
                    }
                }
            }
        }

        // Generate a river from highest to lowest point
        const highestPOI = pois.reduce((max, p) => 
            p.position.y > max.position.y ? p : max
        );
        const lowestPOI = pois.reduce((min, p) => 
            p.position.y < min.position.y ? p : min
        );

        if (highestPOI !== lowestPOI) {
            const riverPaths = pathGenerator.generateRiver(
                highestPOI.position,
                lowestPOI.position,
                { width: 6, meanderAmount: 15 }
            );
            paths.push(...riverPaths);
        }

        return paths;
    }

    /**
     * Generate entities using Poisson disc sampling
     */
    private generateEntities(pois: POI[], paths: Path[]): PlacedEntity[] {
        // Filter templates by requested biomes
        const allowedBiomes = new Set(this.options.biomes);
        const templates = DEFAULT_ENTITY_TEMPLATES.filter(t => 
            !t.biomes || t.biomes.some(b => allowedBiomes.has(b))
        );

        const sampler = new PoissonDiscSampler({
            width: this.bounds.maxX - this.bounds.minX,
            height: this.bounds.maxZ - this.bounds.minZ,
            minX: this.bounds.minX,
            minZ: this.bounds.minZ,
            entityTemplates: templates,
            maxAttempts: 30
        });

        const allEntities: PlacedEntity[] = [];

        // Generate entities for each biome region
        for (const biomeName of this.options.biomes) {
            const biome = BIOMES[biomeName];
            if (!biome) continue;

            // Sample biome region
            const regionEntities = sampler.generateForRegion(
                this.bounds.minX,
                this.bounds.minZ,
                this.bounds.maxX,
                this.bounds.maxZ,
                biome.densityMultiplier * this.options.entityDensity,
                (x, z) => {
                    const { biome } = this.biomeGenerator.getBiomeAt(x, z);
                    return biome;
                },
                (x, z) => this.biomeGenerator.getElevation(x, z)
            );

            // Filter to only entities in this biome
            const biomeEntities = regionEntities.filter(e => {
                const { biome } = this.biomeGenerator.getBiomeAt(e.x, e.z);
                return biome === biomeName;
            });

            allEntities.push(...biomeEntities);
        }

        // Add special entities near POIs
        for (const poi of pois) {
            if (poi.type === 'musical_shrine') {
                // Add mushrooms in a circle around shrines
                const numMushrooms = 8;
                for (let i = 0; i < numMushrooms; i++) {
                    const angle = (i / numMushrooms) * Math.PI * 2;
                    const distance = 8;
                    const x = poi.position.x + Math.cos(angle) * distance;
                    const z = poi.position.z + Math.sin(angle) * distance;
                    const elevation = this.biomeGenerator.getElevation(x, z);

                    allEntities.push({
                        x,
                        y: elevation,
                        z,
                        type: 'mushroom',
                        scale: 1.0 + Math.random() * 0.5,
                        rotation: angle,
                        template: DEFAULT_ENTITY_TEMPLATES.find(t => t.type === 'mushroom')!
                    });
                }
            }
        }

        // Limit to max entities
        if (allEntities.length > this.options.maxEntities) {
            console.log(`⚠️  Truncating ${allEntities.length} entities to ${this.options.maxEntities}`);
            return allEntities.slice(0, this.options.maxEntities);
        }

        return allEntities;
    }

    /**
     * Validate the generated map
     */
    private validateMap(entities: PlacedEntity[], paths: Path[], pois: POI[]): ValidationResult {
        const validator = new MapValidator({
            bounds: this.bounds,
            groundLevel: this.options.waterLevel,
            maxEntities: this.options.maxEntities,
            elevationFn: (x, z) => this.biomeGenerator.getElevation(x, z),
            waterLevel: this.options.waterLevel
        });

        return validator.validate(entities, paths, pois);
    }

    /**
     * Generate SVG preview
     */
    private async generatePreview(entities: PlacedEntity[], paths: Path[], pois: POI[]): Promise<void> {
        try {
            // Sample biome map for preview
            const sampleResolution = Math.max(5, Math.floor(this.options.size / 100));
            const biomeMap = this.biomeGenerator.sampleBiomeRegion(
                this.bounds.minX,
                this.bounds.minZ,
                this.bounds.maxX,
                this.bounds.maxZ,
                sampleResolution
            );

            const preview = new SVGPreviewGenerator(this.bounds, {
                width: 1200,
                height: 1200,
                showBiomes: true,
                showPaths: true,
                showPOIs: true,
                showEntities: true
            });

            const svg = preview.generate(entities, paths, pois, biomeMap);

            // Save to file
            const fs = await import('fs/promises');
            const path = await import('path');
            const previewPath = path.join(process.cwd(), 'tools', 'map-generator', 'preview.svg');
            await fs.writeFile(previewPath, svg, 'utf-8');
            console.log(`🖼️  Preview saved to ${previewPath}`);
        } catch (error) {
            console.warn('⚠️  Could not generate preview:', error);
        }
    }

    /**
     * Convert internal entities to map format
     */
    private convertEntities(entities: PlacedEntity[]): GeneratedMap['entities'] {
        return entities.map(e => {
            const base: GeneratedMap['entities'][0] = {
                type: e.type,
                position: [e.x, e.y, e.z],
                scale: e.scale,
                rotation: e.rotation
            };

            // Add mushroom-specific properties
            if (e.type === 'mushroom') {
                const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                const noteIndex = Math.floor(Math.random() * 12);
                base.variant = Math.random() > 0.8 ? 'giant' : 'regular';
                base.note = notes[noteIndex];
                base.noteIndex = noteIndex;
                base.hasFace = base.variant === 'giant';
            }

            // Add cloud-specific properties
            if (e.type === 'cloud') {
                base.variant = 'floating';
            }

            return base;
        });
    }

    /**
     * Get list of biomes present in the generated map
     */
    private getPresentBiomes(): string[] {
        const distribution = this.biomeGenerator.getBiomeDistribution(
            this.bounds.minX,
            this.bounds.minZ,
            this.bounds.maxX,
            this.bounds.maxZ
        );

        return Array.from(distribution.entries())
            .filter(([_, coverage]) => coverage > 0.05)
            .map(([biome, _]) => biome);
    }

    /**
     * Save map to JSON file
     */
    async saveToFile(filepath: string): Promise<void> {
        const map = await this.generate();
        
        const fs = await import('fs/promises');
        const path = await import('path');
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(filepath), { recursive: true });
        
        // Write JSON with pretty printing
        await fs.writeFile(filepath, JSON.stringify(map, null, 2), 'utf-8');
        
        console.log(`💾 Map saved to ${filepath}`);
        console.log(`   Entities: ${map.metadata.entityCount}`);
        console.log(`   Paths: ${map.metadata.pathCount}`);
        console.log(`   POIs: ${map.metadata.poiCount}`);
        console.log(`   Biomes: ${map.metadata.biomes.join(', ')}`);
        console.log(`   Valid: ${map.validation.isValid ? '✅' : '❌'}`);
        
        if (!map.validation.isValid) {
            console.log(`   Errors: ${map.validation.errors.length}`);
            for (const error of map.validation.errors.slice(0, 5)) {
                console.log(`     - ${error.message}`);
            }
        }
    }
}

export default MapGenerator;
