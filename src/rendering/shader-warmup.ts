/**
 * Shader Warm-up System for Candy World
 * 
 * Problem: TSL materials compile shaders on first use, causing frame drops (10-50ms each)
 * when new foliage types appear. With ~12+ unique shaders, this can cause 120-600ms of hitching.
 * 
 * Solution: Pre-compile all shaders at startup using 1x1 pixel renders, spreading the cost
 * across a loading screen where frame drops are acceptable.
 * 
 * @example
 * ```typescript
 * // At game startup
 * const warmup = new ShaderWarmup();
 * await warmup.warmAll(renderer, scene, camera, (current, total, name) => {
 *   console.log(`Compiling shaders... ${current}/${total} (${name})`);
 * });
 * ```
 */

import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { vec3, positionLocal } from 'three/tsl';
import { CandyPresets, foliageMaterials } from '../foliage/common.ts';
import { createTerrainMaterial } from '../foliage/terrain.ts';

// Warm-up target types
export type WarmupTarget = {
  name: string;
  priority: number; // Lower = compile first (critical materials)
  create: () => THREE.Material;
};

/**
 * Shader compilation statistics
 */
export interface WarmupStats {
  total: number;
  completed: number;
  failed: number;
  totalTime: number;
  averageTime: number;
}

/**
 * Progress callback for UI updates
 */
export type WarmupProgressCallback = (
  current: number,
  total: number,
  materialName: string,
  elapsedMs: number
) => void;

/**
 * Configuration for shader warm-up
 */
export interface ShaderWarmupOptions {
  /** Pixel dimensions for warm-up render target (default: 1) */
  renderSize: number;
  /** Delay between compilations to prevent blocking (default: 0) */
  yieldDelayMs: number;
  /** Whether to compile materials in parallel batches (default: false for sequential) */
  parallel: boolean;
  /** Batch size for parallel compilation (default: 3) */
  batchSize: number;
}

const DEFAULT_OPTIONS: ShaderWarmupOptions = {
  renderSize: 1,
  yieldDelayMs: 0,
  parallel: false,
  batchSize: 3,
};

/**
 * Creates a minimal geometry for shader warm-up
 * Using a single triangle for maximum efficiency
 */
function createWarmupGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    -1, -1, 0,  // v1
     3, -1, 0,  // v2 (extends beyond viewport)
    -1,  3, 0,  // v3 (extends beyond viewport)
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return geometry;
}

/**
 * Gets all unique materials from foliageMaterials object
 */
function getFoliageMaterialTargets(): WarmupTarget[] {
  const targets: WarmupTarget[] = [];
  const seen = new Set<string>();
  
  for (const [key, matOrArray] of Object.entries(foliageMaterials)) {
    const materials = Array.isArray(matOrArray) ? matOrArray : [matOrArray];
    
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i];
      const uniqueKey = `${key}_${i}`;
      
      if (seen.has(uniqueKey)) continue;
      seen.add(uniqueKey);
      
      // Skip non-Node materials
      if (!(mat instanceof MeshStandardNodeMaterial) && !(mat instanceof MeshBasicNodeMaterial)) {
        continue;
      }
      
      // Priority: Critical UI/FX materials first, then gameplay, then decorative
      let priority = 100;
      if (['lightBeam', 'opticTip'].includes(key)) priority = 10;
      else if (['flowerPetal', 'mushroomCap', 'stem', 'flowerStem'].includes(key)) priority = 20;
      else if (['mushroomStem', 'mushroomGills', 'mushroomCheek', 'mushroomSpots'].includes(key)) priority = 30;
      else if (['eye', 'pupil', 'mouth', 'clayMouth'].includes(key)) priority = 40;
      else if (key === 'wood' || key === 'leaf' || key === 'vine') priority = 50;
      
      targets.push({
        name: `${key}${materials.length > 1 ? `_${i}` : ''}`,
        priority,
        create: () => mat.clone(),
      });
    }
  }
  
  return targets;
}

/**
 * Gets CandyPreset material targets
 */
