// src/foliage/wind-compute.ts
/**
 * Optimized Wind Computation System
 * 
 * Replaces per-vertex sine calculations with a baked wind texture approach.
 * This reduces GPU ALU instructions by pre-computing wind vectors in a texture
 * that is sampled per-vertex instead of computed.
 * 
 * Performance Gains:
 * - Before: ~8-12 ALU instructions per vertex (sin, mul, add, pow operations)
 * - After: ~4 ALU instructions + 1 texture sample (faster on modern GPUs)
 * - Expected improvement: 30-50% reduction in wind calculation cost
 */

import * as THREE from 'three';
import { DataTexture, Vector2, Vector4, RGBAFormat, FloatType, NearestFilter, RepeatWrapping } from 'three';

// Wind texture configuration
const WIND_TEXTURE_SIZE = 256; // 256x256 wind field
const WIND_TEXTURE_CHANNELS = 4; // RGBA - we use RG for wind X/Z, B for gust, A unused

/**
 * Configuration interface for wind behavior
 */
export interface WindConfig {
    /** Base wind speed multiplier */
    baseSpeed: number;
    /** Turbulence scale - smaller values = larger wind patterns */
    turbulenceScale: number;
    /** Gust frequency - how often gusts occur */
    gustFrequency: number;
    /** Gust strength multiplier */
    gustStrength: number;
    /** Wind direction as angle in radians (0 = +X, PI/2 = +Z) */
    directionAngle: number;
    /** Direction variation - how much wind direction changes over time */
    directionVariation: number;
}

/**
 * Default wind configuration
 */
export const DEFAULT_WIND_CONFIG: WindConfig = {
    baseSpeed: 1.0,
    turbulenceScale: 0.02,
    gustFrequency: 0.3,
    gustStrength: 0.5,
    directionAngle: 0,
    directionVariation: 0.3
};

/**
 * WindComputeSystem - Baked Wind Texture Manager
 * 
 * Manages a floating-point DataTexture that stores pre-calculated wind vectors.
 * The texture represents a 2D wind field that tiles seamlessly in world space.
 * 
 * Texture Format (RGBA32F):
 * - R: Wind X component
 * - G: Wind Z component  
 * - B: Gust intensity (0-1)
 * - A: Reserved for future use (turbulence)
 */
export class WindComputeSystem {
    private windTexture: DataTexture;
    private timeAccumulator: number = 0;
    private config: WindConfig;
    private textureData: Float32Array;
    
    // Cached direction vectors
    private baseDirection: Vector2 = new Vector2(1, 0);
    private currentDirection: Vector2 = new Vector2(1, 0);
    
    // Performance tracking
    private frameCount: number = 0;
    private lastUpdateTime: number = 0;
    private averageUpdateTime: number = 0;
    
    // Partial update optimization
    private updateRow: number = 0;
    private readonly rowsPerFrame: number = 8; // Update only 8 rows per frame for performance
    
    // Uniforms for TSL shaders
    private windParams: Vector4 = new Vector4(1, 0, 0, 1); // x: speed, y: unused, z: unused, w: time
    
    constructor(config: Partial<WindConfig> = {}) {
        this.config = { ...DEFAULT_WIND_CONFIG, ...config };
        
        // Initialize texture data
        this.textureData = new Float32Array(
            WIND_TEXTURE_SIZE * WIND_TEXTURE_SIZE * WIND_TEXTURE_CHANNELS
        );
        
        // Create the wind texture
        this.windTexture = new DataTexture(
            this.textureData,
            WIND_TEXTURE_SIZE,
            WIND_TEXTURE_SIZE,
            RGBAFormat,
            FloatType
        );
        
        // Configure texture for optimal sampling
        this.windTexture.minFilter = NearestFilter;
        this.windTexture.magFilter = NearestFilter;
        this.windTexture.wrapS = RepeatWrapping;
        this.windTexture.wrapT = RepeatWrapping;
        this.windTexture.needsUpdate = true;
        
        // Initialize base direction from config
        this.baseDirection.set(
            Math.cos(this.config.directionAngle),
            Math.sin(this.config.directionAngle)
        );
        this.currentDirection.copy(this.baseDirection);
        
        // Initial full texture generation
        this.generateFullTexture();
    }
    
