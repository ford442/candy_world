/**
 * @file mesh_deformation_wasm.ts
 * @brief WASM-accelerated mesh deformation wrapper
 * 
 * Provides a TypeScript interface to the C++/SIMD mesh deformation functions.
 * Falls back to JavaScript implementation when WASM is not available.
 * 
 * @example
 * ```ts
 * import { WasmMeshDeformation } from './mesh_deformation_wasm';
 * 
 * const deformer = new WasmMeshDeformation(geometry, 'wave');
 * deformer.setStrength(1.5);
 * 
 * // In animation loop:
 * deformer.update(time, { kick: audioState.kickTrigger });
 * ```
 */

import * as THREE from 'three';
import { getNativeFunc, getWasmMemory } from '../utils/wasm-loader.js';
import { MeshDeformationCompute, DeformationType, DeformationTypeValue, DeformationAudioState } from './mesh_deformation.ts';

/**
 * Configuration for WASM mesh deformation
 */
export interface WasmDeformationConfig {
    /** Type of deformation effect */
    type: DeformationTypeValue;
    /** Effect strength multiplier (default: 1.0) */
    strength?: number;
    /** Wave/wobble frequency (default: 1.0) */
    frequency?: number;
    /** Enable audio reactivity (default: true) */
    audioReactive?: boolean;
    /** Recompute vertex normals after deformation (default: false for perf) */
    recomputeNormals?: boolean;
}

/**
 * WASM-accelerated mesh deformation
 * Uses C++ SIMD when available, falls back to JS
 */
export class WasmMeshDeformation {
    public readonly geometry: THREE.BufferGeometry;
    public readonly type: DeformationTypeValue;
    
    private originalPositions: Float32Array;
    private positions: Float32Array;
    private normals?: Float32Array;
    private indices?: Uint16Array;
    
    // WASM memory buffers
    private wasmPosPtr: number = 0;
    private wasmOrigPtr: number = 0;
    private wasmNormalPtr: number = 0;
    private wasmIndexPtr: number = 0;
    
    // Configuration
    private strength: number;
    private frequency: number;
    private audioReactive: boolean;
    private shouldRecomputeNormals: boolean;
    
    // WASM functions
    private wasmDeformWave: ((pos: number, orig: number, count: number, time: number, freq: number, strength: number, audio: number) => void) | null = null;
    private wasmDeformJiggle: ((pos: number, orig: number, count: number, time: number, strength: number, audio: number) => void) | null = null;
    private wasmDeformWobble: ((pos: number, orig: number, count: number, time: number, strength: number, audio: number) => void) | null = null;
    private wasmRecomputeNormals: ((pos: number, normal: number, indices: number, count: number) => void) | null = null;
    
    // Fallback JS implementation
    private jsFallback: MeshDeformationCompute;
    
    // State
    private useWasm: boolean = false;
    private vertexCount: number = 0;
    
    constructor(geometry: THREE.BufferGeometry, config: WasmDeformationConfig) {
        this.geometry = geometry;
        this.type = config.type;
        this.strength = config.strength ?? 1.0;
        this.frequency = config.frequency ?? 1.0;
        this.audioReactive = config.audioReactive ?? true;
        this.shouldRecomputeNormals = config.recomputeNormals ?? false;
        
        // Get position attribute
        const posAttr = geometry.attributes.position;
        if (!posAttr) {
            throw new Error('Geometry must have position attribute');
        }
        
        this.positions = posAttr.array as Float32Array;
        this.originalPositions = this.positions.slice();
        this.vertexCount = posAttr.count;
        
        // Get normals if they exist
        if (geometry.attributes.normal) {
            this.normals = (geometry.attributes.normal.array as Float32Array);
        }
        
        // Get indices if indexed geometry
        if (geometry.index) {
            this.indices = geometry.index.array as Uint16Array;
        }
        
        // Try to initialize WASM
        this.initWasm();
        
        // Create JS fallback
        this.jsFallback = new MeshDeformationCompute(geometry, this.type, {
            strength: this.strength,
            frequency: this.frequency,
            audioReactive: this.audioReactive,
            recomputeNormals: this.shouldRecomputeNormals
        });
    }
    