function getPresetTargets(): WarmupTarget[] {
  const presets = [
    { name: 'Clay', color: 0xDDEEFF, priority: 15 },
    { name: 'Sugar', color: 0xFFFFFF, priority: 25 },
    { name: 'Gummy', color: 0xFF6B6B, priority: 25 },
    { name: 'SeaJelly', color: 0x44AAFF, priority: 35 },
    { name: 'Crystal', color: 0x54A0FF, priority: 35 },
    { name: 'Velvet', color: 0xFF69B4, priority: 45 },
    { name: 'OilSlick', color: 0x222222, priority: 55 },
  ];
  
  return presets.map(preset => ({
    name: `CandyPresets.${preset.name}`,
    priority: preset.priority,
    create: () => CandyPresets[preset.name](preset.color),
  }));
}

/**
 * Gets special material targets (terrain, water, etc.)
 */
function getSpecialTargets(): WarmupTarget[] {
  return [
    {
      name: 'TerrainMaterial',
      priority: 5, // Very high priority - visible immediately
      create: () => createTerrainMaterial(0x66AA55),
    },
    // Water is created dynamically with specific parameters, but we warm up the base preset
    {
      name: 'WaterMaterial_Base',
      priority: 30,
      create: () => CandyPresets.SeaJelly(0x44AAFF, {
        roughness: 0.1,
        metalness: 0.1,
        transmission: 0.9,
        ior: 1.33,
        thickness: 2.0,
        animateMoisture: true,
      }),
    },
  ];
}

/**
 * Shader Warm-up Manager
 * 
 * Pre-compiles TSL shaders to eliminate first-use frame drops.
 * 
 * Expected time savings:
 * - Each shader compile: 10-50ms (depending on complexity)
 * - Total shaders to warm: ~15-20
 * - Total potential hitch: 150-1000ms
 * - With warm-up: Distributed across loading screen, zero hitches during gameplay
 */
export class ShaderWarmup {
  private warmedMaterials = new Set<string>();
  private warmupGeometry: THREE.BufferGeometry;
  private warmupCamera: THREE.OrthographicCamera;
  private options: ShaderWarmupOptions;
  private stats: WarmupStats = {
    total: 0,
    completed: 0,
    failed: 0,
    totalTime: 0,
    averageTime: 0,
  };
  
  constructor(options: Partial<ShaderWarmupOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.warmupGeometry = createWarmupGeometry();
    
    // Orthographic camera for consistent 1x1 rendering
    this.warmupCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.warmupCamera.position.z = 1;
  }
  
