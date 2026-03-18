/**
 * SVG Visual Preview Generator
 * Creates a 2D top-down preview of the generated map
 */

import { PlacedEntity } from './poisson-disc-sampler.ts';
import { Path } from './path-generator.ts';
import { POI } from './interest-point-generator.ts';
import { BiomeMapCell } from './biome-generator.ts';

export interface PreviewOptions {
    width: number;
    height: number;
    showBiomes?: boolean;
    showElevation?: boolean;
    showPaths?: boolean;
    showPOIs?: boolean;
    showEntities?: boolean;
    backgroundColor?: string;
}

export class SVGPreviewGenerator {
    private width: number;
    private height: number;
    private bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
    private options: PreviewOptions;

    constructor(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, options: Partial<PreviewOptions> = {}) {
        this.bounds = bounds;
        this.options = {
            width: 1200,
            height: 1200,
            showBiomes: true,
            showElevation: false,
            showPaths: true,
            showPOIs: true,
            showEntities: true,
            backgroundColor: '#1a1a2e',
            ...options
        };
        this.width = this.options.width!;
        this.height = this.options.height!;
    }

    /**
     * Convert world coordinates to SVG coordinates
     */
    private worldToSVG(x: number, z: number): { x: number; y: number } {
        const worldWidth = this.bounds.maxX - this.bounds.minX;
        const worldHeight = this.bounds.maxZ - this.bounds.minZ;
        
        const scale = Math.min(this.width / worldWidth, this.height / worldHeight);
        
        const svgX = (x - this.bounds.minX) * scale;
        const svgY = (this.bounds.maxZ - z) * scale; // Flip Y for SVG
        
        return { x: svgX, y: svgY };
    }

    /**
     * Get color for an entity type
     */
    private getEntityColor(type: string): string {
        const colors: Record<string, string> = {
            grass: '#7CFC00',
            flower: '#FF69B4',
            mushroom: '#FF6347',
            starflower: '#FFD700',
            tremolo_tulip: '#FF1493',
            vibrato_violet: '#9370DB',
            balloon_bush: '#FF6B9D',
            portamento_pine: '#228B22',
            bubble_willow: '#87CEEB',
            fiber_optic_willow: '#00FFFF',
            arpeggio_fern: '#32CD32',
            prism_rose_bush: '#FF69B4',
            wisteria_cluster: '#DDA0DD',
            helix_plant: '#00FA9A',
            snare_trap: '#8B0000',
            subwoofer_lotus: '#FF8C00',
            accordion_palm: '#20B2AA',
            cymbal_dandelion: '#FFFF00',
            kick_drum_geyser: '#A9A9A9',
            floating_orb: '#E0FFFF',
            cloud: '#F0F8FF'
        };
        
        return colors[type] || '#888888';
    }

    /**
     * Get color for a biome
     */
    private getBiomeColor(biome: string): string {
        const colors: Record<string, string> = {
            meadow: '#90EE90',
            forest: '#228B22',
            lake: '#4169E1',
            mountain: '#8B7355',
            cave: '#4B0082',
            neonCorruption: '#FF1493'
        };
        
        return colors[biome] || '#888888';
    }

    /**
     * Get symbol for POI type
     */
    private getPOISymbol(type: string): string {
        const symbols: Record<string, string> = {
            spawn_point: '★',
            musical_shrine: '♪',
            puzzle_location: '?',
            scenic_viewpoint: '👁',
            landmark: '⚡'
        };
        
        return symbols[type] || '●';
    }

    /**
     * Get color for POI type
     */
    private getPOIColor(type: string): string {
        const colors: Record<string, string> = {
            spawn_point: '#00FF00',
            musical_shrine: '#FFD700',
            puzzle_location: '#FF4500',
            scenic_viewpoint: '#87CEEB',
            landmark: '#FF69B4'
        };
        
        return colors[type] || '#FFFFFF';
    }