    /**
     * Initialize WASM memory and function bindings
     */
    private initWasm(): void {
        // Check if WASM functions are available
        this.wasmDeformWave = getNativeFunc('deformMeshWave') as any;
        this.wasmDeformJiggle = getNativeFunc('deformMeshJiggle') as any;
        this.wasmDeformWobble = getNativeFunc('deformMeshWobble') as any;
        this.wasmRecomputeNormals = getNativeFunc('recomputeNormals') as any;
        
        // Only use WASM if we have the right function for our type
        const hasRequiredFunc = 
            (this.type === DeformationType.WAVE && this.wasmDeformWave) ||
            (this.type === DeformationType.JIGGLE && this.wasmDeformJiggle) ||
            (this.type === DeformationType.WOBBLE && this.wasmDeformWobble);
        
        if (!hasRequiredFunc) {
            console.log(`[WasmMeshDeformation] WASM not available for type '${this.type}', using JS fallback`);
            return;
        }
        
        // Allocate WASM memory
        const memory = getWasmMemory();
        if (!memory) {
            console.log('[WasmMeshDeformation] WASM memory not available, using JS fallback');
            return;
        }
        
        try {
            // Allocate space for positions (3 floats per vertex)
            const posSize = this.vertexCount * 3 * 4; // 4 bytes per float
            this.wasmPosPtr = (memory as any).malloc(posSize);
            this.wasmOrigPtr = (memory as any).malloc(posSize);
            
            if (this.normals && this.shouldRecomputeNormals) {
                this.wasmNormalPtr = (memory as any).malloc(posSize);
            }
            
            if (this.indices) {
                this.wasmIndexPtr = (memory as any).malloc(this.indices.length * 2); // 2 bytes per uint16
            }
            
            // Copy original positions to WASM
            const F32 = new Float32Array((memory as any).buffer);
            F32.set(this.originalPositions, this.wasmOrigPtr >> 2);
            
            if (this.indices && this.wasmIndexPtr) {
                const U16 = new Uint16Array((memory as any).buffer);
                U16.set(this.indices, this.wasmIndexPtr >> 1);
            }
            
            this.useWasm = true;
            console.log(`[WasmMeshDeformation] Initialized with ${this.vertexCount} vertices in WASM`);
            
        } catch (e) {
            console.warn('[WasmMeshDeformation] Failed to allocate WASM memory:', e);
            this.cleanupWasm();
        }
    }
    
    /**
     * Clean up WASM memory
     */
    private cleanupWasm(): void {
        const memory = getWasmMemory();
        if (!memory) return;
        
        const free = (memory as any).free;
        if (!free) return;
        
        if (this.wasmPosPtr) free(this.wasmPosPtr);
        if (this.wasmOrigPtr) free(this.wasmOrigPtr);
        if (this.wasmNormalPtr) free(this.wasmNormalPtr);
        if (this.wasmIndexPtr) free(this.wasmIndexPtr);
        
        this.wasmPosPtr = 0;
        this.wasmOrigPtr = 0;
        this.wasmNormalPtr = 0;
        this.wasmIndexPtr = 0;
        
        this.useWasm = false;
    }
    
    /**
     * Set deformation strength
     */
    setStrength(strength: number): void {
        this.strength = strength;
        this.jsFallback.setStrength(strength);
    }
    
    /**
     * Set deformation frequency
     */
    setFrequency(frequency: number): void {
        this.frequency = frequency;
        this.jsFallback.setFrequency(frequency);
    }
    
    /**
     * Update the mesh deformation
     * @param time - Current elapsed time
     * @param audioState - Optional audio state for reactive behavior
     */
    update(time: number, audioState: DeformationAudioState = {}): void {
        const audioPulse = this.audioReactive ? (audioState.kick ?? 0) : 0;
        
        if (this.useWasm) {
            this.updateWasm(time, audioPulse);
        } else {
            this.jsFallback.update(time, audioState);
        }
    }
    
