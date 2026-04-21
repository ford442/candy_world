/**
 * @file compute-particle-integration.ts
 * @description Integration helpers for migrating to compute particle systems
 * 
 * This module provides drop-in replacements for existing particle systems
 * with automatic fallback and performance monitoring.
 */

import * as THREE from 'three';
import { ComputeParticleSystem, createComputeFireflies,
    createComputeSparks, createComputePollen } from './compute-particles.ts';
import type { ParticleAudioData } from './compute-particles.ts';
import { createFireflies as createLegacyFireflies } from '../foliage/fireflies.ts';
import { createNeonPollen as createLegacyPollen } from '../foliage/pollen.ts';

// =============================================================================
// PERFORMANCE MONITORING
// =============================================================================

interface PerformanceMetrics {
    particleCount: number;
    frameTime: number;
    gpuTime: number;
    cpuFallback: boolean;
}

const metrics: Map<string, PerformanceMetrics> = new Map();

export function getParticleMetrics(systemId: string): PerformanceMetrics | undefined {
    return metrics.get(systemId);
}

export function getAllParticleMetrics(): Map<string, PerformanceMetrics> {
    return new Map(metrics);
}

// =============================================================================
// DROP-IN REPLACEMENTS
// =============================================================================

export interface IntegratedFireflyOptions {
    count?: number;
    areaSize?: number;
    useCompute?: boolean;  // Default: true if WebGPU available
}

/**
 * Drop-in replacement for createFireflies from foliage/fireflies.ts
 * Automatically uses GPU compute when available
 */
export function createIntegratedFireflies(options: IntegratedFireflyOptions = {}): THREE.Object3D {
    const { 
        count = 150, 
        areaSize = 100,
        useCompute = true 
    } = options;
    
    // Check for WebGPU support
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    
    if (useCompute && hasWebGPU) {
        // Use GPU compute - 300x more particles!
        const computeCount = Math.min(count * 300, 100000); // Cap at 100k
        
        try {
            const system = createComputeFireflies({
                count: computeCount,
                bounds: { x: areaSize, y: 15, z: areaSize },
                center: new THREE.Vector3(0, 3, 0)
            });
            
            // Track metrics
            metrics.set('fireflies', {
                particleCount: computeCount,
                frameTime: 0,
                gpuTime: 0,
                cpuFallback: false
            });
            
            console.log(`[Particles] GPU Fireflies: ${computeCount.toLocaleString()} particles`);
            
            return system.mesh;
        } catch (error) {
            console.warn('[Particles] GPU compute failed, falling back to CPU:', error);
        }
    }
    
    // Fallback to legacy CPU-based fireflies
    const legacy = createLegacyFireflies(count, areaSize);
    
    metrics.set('fireflies', {
        particleCount: count,
        frameTime: 0,
        gpuTime: 0,
        cpuFallback: true
    });
    
    console.log(`[Particles] CPU Fireflies: ${count} particles (WebGPU unavailable or disabled)`);
    
    return legacy;
}

export interface IntegratedPollenOptions {
    count?: number;
    areaSize?: number;
    center?: THREE.Vector3;
    useCompute?: boolean;
}

/**
 * Drop-in replacement for createNeonPollen from foliage/pollen.ts
 * Automatically uses GPU compute when available
 */
export function createIntegratedPollen(options: IntegratedPollenOptions = {}): THREE.Object3D {
    const {
        count = 2000,
        areaSize = 30,
        center = new THREE.Vector3(0, 5, 0),
        useCompute = true
    } = options;
    
    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
    
    if (useCompute && hasWebGPU) {
        const computeCount = Math.min(count * 15, 50000);
        
        try {
            const system = createComputePollen({
                count: computeCount,
                bounds: { x: areaSize * 2, y: 20, z: areaSize * 2 },
                center: center
            });
            
            metrics.set('pollen', {
                particleCount: computeCount,
                frameTime: 0,
                gpuTime: 0,
                cpuFallback: false
            });
            
            console.log(`[Particles] GPU Pollen: ${computeCount.toLocaleString()} particles`);
            
            return system.mesh;
        } catch (error) {
            console.warn('[Particles] GPU compute failed, falling back to CPU:', error);
        }
    }
    
    // Fallback to legacy
    const legacy = createLegacyPollen(count, areaSize, center);
    
    metrics.set('pollen', {
        particleCount: count,
        frameTime: 0,
        gpuTime: 0,
        cpuFallback: true
    });
    
    console.log(`[Particles] CPU Pollen: ${count} particles`);
    
    return legacy;
}


