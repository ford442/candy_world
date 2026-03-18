/**
 * Perlin/Simplex Noise Implementation for Map Generation
 * Based on classic Perlin noise algorithm with fractal Brownian motion
 */

export class NoiseGenerator {
    private perm: number[] = [];
    private p: number[] = [];
    private seed: number;

    constructor(seed: number = Math.random()) {
        this.seed = seed;
        this.initPermutation();
    }

    private initPermutation(): void {
        // Initialize permutation table based on seed
        const random = this.seededRandom(this.seed);
        
        // Create base permutation table
        this.p = [];
        for (let i = 0; i < 256; i++) {
            this.p[i] = i;
        }

        // Shuffle using seed
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
        }

        // Duplicate for overflow safety
        this.perm = [...this.p, ...this.p];
    }

    private seededRandom(seed: number): () => number {
        let s = seed;
        return () => {
            s = Math.sin(s * 12.9898 + 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
    }

    private fade(t: number): number {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    private grad(hash: number, x: number, y: number, z: number): number {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    /**
     * 2D Perlin noise
     */
    noise2D(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const A = this.perm[X] + Y;
        const AA = this.perm[A];
        const AB = this.perm[A + 1];
        const B = this.perm[X + 1] + Y;
        const BA = this.perm[B];
        const BB = this.perm[B + 1];

        return this.lerp(v,
            this.lerp(u, this.grad(this.perm[AA], x, y, 0),
                this.grad(this.perm[BA], x - 1, y, 0)),
            this.lerp(u, this.grad(this.perm[AB], x, y - 1, 0),
                this.grad(this.perm[BB], x - 1, y - 1, 0))
        );
    }

    /**
     * 3D Perlin noise
     */
    noise3D(x: number, y: number, z: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);

        const u = this.fade(x);
        const v = this.fade(y);
        const w = this.fade(z);

        const A = this.perm[X] + Y;
        const AA = this.perm[A] + Z;
        const AB = this.perm[A + 1] + Z;
        const B = this.perm[X + 1] + Y;
        const BA = this.perm[B] + Z;
        const BB = this.perm[B + 1] + Z;

        return this.lerp(w,
            this.lerp(v,
                this.lerp(u, this.grad(this.perm[AA], x, y, z),
                    this.grad(this.perm[BA], x - 1, y, z)),
                this.lerp(u, this.grad(this.perm[AB], x, y - 1, z),
                    this.grad(this.perm[BB], x - 1, y - 1, z))),
            this.lerp(v,
                this.lerp(u, this.grad(this.perm[AA + 1], x, y, z - 1),
                    this.grad(this.perm[BA + 1], x - 1, y, z - 1)),
                this.lerp(u, this.grad(this.perm[AB + 1], x, y - 1, z - 1),
                    this.grad(this.perm[BB + 1], x - 1, y - 1, z - 1)))
        );
    }

    /**
     * Fractal Brownian Motion - combines multiple octaves of noise
     */
    fbm(x: number, y: number, octaves: number = 4, persistence: number = 0.5, lacunarity: number = 2): number {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            total += this.noise2D(x * frequency, y * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }

    /**
     * Ridged multifractal noise - good for mountains
     */
    ridgedMF(x: number, y: number, octaves: number = 4, persistence: number = 0.5, lacunarity: number = 2): number {
        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            const n = 1 - Math.abs(this.noise2D(x * frequency, y * frequency));
            total += n * n * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        return total / maxValue;
    }

    /**
     * Domain warping - adds organic distortion to noise
     */
    domainWarp(x: number, y: number, warpScale: number = 0.5, warpStrength: number = 20): number {
        const warpX = this.noise2D(x * warpScale, y * warpScale) * warpStrength;
        const warpY = this.noise2D(x * warpScale + 100, y * warpScale + 100) * warpStrength;
        return this.fbm(x + warpX, y + warpY);
    }
}

export interface BiomeDefinition {
    name: string;
    color: string;
    secondaryColor: string;
    noiseScale: number;
    noiseThreshold: number;
    entityWeights: Record<string, number>;
    densityMultiplier: number;
    elevationRange: [number, number];
    decorationChance: number;
}

export const BIOMES: Record<string, BiomeDefinition> = {
    meadow: {
        name: 'Meadow',
        color: '#90EE90',
        secondaryColor: '#98FB98',
        noiseScale: 0.02,
        noiseThreshold: 0.3,
        entityWeights: {
            grass: 50,
            flower: 15,
            mushroom: 8,
            starflower: 5,
            tremolo_tulip: 3,
            vibrato_violet: 3,
            balloon_bush: 2,
            cloud: 1
        },
        densityMultiplier: 1.2,
        elevationRange: [0, 5],
        decorationChance: 0.3
    },
    forest: {
        name: 'Forest',
        color: '#228B22',
        secondaryColor: '#2E8B57',
        noiseScale: 0.015,
        noiseThreshold: 0.4,
        entityWeights: {
            portamento_pine: 20,
            bubble_willow: 12,
            fiber_optic_willow: 10,
            arpeggio_fern: 15,
            prism_rose_bush: 8,
            wisteria_cluster: 5,
            mushroom: 5,
            helix_plant: 5,
            grass: 10,
            snare_trap: 2
        },
        densityMultiplier: 0.9,
        elevationRange: [0, 8],
        decorationChance: 0.5
    },
    lake: {
        name: 'Lake',
        color: '#4169E1',
        secondaryColor: '#00BFFF',
        noiseScale: 0.01,
        noiseThreshold: 0.2,
        entityWeights: {
            subwoofer_lotus: 15,
            accordion_palm: 8,
            bubble_willow: 10,
            floating_orb: 5,
            cloud: 2
        },
        densityMultiplier: 0.5,
        elevationRange: [-2, 2],
        decorationChance: 0.2
    },
    mountain: {
        name: 'Mountain',
        color: '#8B7355',
        secondaryColor: '#A0522D',
        noiseScale: 0.025,
        noiseThreshold: 0.5,
        entityWeights: {
            portamento_pine: 15,
            cymbal_dandelion: 10,
            fiber_optic_willow: 8,
            kick_drum_geyser: 5,
            floating_orb: 3,
            cloud: 2
        },
        densityMultiplier: 0.6,
        elevationRange: [8, 25],
        decorationChance: 0.25
    },
    cave: {
        name: 'Cave',
        color: '#4B0082',
        secondaryColor: '#2F4F4F',
        noiseScale: 0.03,
        noiseThreshold: 0.35,
        entityWeights: {
            mushroom: 20,
            fiber_optic_willow: 10,
            floating_orb: 15,
            helix_plant: 8,
            snare_trap: 3
        },
        densityMultiplier: 0.7,
        elevationRange: [-10, 0],
        decorationChance: 0.4
    },
    neonCorruption: {
        name: 'Neon Corruption',
        color: '#FF1493',
        secondaryColor: '#00FF00',
        noiseScale: 0.04,
        noiseThreshold: 0.3,
        entityWeights: {
            floating_orb: 20,
            fiber_optic_willow: 15,
            helix_plant: 10,
            mushroom: 5,
            kick_drum_geyser: 8,
            cloud: 3
        },
        densityMultiplier: 0.8,
        elevationRange: [0, 10],
        decorationChance: 0.6
    }
};

export interface BiomeMapCell {
    biome: string;
    blendWeight: number;
    elevation: number;
    moisture: number;
    temperature: number;
}

export class BiomeGenerator {
    private noise: NoiseGenerator;
    private elevationNoise: NoiseGenerator;
    private moistureNoise: NoiseGenerator;
    private temperatureNoise: NoiseGenerator;
    private biomeNoise: NoiseGenerator;

    constructor(seed: number) {
        this.noise = new NoiseGenerator(seed);
        this.elevationNoise = new NoiseGenerator(seed + 1);
        this.moistureNoise = new NoiseGenerator(seed + 2);
        this.temperatureNoise = new NoiseGenerator(seed + 3);
        this.biomeNoise = new NoiseGenerator(seed + 4);
    }

    /**
     * Generate elevation at a given position
     */
    getElevation(x: number, z: number): number {
        // Base terrain using domain warped FBM
        const baseElevation = this.elevationNoise.domainWarp(x * 0.01, z * 0.01, 0.3, 5);
        
        // Add mountain ranges using ridged multifractal
        const mountainNoise = this.elevationNoise.ridgedMF(x * 0.005, z * 0.005, 6, 0.5, 2);
        
        // Combine with bias towards flatter areas
        const elevation = (baseElevation * 0.6 + mountainNoise * 0.4);
        
        // Scale to reasonable height range (-20 to 30)
        return elevation * 25 - 5;
    }

    /**
     * Generate moisture level at a given position (0-1)
     */
    getMoisture(x: number, z: number): number {
        return (this.moistureNoise.fbm(x * 0.008, z * 0.008, 4) + 1) * 0.5;
    }

    /**
     * Generate temperature at a given position (0-1, higher at lower elevations)
     */
    getTemperature(x: number, z: number, elevation: number): number {
        const baseTemp = (this.temperatureNoise.fbm(x * 0.006, z * 0.006, 3) + 1) * 0.5;
        const elevationFactor = Math.max(0, 1 - (elevation + 10) / 40); // Colder at higher elevations
        return baseTemp * elevationFactor;
    }

    /**
     * Determine biome at a given position based on elevation, moisture, and temperature
     */
    getBiomeAt(x: number, z: number): { biome: string; blendWeight: number } {
        const elevation = this.getElevation(x, z);
        const moisture = this.getMoisture(x, z);
        const temperature = this.getTemperature(x, z, elevation);
        
        // Add some noise variation
        const variation = (this.biomeNoise.noise2D(x * 0.02, z * 0.02) + 1) * 0.5;

        // Biome selection logic based on environmental factors
        let biome: string;
        
        if (elevation < -2) {
            biome = 'lake';
        } else if (elevation > 15) {
            biome = 'mountain';
        } else if (elevation < -5 && moisture > 0.6) {
            biome = 'cave';
        } else if (temperature > 0.7 && moisture < 0.3 && variation > 0.7) {
            biome = 'neonCorruption';
        } else if (moisture > 0.6) {
            biome = 'forest';
        } else {
            biome = 'meadow';
        }

        // Calculate blend weight for smooth transitions
        const blendWeight = this.calculateBlendWeight(x, z, elevation, moisture, biome);

        return { biome, blendWeight };
    }

    private calculateBlendWeight(x: number, z: number, elevation: number, moisture: number, biome: string): number {
        const biomeDef = BIOMES[biome];
        if (!biomeDef) return 1;

        const [minElev, maxElev] = biomeDef.elevationRange;
        const centerElev = (minElev + maxElev) / 2;
        const elevDist = Math.abs(elevation - centerElev);
        const elevRange = (maxElev - minElev) / 2;
        
        // Smooth falloff at edges of elevation range
        const weight = Math.max(0, 1 - (elevDist / elevRange) * 0.5);
        
        return Math.min(1, weight);
    }

    /**
     * Sample biome map for a region
     */
    sampleBiomeRegion(minX: number, minZ: number, maxX: number, maxZ: number, sampleResolution: number = 10): BiomeMapCell[][] {
        const width = Math.ceil((maxX - minX) / sampleResolution);
        const height = Math.ceil((maxZ - minZ) / sampleResolution);
        const map: BiomeMapCell[][] = [];

        for (let i = 0; i <= width; i++) {
            map[i] = [];
            for (let j = 0; j <= height; j++) {
                const x = minX + i * sampleResolution;
                const z = minZ + j * sampleResolution;
                const elevation = this.getElevation(x, z);
                const moisture = this.getMoisture(x, z);
                const temperature = this.getTemperature(x, z, elevation);
                const { biome, blendWeight } = this.getBiomeAt(x, z);

                map[i][j] = {
                    biome,
                    blendWeight,
                    elevation,
                    moisture,
                    temperature
                };
            }
        }

        return map;
    }

    /**
     * Get all biomes present in a region with their approximate coverage
     */
    getBiomeDistribution(minX: number, minZ: number, maxX: number, maxZ: number): Map<string, number> {
        const distribution = new Map<string, number>();
        const samples = 100;
        
        for (let i = 0; i < samples; i++) {
            const x = minX + Math.random() * (maxX - minX);
            const z = minZ + Math.random() * (maxZ - minZ);
            const { biome } = this.getBiomeAt(x, z);
            distribution.set(biome, (distribution.get(biome) || 0) + 1);
        }

        // Normalize
        for (const [biome, count] of distribution) {
            distribution.set(biome, count / samples);
        }

        return distribution;
    }
}

export default BiomeGenerator;