    /**
     * Generate SVG content for biome map
     */
    private generateBiomeLayer(biomeMap: BiomeMapCell[][]): string {
        if (!this.options.showBiomes) return '';
        
        const cellWidth = (this.bounds.maxX - this.bounds.minX) / biomeMap.length;
        const cellHeight = (this.bounds.maxZ - this.bounds.minZ) / biomeMap[0].length;
        
        let svg = '\n  <!-- Biome Layer -->\n  <g id="biomes">';
        
        for (let i = 0; i < biomeMap.length - 1; i++) {
            for (let j = 0; j < biomeMap[i].length - 1; j++) {
                const cell = biomeMap[i][j];
                const pos = this.worldToSVG(
                    this.bounds.minX + i * cellWidth,
                    this.bounds.minZ + j * cellHeight
                );
                const nextPos = this.worldToSVG(
                    this.bounds.minX + (i + 1) * cellWidth,
                    this.bounds.minZ + (j + 1) * cellHeight
                );
                
                const width = nextPos.x - pos.x;
                const height = nextPos.y - pos.y;
                
                const color = this.getBiomeColor(cell.biome);
                const opacity = 0.3 + cell.blendWeight * 0.4;
                
                svg += `\n    <rect x="${pos.x.toFixed(1)}" y="${pos.y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" fill="${color}" opacity="${opacity.toFixed(2)}" />`;
            }
        }
        
        svg += '\n  </g>';
        return svg;
    }

    /**
     * Generate SVG content for paths
     */
    private generatePathLayer(paths: Path[]): string {
        if (!this.options.showPaths) return '';
        
        let svg = '\n  <!-- Path Layer -->\n  <g id="paths">';
        
        for (const path of paths) {
            if (path.points.length < 2) continue;
            
            // Generate path data
            let d = '';
            for (let i = 0; i < path.points.length; i++) {
                const pos = this.worldToSVG(path.points[i].x, path.points[i].z);
                if (i === 0) {
                    d += `M ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
                } else {
                    d += ` L ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
                }
            }
            
            // Path styling
            let stroke = '#8B4513';
            let strokeWidth = path.width * 2;
            let opacity = 0.8;
            
            if (path.type === 'river') {
                stroke = '#4169E1';
                strokeWidth = path.width * 3;
                opacity = 0.6;
            } else if (path.type === 'bridge') {
                stroke = '#DEB887';
                strokeWidth = path.width * 2;
                opacity = 0.9;
            } else if (path.type === 'tunnel') {
                stroke = '#4B0082';
                strokeWidth = path.width * 2;
                opacity = 0.5;
                // Dashed line for tunnel
                svg += `\n    <path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" stroke-dasharray="5,5" />`;
                continue;
            }
            
            svg += `\n    <path d="${d}" stroke="${stroke}" stroke-width="${strokeWidth}" fill="none" opacity="${opacity}" stroke-linecap="round" />`;
        }
        
        svg += '\n  </g>';
        return svg;
    }

    /**
     * Generate SVG content for entities
     */
    private generateEntityLayer(entities: PlacedEntity[]): string {
        if (!this.options.showEntities) return '';
        
        let svg = '\n  <!-- Entity Layer -->\n  <g id="entities">';
        
        // Group entities by type for better rendering
        const byType: Record<string, PlacedEntity[]> = {};
        for (const entity of entities) {
            if (!byType[entity.type]) byType[entity.type] = [];
            byType[entity.type].push(entity);
        }
        
        for (const [type, typeEntities] of Object.entries(byType)) {
            const color = this.getEntityColor(type);
            
            for (const entity of typeEntities) {
                const pos = this.worldToSVG(entity.x, entity.z);
                const radius = Math.max(2, entity.scale * 3);
                
                svg += `\n    <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" opacity="0.7" />`;
            }
        }
        
        svg += '\n  </g>';
        return svg;
    }

