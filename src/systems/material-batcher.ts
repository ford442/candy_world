/**
 * @file material-batcher.ts
 * @brief WASM-accelerated material flash/fade batching
 * 
 * Batches material color lerping operations to reduce GC pressure
 * and improve performance when processing many reactive materials.
 * 
 * @example
 * ```ts
 * import { MaterialBatcher } from './systems/material-batcher';
 * 
 * const batcher = MaterialBatcher.getInstance();
 * 
 * // Register a material for batch processing
 * batcher.registerMaterial(mesh.material, baseColor, isBasic, hasEmissive);
 * 
 * // Trigger a flash
 * batcher.triggerFlash(mesh.material, flashColor, intensity);
 * 
 * // In animation loop - batch processes all materials
 * batcher.update(deltaTime);
 * ```
 */

import * as THREE from 'three';
import { CONFIG } from '../core/config.ts';
import { log } from '../utils/log.ts';
import { getWasmInstance } from '../utils/wasm-loader.ts';

/** Material fields the batcher reads/writes; not every THREE.Material has them. */
type ColoredMaterial = THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
};

/** WASM exports this batcher binds to (absent when the AS build lacks them). */
interface MaterialBatcherExports {
    batchMaterialFlash?: (count: number, fadeSpeed: number, snapThreshold: number, flashScale: number) => number;
    initMaterialEntry?: (index: number, ...args: number[]) => void;
    triggerMaterialFlash?: (index: number, r: number, g: number, b: number, intensity: number) => void;
    getMaterialResult?: (index: number, outPtr: number) => void;
    materialNeedsFadeBack?: (index: number) => number;
    getMaterialFlashIntensity?: (index: number) => number;
    memory?: WebAssembly.Memory;
}

/** Optional reactivity tuning; CONFIG does not currently declare these, so defaults apply. */
type ReactivityTuning = {
    reactivity?: { fadeSpeed?: number; fadeSnapThreshold?: number };
    flashScale?: number;
};

// Material entry tracking
interface MaterialEntry {
    material: THREE.Material;
    index: number;
    isBasic: boolean;
    hasEmissive: boolean;
    baseColor: THREE.Color;
}

// Configuration
const MAX_MATERIALS = 2000;
const MATERIAL_STRIDE = 12; // floats per material
const RESULT_STRIDE = 4; // r, g, b, emissiveIntensity

// Memory layout (must match AssemblyScript)
const OFF_CURRENT_R = 0;
const OFF_CURRENT_G = 1;
const OFF_CURRENT_B = 2;
// 3-5 base rgb, 6-8 flash rgb, 10 emissive intensity: written and read by WASM only
const OFF_FLASH_INTENSITY = 9;
const OFF_FLAGS = 11;

// WASM memory offsets (must match AssemblyScript)
const MATERIAL_BUFFER_OFFSET = 200000;
const RESULT_BUFFER_OFFSET = 300000;

// Flag bits
const FLAG_BASIC = 1;
const FLAG_EMISSIVE = 2;
const FLAG_NEEDS_FADE = 4;

/**
 * Global material batcher for flash/fade operations
 */
export class MaterialBatcher {
    private static instance: MaterialBatcher;
    private initialized = false;
    
    // Material registry
    private materials = new Map<THREE.Material, MaterialEntry>();
    private materialList: MaterialEntry[] = [];
    private nextIndex = 0;
    
    // WASM function bindings
    private wasmBatchFlash: ((count: number, fadeSpeed: number, snapThreshold: number, flashScale: number) => number) | null = null;
    private wasmInitMaterial: ((index: number, ...args: number[]) => void) | null = null;
    private wasmTriggerFlash: ((index: number, r: number, g: number, b: number, intensity: number) => void) | null = null;
    private wasmGetResult: ((index: number, outPtr: number) => void) | null = null;
    private wasmNeedsFadeBack: ((index: number) => number) | null = null;
    private wasmGetFlashIntensity: ((index: number) => number) | null = null;
    
    // Result buffer (reused)
    private resultBuffer = new Float32Array(RESULT_STRIDE);
    private resultPtr = 0;
    
    // Stats
    private activeMaterials = 0;
    
    private constructor() {}
    
    static getInstance(): MaterialBatcher {
        if (!MaterialBatcher.instance) {
            MaterialBatcher.instance = new MaterialBatcher();
        }
        return MaterialBatcher.instance;
    }
    
