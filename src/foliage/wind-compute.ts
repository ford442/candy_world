import * as THREE from 'three';
import { DataTexture, Vector2, Vector4, RGBAFormat, FloatType, NearestFilter, RepeatWrapping } from 'three';
import { textureStore, instanceIndex, Fn, float, vec4, vec2, ivec2, mx_noise_float, sin, cos, max, min, uniform } from 'three/tsl';
import { StorageTexture } from 'three/webgpu';

// Wind texture configuration
export const WIND_TEXTURE_SIZE = 256; // 256x256 wind field
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
 * WindComputeSystem - WebGPU Compute Shader Edition
 * 
 * Replaces CPU noise generation with a WebGPU Compute Shader that writes
 * to a StorageTexture. This removes the JS CPU bottleneck and updates
 * the entire 256x256 texture every frame.
 */
export class WindComputeSystem {
    private windTexture: THREE.Texture;
    private timeAccumulator: number = 0;
    private config: WindConfig;
    
    // Cached direction vectors
    private baseDirection: Vector2 = new Vector2(1, 0);
    private currentDirection: Vector2 = new Vector2(1, 0);
    
    // Performance tracking
    private frameCount: number = 0;
    private lastUpdateTime: number = 0;
    private averageUpdateTime: number = 0;
    
    // Uniforms for TSL shaders
    private windParams: Vector4 = new Vector4(1, 0, 0, 1); // x: speed, y: unused, z: unused, w: time
    
    // Compute specific uniforms
    private uTime = uniform(0);
    private uWindSpeed = uniform(1.0);
    private uWindDirection = uniform(vec2(1, 0));
    private uGustFreq = uniform(0.3);
    private uGustStrength = uniform(0.5);

    private _computeNode: any;

    constructor(config: Partial<WindConfig> = {}) {
        this.config = { ...DEFAULT_WIND_CONFIG, ...config };
        
        // Create the storage texture for compute shader
        const storageTexture = new StorageTexture(WIND_TEXTURE_SIZE, WIND_TEXTURE_SIZE);
        storageTexture.type = FloatType;
        storageTexture.minFilter = NearestFilter;
        storageTexture.magFilter = NearestFilter;
        storageTexture.wrapS = RepeatWrapping;
        storageTexture.wrapT = RepeatWrapping;
        this.windTexture = storageTexture;
        
        // Initialize base direction from config
        this.baseDirection.set(
            Math.cos(this.config.directionAngle),
            Math.sin(this.config.directionAngle)
        );
        this.currentDirection.copy(this.baseDirection);
        this.uWindDirection.value.copy(this.currentDirection);
        
        this.initComputeNode();
    }