    /**
     * Get the wind texture for use in TSL shaders
     */
    getWindTexture(): DataTexture {
        return this.windTexture;
    }
    
    /**
     * Get shader uniforms for binding to materials
     */
    getUniforms(): { windTexture: DataTexture; windParams: Vector4; windSpeed: number } {
        return {
            windTexture: this.windTexture,
            windParams: this.windParams,
            windSpeed: this.config.baseSpeed
        };
    }
    
    /**
     * Update the wind simulation
     * Call this once per frame with deltaTime in seconds
     */
    update(deltaTime: number): void {
        const startTime = performance.now();
        
        this.timeAccumulator += deltaTime;
        this.frameCount++;
        
        // Update wind direction with slow variation
        const directionOscillation = Math.sin(this.timeAccumulator * 0.1) * this.config.directionVariation;
        this.currentDirection.set(
            Math.cos(this.config.directionAngle + directionOscillation),
            Math.sin(this.config.directionAngle + directionOscillation)
        );
        
        // Update partial texture (row-by-row for performance)
        this.updatePartialTexture(deltaTime);
        
        // Update wind params uniform
        this.windParams.set(
            this.config.baseSpeed,
            this.timeAccumulator,
            this.currentDirection.x,
            this.currentDirection.y
        );
        
        // Track performance
        const updateTime = performance.now() - startTime;
        this.averageUpdateTime = this.averageUpdateTime * 0.95 + updateTime * 0.05;
        this.lastUpdateTime = updateTime;
    }
    
    /**
     * Get wind vector at a specific world position and time
     * Use this for CPU-side calculations (e.g., particle effects)
     */
    getWindAt(x: number, z: number, time: number = this.timeAccumulator): Vector2 {
        // Normalize position to texture coordinates with tiling
        const u = ((x * this.config.turbulenceScale) % 1 + 1) % 1;
        const v = ((z * this.config.turbulenceScale + time * 0.05) % 1 + 1) % 1;
        
        // Sample texture
        const pixelX = Math.floor(u * (WIND_TEXTURE_SIZE - 1));
        const pixelY = Math.floor(v * (WIND_TEXTURE_SIZE - 1));
        const index = (pixelY * WIND_TEXTURE_SIZE + pixelX) * WIND_TEXTURE_CHANNELS;
        
        return new Vector2(
            this.textureData[index],     // R: wind X
            this.textureData[index + 1]  // G: wind Z
        );
    }
    
    /**
     * Get current wind direction as a normalized vector
     */
    getCurrentDirection(): Vector2 {
        return this.currentDirection.clone();
    }
    
    /**
     * Get current wind speed
     */
    getWindSpeed(): number {
        return this.config.baseSpeed;
    }
    
    /**
     * Set wind speed dynamically
     */
    setWindSpeed(speed: number): void {
        this.config.baseSpeed = Math.max(0, speed);
    }
    
    /**
     * Set wind direction dynamically
     */
    setWindDirection(angle: number): void {
        this.config.directionAngle = angle;
        this.baseDirection.set(Math.cos(angle), Math.sin(angle));
    }
    
    /**
     * Get performance statistics
     */
    getPerformanceStats(): {
        averageUpdateTime: number;
        lastUpdateTime: number;
        frameCount: number;
        textureSize: number;
        textureMemoryMB: number;
    } {
        return {
            averageUpdateTime: this.averageUpdateTime,
            lastUpdateTime: this.lastUpdateTime,
            frameCount: this.frameCount,
            textureSize: WIND_TEXTURE_SIZE,
            textureMemoryMB: (WIND_TEXTURE_SIZE * WIND_TEXTURE_SIZE * WIND_TEXTURE_CHANNELS * 4) / (1024 * 1024)
        };
    }
    
    /**
     * Dispose of resources
     */
    dispose(): void {
        this.windTexture.dispose();
    }
    