    /**
     * Initialize WASM bindings and memory
     */
    init(): boolean {
        if (this.initialized) return true;
        
        const instance = getWasmInstance();
        if (!instance) {
            log.info('MaterialBatcher', 'WASM not available, using JS fallback');
            return false;
        }
        
        // Bind WASM functions
        const exports = instance.exports as MaterialBatcherExports;
        this.wasmBatchFlash = exports.batchMaterialFlash ?? null;
        this.wasmInitMaterial = exports.initMaterialEntry ?? null;
        this.wasmTriggerFlash = exports.triggerMaterialFlash ?? null;
        this.wasmGetResult = exports.getMaterialResult ?? null;
        this.wasmNeedsFadeBack = exports.materialNeedsFadeBack ?? null;
        this.wasmGetFlashIntensity = exports.getMaterialFlashIntensity ?? null;
        
        if (!this.wasmBatchFlash) {
            log.info('MaterialBatcher', 'WASM batch function not available, using JS fallback');
            return false;
        }
        
        // Allocate result buffer in WASM memory
        const memory = exports.memory;
        if (memory) {
            // Use a small buffer at a fixed offset after the result buffer
            this.resultPtr = 400000; // 400KB
        }
        
        this.initialized = true;
        log.info('MaterialBatcher', 'Initialized with WASM acceleration');
        return true;
    }
    
    /**
     * Register a material for batch processing
     * @param material - The Three.js material
     * @param baseColor - The base/resting color
     * @param isBasicMaterial - Whether it's MeshBasicMaterial
     * @param hasEmissive - Whether material has emissive property
     * @returns The material index, or -1 if at capacity
     */
    registerMaterial(
        material: THREE.Material,
        baseColor: THREE.Color,
        isBasicMaterial: boolean,
        hasEmissive: boolean
    ): number {
        // Check if already registered
        if (this.materials.has(material)) {
            return this.materials.get(material)!.index;
        }
        
        // Check capacity
        if (this.nextIndex >= MAX_MATERIALS) {
            console.warn('[MaterialBatcher] At capacity, material not registered');
            return -1;
        }
        
        if (!this.initialized) {
            this.init();
        }
        
        const index = this.nextIndex++;
        
        // Create entry
        const entry: MaterialEntry = {
            material,
            index,
            isBasic: isBasicMaterial,
            hasEmissive,
            baseColor: baseColor.clone()
        };
        
        this.materials.set(material, entry);
        this.materialList.push(entry);
        
        // Initialize in WASM
        if (this.initialized && this.wasmInitMaterial) {
            const currentColor = (material as ColoredMaterial).color || new THREE.Color(0xFFFFFF);
            
            this.wasmInitMaterial(
                index,
                currentColor.r, currentColor.g, currentColor.b,
                baseColor.r, baseColor.g, baseColor.b,
                isBasicMaterial ? 1 : 0,
                hasEmissive ? 1 : 0
            );
        }
        
        return index;
    }
    
    /**
     * Unregister a material
     */
    unregisterMaterial(material: THREE.Material): void {
        const entry = this.materials.get(material);
        if (!entry) return;
        
        this.materials.delete(material);
        
        // Remove from list
        const idx = this.materialList.indexOf(entry);
        if (idx >= 0) {
            this.materialList.splice(idx, 1);
        }
        
        // Note: We don't reuse indices to keep it simple
        // In a production system, we'd want index reuse
    }
    
    /**
     * Trigger a flash on a material
     * @param material - The material to flash
     * @param color - Flash color
     * @param intensity - Flash intensity (0-1)
     */
    triggerFlash(material: THREE.Material, color: THREE.Color, intensity: number): void {
        const entry = this.materials.get(material);
        if (!entry) {
            // Material not registered, skip
            return;
        }
        
        if (this.initialized && this.wasmTriggerFlash) {
            this.wasmTriggerFlash(
                entry.index,
                color.r, color.g, color.b,
                intensity
            );
        } else {
            // JS fallback - set directly on userData for compatibility with existing code
            material.userData = material.userData || {};
            material.userData.flashIntensity = intensity;
            material.userData.flashColor = color;
            material.userData.flashDecay = 0.05;
        }
    }
    
    /**
     * Update all batched materials
     * Call this once per frame
     */
    update(_deltaTime: number): void {
        if (this.materialList.length === 0) return;
        
        if (this.initialized && this.wasmBatchFlash) {
            this.updateWasm();
        } else {
            this.updateJS();
        }
    }
    
