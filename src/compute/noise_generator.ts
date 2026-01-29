/**
 * @file noise_generator.ts
 * @description Procedural noise generation for terrain and textures
 * 
 * Provides CPU-based FBM (Fractal Brownian Motion) noise generation
 * for terrain heightmaps and candy swirl patterns.
 * 
 * @example
 * ```ts
 * import { ProceduralNoiseCompute } from './noise_generator';
 * 
 * const noise = new ProceduralNoiseCompute(256, 256);
 * noise.setScale(2.0);
 * noise.setOctaves(6);
 * 
 * const texture = noise.createTexture();
 * material.map = texture;
 * ```
 */

import * as THREE from 'three';
import { uniform } from 'three/tsl';

/**
 * Configuration for procedural noise generation
 */
export interface NoiseConfig {
    /** Width of the noise texture (default: 256) */
    readonly width?: number;
    /** Height of the noise texture (default: 256) */
    readonly height?: number;
    /** Noise scale factor (default: 1.0) */
    readonly scale?: number;
    /** Number of octaves for FBM (default: 4) */
    readonly octaves?: number;
    /** Initial amplitude for FBM (default: 0.5) */
    readonly amplitude?: number;
    /** Frequency multiplier between octaves (default: 2.0) */
    readonly lacunarity?: number;
    /** Amplitude multiplier between octaves (default: 0.5) */
    readonly persistence?: number;
}

/**
 * Procedural noise generator using FBM.
 * Generates candy swirl patterns for terrain textures.
 */
export class ProceduralNoiseCompute {
    /** Texture width */
    public readonly width: number;
    
    /** Texture height */
    public readonly height: number;
    
    /** RGBA data buffer */
    private data: Float32Array;
    
    /** Scale uniform for shader integration */
    public readonly uScale = uniform(1.0);
    
    /** Octaves uniform for shader integration */
    public readonly uOctaves = uniform(4);
    
    /** Time uniform for animated noise */
    public readonly uTime = uniform(0.0);

    /** Lacunarity (frequency multiplier) */
    private lacunarity: number;

    /** Persistence (amplitude multiplier) */
    private persistence: number;

    /**
     * Creates a new procedural noise generator.
     * 
     * @param width - Texture width (default: 256)
     * @param height - Texture height (default: 256)
     * @param config - Additional configuration
     */
    constructor(width: number = 256, height: number = 256, config: NoiseConfig = {}) {
        this.width = width;
        this.height = height;
        this.data = new Float32Array(width * height * 4); // RGBA

        const {
            scale = 1.0,
            octaves = 4,
            lacunarity = 2.0,
            persistence = 0.5
        } = config;

        this.uScale.value = scale;
        this.uOctaves.value = octaves;
        this.lacunarity = lacunarity;
        this.persistence = persistence;
    }

    /**
     * Set the noise scale.
     * @param scale - Scale factor (higher = more zoomed out)
     */
    public setScale(scale: number): void {
        this.uScale.value = scale;
    }

    /**
     * Set the number of octaves for FBM.
     * @param octaves - Number of noise layers (1-8 recommended)
     */
    public setOctaves(octaves: number): void {
        this.uOctaves.value = Math.max(1, Math.min(8, octaves));
    }

    /**
     * Simple hash function for noise generation.
     * 
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Hash value in range [0, 1]
     */
    private hash(x: number, y: number): number {
        const n = x * 374761393 + y * 668265263;
        return ((n ^ (n >> 13)) & 0x7fffffff) / 0x7fffffff;
    }

    /**
     * Linear interpolation.
     */
    private lerp(t: number, a: number, b: number): number {
        return a + t * (b - a);
    }

    /**
     * 2D value noise function.
     * 
     * @param x - X coordinate
     * @param y - Y coordinate
     * @returns Noise value in range [0, 1]
     */
    public noise2D(x: number, y: number): number {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        // Smoothstep interpolation
        const u = x * x * (3 - 2 * x);
        const v = y * y * (3 - 2 * y);

        // Get corner values
        const a = this.hash(X, Y);
        const b = this.hash(X + 1, Y);
        const c = this.hash(X, Y + 1);
        const d = this.hash(X + 1, Y + 1);

        // Bilinear interpolation
        return this.lerp(v,
            this.lerp(u, a, b),
            this.lerp(u, c, d)
        );
    }

    /**
     * Fractal Brownian Motion noise.
     * Combines multiple octaves of noise for more natural results.
     * 
     * @param x - X coordinate
     * @param y - Y coordinate
     * @param octaves - Number of noise layers
     * @returns FBM noise value in range [0, 1]
     */
    public fbm(x: number, y: number, octaves?: number): number {
        const oct = octaves ?? this.uOctaves.value;
        let value = 0;
        let amplitude = 0.5;
        let frequency = 1.0;

        for (let i = 0; i < oct; i++) {
            value += amplitude * this.noise2D(x * frequency, y * frequency);
            frequency *= this.lacunarity;
            amplitude *= this.persistence;
        }

        return value;
    }

    /**
     * Generates the noise texture data.
     * Creates a candy swirl pattern using FBM noise.
     */
    public generate(): void {
        const scale = this.uScale.value || 1.0;
        const octaves = this.uOctaves.value || 4;

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const i = (y * this.width + x) * 4;

                // Normalized coordinates
                const nx = (x / this.width) * scale;
                const ny = (y / this.height) * scale;

                // Generate base noise
                const noise = this.fbm(nx, ny, octaves);

                // Create candy swirl pattern
                const swirl = Math.sin(nx * 10 + noise * 3) * 0.5 + 0.5;
                
                // Generate pastel candy colors
                const r = noise * 0.5 + swirl * 0.5;
                const g = noise * 0.7 + (1 - swirl) * 0.3;
                const b = noise * 0.3 + swirl * 0.7;

                this.data[i] = r;
                this.data[i + 1] = g;
                this.data[i + 2] = b;
                this.data[i + 3] = 1.0;
            }
        }
    }

    /**
     * Creates a Three.js DataTexture from the generated noise.
     * 
     * @returns A DataTexture with the noise pattern
     */
    public createTexture(): THREE.DataTexture {
        this.generate();

        const texture = new THREE.DataTexture(
            this.data,
            this.width,
            this.height,
            THREE.RGBAFormat,
            THREE.FloatType
        );
        
        texture.needsUpdate = true;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;

        return texture;
    }

    /**
     * Get a single height value at coordinates.
     * Useful for terrain sampling.
     * 
     * @param x - X coordinate (world space)
     * @param z - Z coordinate (world space)
     * @param scale - Optional scale override
     * @returns Height value
     */
    public getHeight(x: number, z: number, scale?: number): number {
        const s = scale ?? this.uScale.value;
        return this.fbm(x * s, z * s);
    }

    /**
     * Dispose of resources.
     */
    public dispose(): void {
        this.data = new Float32Array(0);
    }
}

/**
 * Creates a simple candy swirl texture.
 * Convenience function for quick texture generation.
 * 
 * @param width - Texture width
 * @param height - Texture height
 * @param scale - Noise scale
 * @returns A DataTexture with candy swirl pattern
 */
export function createCandySwirlTexture(
    width: number = 256,
    height: number = 256,
    scale: number = 1.0
): THREE.DataTexture {
    const noise = new ProceduralNoiseCompute(width, height, { scale });
    const texture = noise.createTexture();
    noise.dispose();
    return texture;
}