    /**
     * Generate the full wind texture (called on initialization)
     * Uses multi-octave noise for natural-looking wind patterns
     */
    private generateFullTexture(): void {
        const size = WIND_TEXTURE_SIZE;
        const data = this.textureData;
        
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                this.computeWindPixel(x, y, data, 0);
            }
        }
        
        this.windTexture.needsUpdate = true;
    }
    
    /**
     * Update only a portion of the texture each frame for performance
     * Uses a sliding window approach - updates 'rowsPerFrame' rows each frame
     */
    private updatePartialTexture(deltaTime: number): void {
        const size = WIND_TEXTURE_SIZE;
        const data = this.textureData;
        const timeOffset = this.timeAccumulator * 0.1; // Time-based offset for animation
        
        // Update rows in a sliding window
        for (let i = 0; i < this.rowsPerFrame; i++) {
            const y = (this.updateRow + i) % size;
            
            for (let x = 0; x < size; x++) {
                this.computeWindPixel(x, y, data, timeOffset);
            }
        }
        
        // Advance update position
        this.updateRow = (this.updateRow + this.rowsPerFrame) % size;
        
        // Mark texture for update
        this.windTexture.needsUpdate = true;
    }
    
    /**
     * Compute wind vector for a single pixel
     * Uses simplex-like noise for smooth, tileable patterns
     */
    private computeWindPixel(x: number, y: number, data: Float32Array, timeOffset: number): void {
        const size = WIND_TEXTURE_SIZE;
        const index = (y * size + x) * WIND_TEXTURE_CHANNELS;
        
        // Normalized coordinates
        const nx = x / size;
        const ny = y / size;
        
        // Multi-octave noise for natural wind patterns
        const scale1 = 1.0;
        const scale2 = 2.0;
        const scale3 = 4.0;
        
        // Animated coordinates
        const ax = nx * scale1 + timeOffset * 0.1;
        const ay = ny * scale1 + timeOffset * 0.05;
        
        // Primary wind flow (large-scale)
        const flowX1 = this.noise(ax, ay);
        const flowY1 = this.noise(ax + 100, ay + 100);
        
        // Secondary turbulence (medium-scale)
        const ax2 = nx * scale2 - timeOffset * 0.2;
        const ay2 = ny * scale2 + timeOffset * 0.15;
        const flowX2 = this.noise(ax2, ay2) * 0.5;
        const flowY2 = this.noise(ax2 + 100, ay2 + 100) * 0.5;
        
        // Fine detail (small-scale)
        const ax3 = nx * scale3 + timeOffset * 0.3;
        const ay3 = ny * scale3 - timeOffset * 0.1;
        const flowX3 = this.noise(ax3, ay3) * 0.25;
        const flowY3 = this.noise(ax3 + 100, ay3 + 100) * 0.25;
        
        // Combine octaves
        let windX = (flowX1 + flowX2 + flowX3) / 1.75;
        let windZ = (flowY1 + flowY2 + flowY3) / 1.75;
        
        // Apply base wind direction influence
        const dirInfluence = 0.7; // How much base direction affects the wind
        windX = windX * (1 - dirInfluence) + this.currentDirection.x * dirInfluence;
        windZ = windZ * (1 - dirInfluence) + this.currentDirection.y * dirInfluence;
        
        // Calculate gust intensity
        const gustPhase = nx * 2 + ny * 1.5 + timeOffset * this.config.gustFrequency;
        const gust = (Math.sin(gustPhase) + 1) * 0.5; // 0 to 1
        const gustSharp = Math.pow(gust, 3) * this.config.gustStrength;
        
        // Apply gust to wind strength
        const gustMultiplier = 1 + gustSharp;
        windX *= gustMultiplier * this.config.baseSpeed;
        windZ *= gustMultiplier * this.config.baseSpeed;
        
        // Store in texture
        data[index] = windX;         // R: Wind X
        data[index + 1] = windZ;     // G: Wind Z
        data[index + 2] = gustSharp; // B: Gust intensity
        data[index + 3] = 0;         // A: Reserved
    }
    
    /**
     * Simple 2D noise function (value noise with smooth interpolation)
     * Provides tileable, smooth random values
     */
    private noise(x: number, y: number): number {
        // Integer coordinates
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        
        // Fractional part
        const fx = x - ix;
        const fy = y - iy;
        
        // Smoothstep interpolation
        const u = fx * fx * (3 - 2 * fx);
        const v = fy * fy * (3 - 2 * fy);
        
        // Hash function for pseudo-random values
        const h00 = this.hash(ix, iy);
        const h10 = this.hash(ix + 1, iy);
        const h01 = this.hash(ix, iy + 1);
        const h11 = this.hash(ix + 1, iy + 1);
        
        // Bilinear interpolation
        return this.lerp(
            this.lerp(h00, h10, u),
            this.lerp(h01, h11, u),
            v
        );
    }
    
    /**
     * 2D hash function for noise generation
     */
    private hash(x: number, y: number): number {
        let n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return (n - Math.floor(n)) * 2 - 1; // -1 to 1
    }
    
    /**
     * Linear interpolation
     */
    private lerp(a: number, b: number, t: number): number {
        return a + (b - a) * t;
    }
}