    /**
     * Initializes the TSL Compute Node for wind generation
     */
    private initComputeNode() {
        const size = float(WIND_TEXTURE_SIZE);

        const computeWind = Fn(() => {
            const index = float(instanceIndex);
            const sizeInt = WIND_TEXTURE_SIZE;

            // Using int math for 2D coord to avoid precision issues
            const x = index.mod(sizeInt);
            const y = index.div(sizeInt).floor();

            // Normalized coordinates
            const nx = x.div(size);
            const ny = y.div(size);

            // Time offset
            const timeOffset = this.uTime.mul(0.1);

            // Multi-octave noise for natural wind patterns
            const scale1 = float(1.0);
            const scale2 = float(2.0);
            const scale3 = float(4.0);

            // Primary wind flow (large-scale)
            const ax1 = nx.mul(scale1).add(timeOffset.mul(0.1));
            const ay1 = ny.mul(scale1).add(timeOffset.mul(0.05));
            const flowX1 = mx_noise_float(vec2(ax1, ay1));
            const flowY1 = mx_noise_float(vec2(ax1.add(100.0), ay1.add(100.0)));

            // Secondary turbulence (medium-scale)
            const ax2 = nx.mul(scale2).sub(timeOffset.mul(0.2));
            const ay2 = ny.mul(scale2).add(timeOffset.mul(0.15));
            const flowX2 = mx_noise_float(vec2(ax2, ay2)).mul(0.5);
            const flowY2 = mx_noise_float(vec2(ax2.add(100.0), ay2.add(100.0))).mul(0.5);

            // Fine detail (small-scale)
            const ax3 = nx.mul(scale3).add(timeOffset.mul(0.3));
            const ay3 = ny.mul(scale3).sub(timeOffset.mul(0.1));
            const flowX3 = mx_noise_float(vec2(ax3, ay3)).mul(0.25);
            const flowY3 = mx_noise_float(vec2(ax3.add(100.0), ay3.add(100.0))).mul(0.25);

            // Combine octaves
            let windX = flowX1.add(flowX2).add(flowX3).div(1.75);
            let windZ = flowY1.add(flowY2).add(flowY3).div(1.75);

            // Apply base wind direction influence
            const dirInfluence = float(0.7); // How much base direction affects the wind
            windX = windX.mul(float(1.0).sub(dirInfluence)).add(this.uWindDirection.x.mul(dirInfluence));
            windZ = windZ.mul(float(1.0).sub(dirInfluence)).add(this.uWindDirection.y.mul(dirInfluence));

            // Calculate gust intensity
            const gustPhase = nx.mul(2.0).add(ny.mul(1.5)).add(timeOffset.mul(this.uGustFreq));
            const gust = sin(gustPhase).add(1.0).mul(0.5); // 0 to 1
            const gustSharp = gust.pow(3.0).mul(this.uGustStrength);

            // Apply gust to wind strength
            const gustMultiplier = float(1.0).add(gustSharp);
            windX = windX.mul(gustMultiplier).mul(this.uWindSpeed);
            windZ = windZ.mul(gustMultiplier).mul(this.uWindSpeed);

            // Store in texture (RGBA)
            const outColor = vec4(windX, windZ, gustSharp, 0.0);

            // Convert x, y back to int coordinates for textureStore
            const ivec2_coords = ivec2(x, y);
            textureStore(this.windTexture as StorageTexture, ivec2_coords, outColor);
        });

        // Dispatch one thread per pixel
        this._computeNode = computeWind().compute(WIND_TEXTURE_SIZE * WIND_TEXTURE_SIZE);
    }

    /**
     * Get the compute node to be dispatched by the renderer
     */
    getComputeNode() {
        return this._computeNode;
    }
    
    /**
     * Get the wind texture for use in TSL shaders
     */
    getWindTexture(): THREE.Texture {
        return this.windTexture;
    }
    
    /**
     * Get shader uniforms for binding to materials
     */
    getUniforms(): { windTexture: THREE.Texture; windParams: Vector4; windSpeed: number } {
        return {
            windTexture: this.windTexture,
            windParams: this.windParams,
            windSpeed: this.config.baseSpeed
        };
    }
    
    /**
     * Update the wind simulation parameters
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
        
        // Update uniforms for the compute shader
        this.uTime.value = this.timeAccumulator;
        this.uWindSpeed.value = this.config.baseSpeed;
        this.uWindDirection.value.copy(this.currentDirection);
        this.uGustFreq.value = this.config.gustFrequency;
        this.uGustStrength.value = this.config.gustStrength;
        
        // Update wind params uniform for materials
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
     * NOTE: Since texture is on GPU, we emulate the base noise on CPU for immediate reads
     * if required by physics. This provides a fast approximation.
     */
    getWindAt(x: number, z: number, time: number = this.timeAccumulator): Vector2 {
        // Approximate the wind direction and speed for CPU side effects
        // Full noise is calculated on GPU, so we use a simplified version here
        const gustPhase = (x * 0.01) * 2 + (z * 0.01) * 1.5 + (time * 0.1) * this.config.gustFrequency;
        const gust = (Math.sin(gustPhase) + 1) * 0.5; // 0 to 1
        const gustSharp = Math.pow(gust, 3) * this.config.gustStrength;
        
        const gustMultiplier = 1.0 + gustSharp;
        
        return new Vector2(
            this.currentDirection.x * gustMultiplier * this.config.baseSpeed,
            this.currentDirection.y * gustMultiplier * this.config.baseSpeed
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
    texture: THREE.Texture;
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