    /**
     * Update using WASM
     */
    private updateWasm(time: number, audioPulse: number): void {
        const memory = getWasmMemory();
        if (!memory) {
            this.useWasm = false;
            return;
        }
        
        // Copy current positions to WASM
        const F32 = new Float32Array((memory as any).buffer);
        F32.set(this.originalPositions, this.wasmPosPtr >> 2);
        
        // Call appropriate WASM function
        switch (this.type) {
            case DeformationType.WAVE:
                if (this.wasmDeformWave) {
                    this.wasmDeformWave(
                        this.wasmPosPtr,
                        this.wasmOrigPtr,
                        this.vertexCount,
                        time,
                        this.frequency,
                        this.strength,
                        audioPulse
                    );
                }
                break;
                
            case DeformationType.JIGGLE:
                if (this.wasmDeformJiggle) {
                    this.wasmDeformJiggle(
                        this.wasmPosPtr,
                        this.wasmOrigPtr,
                        this.vertexCount,
                        time,
                        this.strength,
                        audioPulse
                    );
                }
                break;
                
            case DeformationType.WOBBLE:
                if (this.wasmDeformWobble) {
                    this.wasmDeformWobble(
                        this.wasmPosPtr,
                        this.wasmOrigPtr,
                        this.vertexCount,
                        time,
                        this.strength,
                        audioPulse
                    );
                }
                break;
        }
        
        // Copy results back
        const resultStart = this.wasmPosPtr >> 2;
        this.positions.set(F32.subarray(resultStart, resultStart + this.vertexCount * 3));
        
        // Recompute normals if needed
        if (this.shouldRecomputeNormals && this.normals && this.wasmNormalPtr && this.wasmRecomputeNormals && this.indices) {
            // Initialize normals to zero
            const normalStart = this.wasmNormalPtr >> 2;
            F32.fill(0, normalStart, normalStart + this.vertexCount * 3);
            
            // Recompute
            this.wasmRecomputeNormals(
                this.wasmPosPtr,
                this.wasmNormalPtr,
                this.wasmIndexPtr,
                this.indices.length
            );
            
            // Copy normals back
            this.normals.set(F32.subarray(normalStart, normalStart + this.vertexCount * 3));
            this.geometry.attributes.normal.needsUpdate = true;
        }
        
        // Mark position attribute as needing update
        this.geometry.attributes.position.needsUpdate = true;
    }
    
    /**
     * Reset geometry to original state
     */
    reset(): void {
        this.positions.set(this.originalPositions);
        this.geometry.attributes.position.needsUpdate = true;
        
        if (this.shouldRecomputeNormals) {
            this.geometry.computeVertexNormals();
        }
    }
    
    /**
     * Dispose of resources
     */
    dispose(): void {
        this.cleanupWasm();
        this.jsFallback.dispose();
    }
    
    /**
     * Check if using WASM acceleration
     */
    isUsingWasm(): boolean {
        return this.useWasm;
    }
}

/**
 * Factory functions for creating WASM-accelerated deformers
 */

export function createWasmWaveDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<WasmDeformationConfig, 'type'> = {}
): WasmMeshDeformation {
    return new WasmMeshDeformation(geometry, { type: DeformationType.WAVE, ...config });
}

export function createWasmJiggleDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<WasmDeformationConfig, 'type'> = {}
): WasmMeshDeformation {
    return new WasmMeshDeformation(geometry, { type: DeformationType.JIGGLE, ...config });
}

export function createWasmWobbleDeformation(
    geometry: THREE.BufferGeometry,
    config: Omit<WasmDeformationConfig, 'type'> = {}
): WasmMeshDeformation {
    return new WasmMeshDeformation(geometry, { type: DeformationType.WOBBLE, ...config });
}

/**
 * Batch deformation for multiple meshes
 * Useful for deforming an entire forest
 */
export class BatchMeshDeformation {
    private deformers: WasmMeshDeformation[] = [];
    
    add(deformer: WasmMeshDeformation): void {
        this.deformers.push(deformer);
    }
    
    update(time: number, audioState: DeformationAudioState = {}): void {
        // Could parallelize this with WASM batchDeformMeshes in the future
        for (const deformer of this.deformers) {
            deformer.update(time, audioState);
        }
    }
    
    dispose(): void {
        for (const deformer of this.deformers) {
            deformer.dispose();
        }
        this.deformers = [];
    }
}