  /**
   * Gets all warm-up targets sorted by priority
   */
  getTargets(): WarmupTarget[] {
    const allTargets = [
      ...getPresetTargets(),
      ...getSpecialTargets(),
      ...getFoliageMaterialTargets(),
    ];
    
    // Sort by priority (lower = first)
    return allTargets.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Warms up a single material by rendering it once
   * Uses a 1x1 pixel render target to force shader compilation
   * without visible artifacts or performance impact.
   */
  async warmupSingle(
    material: THREE.Material,
    renderer: THREE.Renderer,
    name: string
  ): Promise<boolean> {
    if (this.warmedMaterials.has(name)) {
      return true;
    }
    
    const startTime = performance.now();
    
    try {
      // Create a temporary mesh with the material
      const mesh = new THREE.Mesh(this.warmupGeometry, material);
      mesh.frustumCulled = false;
      
      // Create a minimal scene for this material
      const scene = new THREE.Scene();
      scene.add(mesh);
      
      // Add minimal lighting for standard materials
      if (material instanceof MeshStandardNodeMaterial) {
        const light = new THREE.DirectionalLight(0xffffff, 1);
        light.position.set(1, 1, 1);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0x404040));
      }
      
      // Create 1x1 render target
      const renderTarget = new THREE.RenderTarget(this.options.renderSize, this.options.renderSize);
      
      // Force shader compilation by rendering
      renderer.setRenderTarget(renderTarget);
      renderer.render(scene, this.warmupCamera);
      renderer.setRenderTarget(null);
      
      // Cleanup
      renderTarget.dispose();
      scene.remove(mesh);
      if (material instanceof MeshStandardNodeMaterial) {
        scene.children.forEach(child => {
          if (child instanceof THREE.Light) scene.remove(child);
        });
      }
      
      this.warmedMaterials.add(name);
      
      const elapsed = performance.now() - startTime;
      this.stats.completed++;
      this.stats.totalTime += elapsed;
      this.stats.averageTime = this.stats.totalTime / this.stats.completed;
      
      return true;
    } catch (error) {
      console.warn(`[ShaderWarmup] Failed to warm up "${name}":`, error);
      this.stats.failed++;
      return false;
    }
  }
  
  /**
   * Warms up all shaders
   * 
   * @param renderer - The WebGPU renderer
   * @param onProgress - Optional callback for progress updates
   * @returns Statistics about the warm-up process
   * 
   * @example
   * ```typescript
   * const stats = await warmup.warmAll(renderer, (current, total, name, elapsed) => {
   *   loadingBar.progress = current / total;
   *   loadingText.text = `Compiling shaders... ${current}/${total} (${name})`;
   * });
   * console.log(`Warmed ${stats.completed} shaders in ${stats.totalTime.toFixed(0)}ms`);
   * ```
   */
  async warmAll(
    renderer: THREE.Renderer,
    onProgress?: WarmupProgressCallback
  ): Promise<WarmupStats> {
    const targets = this.getTargets();
    this.stats = {
      total: targets.length,
      completed: 0,
      failed: 0,
      totalTime: 0,
      averageTime: 0,
    };
    
    console.log(`[ShaderWarmup] Starting warm-up for ${targets.length} shaders...`);
    const startTime = performance.now();
    
    if (this.options.parallel) {
      await this.warmParallel(targets, renderer, onProgress);
    } else {
      await this.warmSequential(targets, renderer, onProgress);
    }
    
    const totalTime = performance.now() - startTime;
    
    console.log(
      `[ShaderWarmup] Complete! ${this.stats.completed}/${this.stats.total} shaders warmed ` +
      `in ${totalTime.toFixed(0)}ms (avg: ${this.stats.averageTime.toFixed(1)}ms per shader)`
    );
    
    if (this.stats.failed > 0) {
      console.warn(`[ShaderWarmup] ${this.stats.failed} shaders failed to compile`);
    }
    
    return { ...this.stats, totalTime };
  }
  
  /**
   * Sequential warm-up (default) - more predictable, less memory pressure
   */
  private async warmSequential(
    targets: WarmupTarget[],
    renderer: THREE.Renderer,
    onProgress?: WarmupProgressCallback
  ): Promise<void> {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const material = target.create();
      
      const success = await this.warmupSingle(material, renderer, target.name);
      
      if (onProgress) {
        onProgress(i + 1, targets.length, target.name, this.stats.averageTime);
      }
      
      // Yield to event loop if requested
      if (this.options.yieldDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.options.yieldDelayMs));
      } else if (i % 3 === 0) {
        // Minimal yield every few shaders to prevent complete blocking
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
  }
  
  /**
   * Parallel warm-up - faster but higher memory usage
   */
  private async warmParallel(
    targets: WarmupTarget[],
    renderer: THREE.Renderer,
    onProgress?: WarmupProgressCallback
  ): Promise<void> {
    const { batchSize } = this.options;
    
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      
      await Promise.all(
        batch.map(async (target, batchIndex) => {
          const material = target.create();
          const success = await this.warmupSingle(material, renderer, target.name);
          
          if (onProgress) {
            const globalIndex = i + batchIndex + 1;
            onProgress(globalIndex, targets.length, target.name, this.stats.averageTime);
          }
        })
      );
      
      // Yield between batches
      if (this.options.yieldDelayMs > 0 || i + batchSize < targets.length) {
        await new Promise(resolve => setTimeout(resolve, this.options.yieldDelayMs || 1));
      }
    }
  }
  
  /**
   * Checks if a material has already been warmed up
   */
  isWarmed(name: string): boolean {
    return this.warmedMaterials.has(name);
  }
  
  /**
   * Gets the set of warmed material names
   */
  getWarmedMaterials(): Set<string> {
    return new Set(this.warmedMaterials);
  }
  
  /**
   * Clears the warmed set (useful for hot-reloading scenarios)
   */
  clear(): void {
    this.warmedMaterials.clear();
  }
  
  /**
   * Disposes of internal resources
   */
  dispose(): void {
    this.warmupGeometry.dispose();
    this.clear();
  }
}