    /**
     * Generate SVG content for POIs
     */
    private generatePOILayer(pois: POI[]): string {
        if (!this.options.showPOIs) return '';
        
        let svg = '\n  <!-- POI Layer -->\n  <g id="pois">';
        
        // Draw connection lines first
        const connections = new Set<string>();
        for (const poi of pois) {
            const pos = this.worldToSVG(poi.position.x, poi.position.z);
            
            for (const connectionId of poi.connections) {
                const key = [poi.id, connectionId].sort().join('-');
                if (connections.has(key)) continue;
                connections.add(key);
                
                const connectedPOI = pois.find(p => p.id === connectionId);
                if (connectedPOI) {
                    const connectedPos = this.worldToSVG(connectedPOI.position.x, connectedPOI.position.z);
                    svg += `\n    <line x1="${pos.x.toFixed(1)}" y1="${pos.y.toFixed(1)}" x2="${connectedPos.x.toFixed(1)}" y2="${connectedPos.y.toFixed(1)}" stroke="#FFFF00" stroke-width="1" stroke-dasharray="3,3" opacity="0.5" />`;
                }
            }
        }
        
        // Draw POI markers
        for (const poi of pois) {
            const pos = this.worldToSVG(poi.position.x, poi.position.z);
            const color = this.getPOIColor(poi.type);
            const radius = 5 + poi.importance;
            
            // Glow effect
            svg += `\n    <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${(radius + 5).toFixed(1)}" fill="${color}" opacity="0.3" />`;
            
            // Main marker
            svg += `\n    <circle cx="${pos.x.toFixed(1)}" cy="${pos.y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" stroke="#FFFFFF" stroke-width="2" />`;
            
            // Label
            svg += `\n    <text x="${(pos.x + radius + 5).toFixed(1)}" y="${(pos.y + 4).toFixed(1)}" fill="#FFFFFF" font-size="10" font-family="sans-serif">${poi.name}</text>`;
        }
        
        svg += '\n  </g>';
        return svg;
    }

    /**
     * Generate legend
     */
    private generateLegend(): string {
        let svg = '\n  <!-- Legend -->\n  <g id="legend" transform="translate(10, 10)">';
        
        // Background
        svg += '\n    <rect x="0" y="0" width="150" height="200" fill="#000000" opacity="0.7" rx="5" />';
        
        // Title
        svg += '\n    <text x="10" y="20" fill="#FFFFFF" font-size="12" font-weight="bold" font-family="sans-serif">Map Legend</text>';
        
        let y = 40;
        
        // POI legend
        if (this.options.showPOIs) {
            svg += '\n    <text x="10" y="' + y + '" fill="#AAAAAA" font-size="10" font-family="sans-serif">POIs:</text>';
            y += 15;
            
            const poiTypes = [
                { type: 'spawn_point', label: 'Spawn' },
                { type: 'musical_shrine', label: 'Shrine' },
                { type: 'puzzle_location', label: 'Puzzle' },
                { type: 'scenic_viewpoint', label: 'Viewpoint' },
                { type: 'landmark', label: 'Landmark' }
            ];
            
            for (const poi of poiTypes) {
                const color = this.getPOIColor(poi.type);
                svg += `\n    <circle cx="20" cy="${y - 3}" r="5" fill="${color}" />`;
                svg += `\n    <text x="30" y="${y}" fill="#FFFFFF" font-size="9" font-family="sans-serif">${poi.label}</text>`;
                y += 15;
            }
        }
        
        // Path legend
        if (this.options.showPaths) {
            y += 5;
            svg += '\n    <text x="10" y="' + y + '" fill="#AAAAAA" font-size="10" font-family="sans-serif">Paths:</text>';
            y += 15;
            
            const pathTypes = [
                { type: 'road', color: '#8B4513', label: 'Road' },
                { type: 'river', color: '#4169E1', label: 'River' },
                { type: 'bridge', color: '#DEB887', label: 'Bridge' }
            ];
            
            for (const pt of pathTypes) {
                svg += `\n    <line x1="15" y1="${y - 3}" x2="30" y2="${y - 3}" stroke="${pt.color}" stroke-width="3" />`;
                svg += `\n    <text x="35" y="${y}" fill="#FFFFFF" font-size="9" font-family="sans-serif">${pt.label}</text>`;
                y += 15;
            }
        }
        
        // Biome legend
        if (this.options.showBiomes) {
            y += 5;
            svg += '\n    <text x="10" y="' + y + '" fill="#AAAAAA" font-size="10" font-family="sans-serif">Biomes:</text>';
            y += 15;
            
            const biomes = [
                { type: 'meadow', label: 'Meadow' },
                { type: 'forest', label: 'Forest' },
                { type: 'lake', label: 'Lake' },
                { type: 'mountain', label: 'Mountain' },
                { type: 'cave', label: 'Cave' },
                { type: 'neonCorruption', label: 'Neon' }
            ];
            
            for (const biome of biomes.slice(0, 4)) {
                const color = this.getBiomeColor(biome.type);
                svg += `\n    <rect x="15" y="${y - 8}" width="12" height="8" fill="${color}" opacity="0.7" />`;
                svg += `\n    <text x="30" y="${y}" fill="#FFFFFF" font-size="9" font-family="sans-serif">${biome.label}</text>`;
                y += 12;
            }
        }
        
        svg += '\n  </g>';
        return svg;
    }