export interface IntegratedSparksOptions {
    count?: number;
    areaSize?: number;
    center?: THREE.Vector3;
    useCompute?: boolean;
}

/**
 * Creates an environmental sparks system using GPU compute
 */
export function createIntegratedSparks(options: IntegratedSparksOptions = {}): THREE.Object3D {
    const {
        count = 1000,
        areaSize = 50,
        center = new THREE.Vector3(0, 10, 0),
        useCompute = true
    } = options;

    const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (useCompute && hasWebGPU) {
        const computeCount = Math.min(count * 5, 20000);

        try {
            // Use the GPU compute path
            const system = createComputeSparks({
                count: computeCount,
                bounds: { x: areaSize * 2, y: 20, z: areaSize * 2 },
                center: center
            });

            metrics.set('sparks', {
                particleCount: computeCount,
                frameTime: 0,
                gpuTime: 0,
                cpuFallback: false
            });

            console.log(`[Particles] GPU Sparks: ${computeCount.toLocaleString()} particles`);

            return system.mesh;
        } catch (error) {
            console.warn('[Particles] GPU compute failed for sparks, returning empty object:', error);
        }
    }

    // Fallback: Return empty object if no CPU legacy implementation exists for environmental sparks yet
    console.log(`[Particles] CPU Sparks: Not implemented, returning empty Group.`);
    return new THREE.Group();
}

// =============================================================================
// SYSTEM REGISTRY
// =============================================================================

interface IntegratedSystem {
    mesh: THREE.Object3D;
    system?: ComputeParticleSystem;
    update: (renderer: THREE.Renderer, deltaTime: number, playerPosition: THREE.Vector3, audioData: ParticleAudioData) => void;
}

const activeSystems: Map<string, IntegratedSystem> = new Map();

export function registerIntegratedSystem(
    id: string, 
    mesh: THREE.Object3D, 
    system?: ComputeParticleSystem
): void {
    const integrated: IntegratedSystem = {
        mesh,
        system,
        update: (renderer, deltaTime, playerPosition, audioData) => {
            if (system) {
                const startTime = performance.now();
                system.update(renderer, deltaTime, playerPosition, audioData);
                const frameTime = performance.now() - startTime;
                
                // Update metrics
                const metric = metrics.get(id);
                if (metric) {
                    metric.frameTime = frameTime;
                }
            }
        }
    };
    
    activeSystems.set(id, integrated);
}

export function updateAllIntegratedSystems(
    renderer: THREE.Renderer,
    deltaTime: number,
    playerPosition: THREE.Vector3,
    audioData: ParticleAudioData
): void {
    for (const [id, system] of activeSystems) {
        system.update(renderer, deltaTime, playerPosition, audioData);
    }
}

export function disposeIntegratedSystem(id: string): void {
    const system = activeSystems.get(id);
    if (system) {
        if (system.system) {
            system.system.dispose();
        }
        activeSystems.delete(id);
        metrics.delete(id);
    }
}

export function disposeAllIntegratedSystems(): void {
    for (const [id] of activeSystems) {
        disposeIntegratedSystem(id);
    }
}

// =============================================================================
// DEFERRED LOADING
// =============================================================================

interface DeferredSystemConfig {
    id: string;
    type: 'fireflies' | 'pollen' | 'rain' | 'sparks' | 'berries';
    options: any;
    priority: number;  // Lower = load first
}

const deferredQueue: DeferredSystemConfig[] = [];
let isLoading = false;

export function queueDeferredSystem(config: DeferredSystemConfig): void {
    deferredQueue.push(config);
    deferredQueue.sort((a, b) => a.priority - b.priority);
}