/**
 * Convenience function to warm up a single shader
 * 
 * @param material - The material to warm up
 * @param renderer - The WebGPU renderer
 * @param scene - Optional scene to use (creates minimal scene if not provided)
 * @param camera - Optional camera to use (creates orthographic camera if not provided)
 * @returns Promise resolving to success status
 * 
 * @example
 * ```typescript
 * const myMaterial = CandyPresets.Gummy(0xFF0000);
 * await warmupShader(myMaterial, renderer);
 * // Material is now compiled and ready for use
 * ```
 */
export async function warmupShader(
  material: THREE.Material,
  renderer: THREE.Renderer,
  scene?: THREE.Scene,
  camera?: THREE.Camera
): Promise<boolean> {
  const warmup = new ShaderWarmup();
  
  if (scene && camera) {
    // Use provided scene/camera
    const renderTarget = new THREE.RenderTarget(1, 1);
    const originalTarget = renderer.getRenderTarget();
    
    renderer.setRenderTarget(renderTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(originalTarget);
    
    renderTarget.dispose();
    warmup.dispose();
    return true;
  }
  
  // Use minimal setup
  const result = await warmup.warmupSingle(material, renderer, 'single-shader');
  warmup.dispose();
  return result;
}

/**
 * Convenience function to warm up all shaders at once
 * 
 * @param renderer - The WebGPU renderer
 * @param scene - Optional scene (not used, kept for API consistency)
 * @param camera - Optional camera (not used, kept for API consistency)
 * @param onProgress - Optional progress callback
 * @param options - Optional warm-up configuration
 * @returns Promise resolving to warm-up statistics
 * 
 * @example
 * ```typescript
 * // Simple usage
 * await warmupAllShaders(renderer);
 * 
 * // With progress UI
 * await warmupAllShaders(renderer, null, null, (current, total, name) => {
 *   updateLoadingScreen(`Compiling shaders... ${current}/${total}`);
 * });
 * 
 * // With custom options
 * await warmupAllShaders(renderer, null, null, onProgress, {
 *   parallel: true,
 *   batchSize: 4
 * });
 * ```
 */
export async function warmupAllShaders(
  renderer: THREE.Renderer,
  scene?: THREE.Scene | null,
  camera?: THREE.Camera | null,
  onProgress?: WarmupProgressCallback,
  options?: Partial<ShaderWarmupOptions>
): Promise<WarmupStats> {
  const warmup = new ShaderWarmup(options);
  const stats = await warmup.warmAll(renderer, onProgress);
  warmup.dispose();
  return stats;
}

/**
 * Gets a list of all shader names that will be warmed up
 * Useful for debugging or displaying total count in UI
 */
export function getWarmupShaderList(): string[] {
  const warmup = new ShaderWarmup();
  const targets = warmup.getTargets();
  warmup.dispose();
  return targets.map(t => t.name);
}

/**
 * Gets the default priority order for shaders
 * Lower numbers = compiled first
 */
export function getWarmupPriorityOrder(): { priority: number; names: string[] }[] {
  const warmup = new ShaderWarmup();
  const targets = warmup.getTargets();
  warmup.dispose();
  
  const grouped = new Map<number, string[]>();
  
  for (const target of targets) {
    if (!grouped.has(target.priority)) {
      grouped.set(target.priority, []);
    }
    grouped.get(target.priority)!.push(target.name);
  }
  
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([priority, names]) => ({ priority, names }));
}

export default ShaderWarmup;