    /**
     * Generate complete SVG preview
     */
    generate(
        entities: PlacedEntity[],
        paths: Path[],
        pois: POI[],
        biomeMap?: BiomeMapCell[][]
    ): string {
        const bgColor = this.options.backgroundColor || '#1a1a2e';
        
        let svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}">
  <rect width="100%" height="100%" fill="${bgColor}" />`;
        
        // Grid lines
        svg += '\n  <!-- Grid -->\n  <g id="grid" opacity="0.1">';
        const gridSize = 50;
        for (let x = this.bounds.minX; x <= this.bounds.maxX; x += gridSize) {
            const pos1 = this.worldToSVG(x, this.bounds.minZ);
            const pos2 = this.worldToSVG(x, this.bounds.maxZ);
            svg += `\n    <line x1="${pos1.x.toFixed(1)}" y1="${pos1.y.toFixed(1)}" x2="${pos2.x.toFixed(1)}" y2="${pos2.y.toFixed(1)}" stroke="#FFFFFF" stroke-width="0.5" />`;
        }
        for (let z = this.bounds.minZ; z <= this.bounds.maxZ; z += gridSize) {
            const pos1 = this.worldToSVG(this.bounds.minX, z);
            const pos2 = this.worldToSVG(this.bounds.maxX, z);
            svg += `\n    <line x1="${pos1.x.toFixed(1)}" y1="${pos1.y.toFixed(1)}" x2="${pos2.x.toFixed(1)}" y2="${pos2.y.toFixed(1)}" stroke="#FFFFFF" stroke-width="0.5" />`;
        }
        svg += '\n  </g>';
        
        // Biome layer
        if (biomeMap) {
            svg += this.generateBiomeLayer(biomeMap);
        }
        
        // Path layer
        svg += this.generatePathLayer(paths);
        
        // Entity layer
        svg += this.generateEntityLayer(entities);
        
        // POI layer
        svg += this.generatePOILayer(pois);
        
        // Legend
        svg += this.generateLegend();
        
        // Info text
        svg += `\n  <!-- Info -->\n  <text x="${this.width - 10}" y="${this.height - 10}" fill="#FFFFFF" font-size="10" text-anchor="end" font-family="sans-serif">Entities: ${entities.length} | Paths: ${paths.length} | POIs: ${pois.length}</text>`;
        
        svg += '\n</svg>';
        
        return svg;
    }

    /**
     * Save SVG to file
     */
    async saveToFile(filepath: string, entities: PlacedEntity[], paths: Path[], pois: POI[], biomeMap?: BiomeMapCell[][]): Promise<void> {
        const svg = this.generate(entities, paths, pois, biomeMap);
        
        if (typeof Deno !== 'undefined') {
            await Deno.writeTextFile(filepath, svg);
        } else {
            const fs = await import('fs/promises');
            await fs.writeFile(filepath, svg, 'utf-8');
        }
    }
}

export default SVGPreviewGenerator;