export async function loadDeferredSystems(
    scene: THREE.Scene,
    onProgress?: (loaded: number, total: number) => void
): Promise<void> {
    if (isLoading) return;
    isLoading = true;
    
    const total = deferredQueue.length;
    let loaded = 0;
    
    for (const config of deferredQueue) {
        try {
            let mesh: THREE.Object3D;
            let system: ComputeParticleSystem | undefined;
            
            switch (config.type) {
                case 'fireflies':
                    mesh = createIntegratedFireflies(config.options);
                    system = (mesh as any).userData?.computeParticleSystem;
                    break;
                case 'pollen':
                    mesh = createIntegratedPollen(config.options);
                    system = (mesh as any).userData?.computeParticleSystem;
                    break;
                case 'sparks':
                    mesh = createIntegratedSparks(config.options);
                    system = (mesh as any).userData?.computeParticleSystem;
                    break;
                default:
                    console.warn(`[Particles] Unknown deferred type: ${config.type}`);
                    continue;
            }
            
            scene.add(mesh);
            registerIntegratedSystem(config.id, mesh, system);
            
            loaded++;
            onProgress?.(loaded, total);
            
            // Yield to prevent frame drops
            await new Promise(resolve => setTimeout(resolve, 0));
            
        } catch (error) {
            console.error(`[Particles] Failed to load deferred system ${config.id}:`, error);
        }
    }
    
    deferredQueue.length = 0;
    isLoading = false;
}

// =============================================================================
// BENCHMARKING
// =============================================================================

export interface BenchmarkResult {
    type: string;
    count: number;
    avgFrameTime: number;
    minFrameTime: number;
    maxFrameTime: number;
    targetFps: number;
    actualFps: number;
    recommendation: string;
}

export async function benchmarkParticleSystem(
    renderer: THREE.Renderer,
    type: 'fireflies' | 'pollen' | 'rain' | 'sparks' | 'berries',
    testCounts: number[] = [1000, 5000, 10000, 50000, 100000]
): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = [];
    const dummyPlayer = new THREE.Vector3(0, 0, 0);
    const dummyAudio: ParticleAudioData = {
        low: 0.5,
        mid: 0.3,
        high: 0.2,
        beat: false,
        groove: 0.5,
        windX: 1,
        windZ: 0,
        windSpeed: 0.5
    };
    
    for (const count of testCounts) {
        try {
            let system: ComputeParticleSystem | null = null;
            
            switch (type) {
                case 'fireflies':
                    system = createComputeFireflies({ count });
                    break;
                case 'pollen':
                    system = createComputePollen({ count });
                    break;
                case 'rain':
                    // Rain would need its own create function
                    continue;
                default:
                    continue;
            }
            
            if (!system) continue;
            
            // Warm up
            for (let i = 0; i < 10; i++) {
                system.update(renderer, 0.016, dummyPlayer, dummyAudio);
            }
            
            // Benchmark
            const frameTimes: number[] = [];
            const iterations = 60;
            
            for (let i = 0; i < iterations; i++) {
                const start = performance.now();
                system.update(renderer, 0.016, dummyPlayer, dummyAudio);
                frameTimes.push(performance.now() - start);
            }
            
            const avgTime = frameTimes.reduce((a, b) => a + b, 0) / iterations;
            const minTime = Math.min(...frameTimes);
            const maxTime = Math.max(...frameTimes);
            const targetFps = 60;
            const actualFps = 1000 / avgTime;
            
            let recommendation = 'Optimal';
            if (actualFps < 30) recommendation = 'Too heavy - reduce count';
            else if (actualFps < 55) recommendation = 'Acceptable - monitor performance';
            
            results.push({
                type,
                count,
                avgFrameTime: avgTime,
                minFrameTime: minTime,
                maxFrameTime: maxTime,
                targetFps,
                actualFps: Math.min(actualFps, targetFps),
                recommendation
            });
            
            system.dispose();
            
        } catch (error) {
            console.warn(`[Benchmark] Failed at count ${count}:`, error);
            break;
        }
    }
    
    return results;
}

export function printBenchmarkResults(results: BenchmarkResult[]): void {
    console.log('\n=== Particle System Benchmark ===\n');
    console.table(results.map(r => ({
        Count: r.count.toLocaleString(),
        'Avg ms': r.avgFrameTime.toFixed(3),
        'FPS': r.actualFps.toFixed(1),
        Recommendation: r.recommendation
    })));
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    ComputeParticleSystem,
    createComputeFireflies,
    createComputePollen,
    type ParticleAudioData
} from './compute-particles.ts';