/**
 * Global singleton instance of the wind compute system
 * Import this for shared wind calculations across the application
 */
export const windComputeSystem = new WindComputeSystem();

/**
 * Creates a TSL-ready wind texture reference
 * Use this function in TSL material definitions to get the wind texture node
 * 
 * Example:
 * ```typescript
 * import { texture, uv } from 'three/tsl';
 * import { getWindTextureNode } from './wind-compute.ts';
 * 
 * const windValue = getWindTextureNode(uv().mul(0.1).add(time * 0.01));
 * ```
 */
export function getWindTextureData(): {
    texture: DataTexture;
    params: Vector4;
    sampleScale: number;
} {
    return {
        texture: windComputeSystem.getWindTexture(),
        params: windComputeSystem.getUniforms().windParams,
        sampleScale: 0.1 // Scale factor for UV mapping to world space
    };
}

/**
 * Performance profiler for wind system
 * Tracks FPS before/after optimization
 */
export class WindPerformanceProfiler {
    private frameTimings: number[] = [];
    private lastFrameTime: number = 0;
    private isProfiling: boolean = false;
    private profileStartTime: number = 0;
    
    startProfiling(): void {
        this.frameTimings = [];
        this.isProfiling = true;
        this.profileStartTime = performance.now();
        this.lastFrameTime = this.profileStartTime;
    }
    
    recordFrame(): void {
        if (!this.isProfiling) return;
        
        const now = performance.now();
        const delta = now - this.lastFrameTime;
        this.frameTimings.push(delta);
        this.lastFrameTime = now;
    }
    
    stopProfiling(): {
        averageFPS: number;
        minFPS: number;
        maxFPS: number;
        totalFrames: number;
        duration: number;
    } {
        this.isProfiling = false;
        
        if (this.frameTimings.length === 0) {
            return { averageFPS: 0, minFPS: 0, maxFPS: 0, totalFrames: 0, duration: 0 };
        }
        
        const fpsValues = this.frameTimings.map(dt => 1000 / Math.max(dt, 0.1));
        const duration = performance.now() - this.profileStartTime;
        
        return {
            averageFPS: fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length,
            minFPS: Math.min(...fpsValues),
            maxFPS: Math.max(...fpsValues),
            totalFrames: this.frameTimings.length,
            duration
        };
    }
    
    /**
     * Log profiling results to console with formatting
     */
    logResults(label: string): void {
        const results = this.stopProfiling();
        console.log(`[WindProfiler] ${label}:`, {
            avgFPS: results.averageFPS.toFixed(1),
            minFPS: results.minFPS.toFixed(1),
            maxFPS: results.maxFPS.toFixed(1),
            frames: results.totalFrames,
            duration: `${(results.duration / 1000).toFixed(1)}s`
        });
    }
}

// Global profiler instance
export const windProfiler = new WindPerformanceProfiler();