    /**
     * Update using WASM batch processing
     */
    private updateWasm(): void {
        const instance = getWasmInstance();
        if (!instance) return;
        
        // Sync material data to WASM (in case JS modified it)
        this.syncToWasm();
        
        // Get config values
        const tuning = CONFIG as ReactivityTuning;
        const fadeSpeed = tuning.reactivity?.fadeSpeed ?? 0.06;
        const snapThreshold = tuning.reactivity?.fadeSnapThreshold ?? 0.06;
        const flashScale = tuning.flashScale ?? 2.0;
        
        // Batch process
        this.activeMaterials = this.wasmBatchFlash!(
            this.materialList.length,
            fadeSpeed,
            snapThreshold,
            flashScale
        );
        
        // Sync results back to materials
        this.syncFromWasm();
    }
    
    /**
     * Sync current material state to WASM memory
     */
    private syncToWasm(): void {
        const instance = getWasmInstance();
        if (!instance) return;
        
        const F32 = new Float32Array((instance.exports.memory as WebAssembly.Memory).buffer);
        
        for (const entry of this.materialList) {
            const base = MATERIAL_BUFFER_OFFSET + (entry.index * MATERIAL_STRIDE * 4);
            const mat = entry.material as ColoredMaterial;
            
            // Update current color if it exists
            if (mat.color) {
                F32[base / 4 + OFF_CURRENT_R] = mat.color.r;
                F32[base / 4 + OFF_CURRENT_G] = mat.color.g;
                F32[base / 4 + OFF_CURRENT_B] = mat.color.b;
            }
            
            // Update flash intensity from userData
            if (mat.userData?.flashIntensity !== undefined) {
                F32[base / 4 + OFF_FLASH_INTENSITY] = mat.userData.flashIntensity;
            }
            
            // Update flags
            let flags = (entry.isBasic ? FLAG_BASIC : 0) | (entry.hasEmissive ? FLAG_EMISSIVE : 0);
            if (mat.userData?._needsFadeBack) {
                flags |= FLAG_NEEDS_FADE;
            }
            F32[base / 4 + OFF_FLAGS] = flags;
        }
    }
    
    /**
     * Sync WASM results back to materials
     */
    private syncFromWasm(): void {
        const instance = getWasmInstance();
        if (!instance) return;
        
        const F32 = new Float32Array((instance.exports.memory as WebAssembly.Memory).buffer);
        
        for (const entry of this.materialList) {
            const resultBase = RESULT_BUFFER_OFFSET + (entry.index * RESULT_STRIDE * 4);
            const mat = entry.material as ColoredMaterial;
            
            // Read results
            const r = F32[resultBase / 4];
            const g = F32[resultBase / 4 + 1];
            const b = F32[resultBase / 4 + 2];
            const emissiveIntensity = F32[resultBase / 4 + 3];
            
            // Apply to material
            if (mat.color) {
                mat.color.setRGB(r, g, b);
            }
            
            if (entry.hasEmissive && mat.emissive) {
                mat.emissive.setRGB(r, g, b);
                mat.emissiveIntensity = emissiveIntensity;
            }
            
            // Update flags
            const base = MATERIAL_BUFFER_OFFSET + (entry.index * MATERIAL_STRIDE * 4);
            const flags = F32[base / 4 + OFF_FLAGS];
            mat.userData = mat.userData || {};
            mat.userData._needsFadeBack = (flags & FLAG_NEEDS_FADE) !== 0;
            mat.userData.flashIntensity = F32[base / 4 + OFF_FLASH_INTENSITY];
        }
    }
    
    /**
     * Update using JavaScript fallback
     */
    private updateJS(): void {
        // In JS fallback mode, the existing animation.ts code handles updates
        // We just track active materials for stats
        this.activeMaterials = 0;
        
        for (const entry of this.materialList) {
            const mat = entry.material as ColoredMaterial;
            if (mat.userData?.flashIntensity > 0 || mat.userData?._needsFadeBack) {
                this.activeMaterials++;
            }
        }
    }
    
    /**
     * Get the number of active materials (flashing or fading)
     */
    getActiveCount(): number {
        return this.activeMaterials;
    }
    
    /**
     * Get the total number of registered materials
     */
    getRegisteredCount(): number {
        return this.materialList.length;
    }
    
    /**
     * Check if using WASM acceleration
     */
    isUsingWasm(): boolean {
        return this.initialized;
    }
    
    /**
     * Dispose of all resources
     */
    dispose(): void {
        this.materials.clear();
        this.materialList = [];
        this.nextIndex = 0;
        this.activeMaterials = 0;
    }
}

// Global instance
export const materialBatcher = MaterialBatcher.getInstance();
