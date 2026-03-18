/**
 * Deferred Visual Loader
 * 
 * A prioritized, batched loader for non-critical visual elements.
 * Spawns visual effects over multiple frames to prevent CPU/GPU spikes.
 * 
 * Usage Example (replacing initDeferredVisuals()):
 * 
 * ```typescript
 * import { DeferredLoader, LoadPriority } from './systems/deferred-loader';
 * import { 
 *   createFluidFog, createAurora, createChromaticPulse, 
 *   createMelodyRibbon, createSparkleTrail, createDiscoveryEffect,
 *   createDandelionSeedSystem, createImpactSystem
 * } from './foliage';
 * import { initCelestialBodies } from './foliage/celestial-bodies';
 * import { jitterMineSystem } from './gameplay/jitter-mines';
 * import { createHarpoonLine } from './gameplay/harpoon-line';
 * 
 * // Create the loader
 * const visualLoader = new DeferredLoader();
 * 
 * // Add items by priority
 * visualLoader.add(LoadPriority.CRITICAL, 'fluidFog', () => {
 *   const fog = createFluidFog(200, 200);
 *   scene.add(fog);
 *   return fog;
 * });
 * 
 * visualLoader.add(LoadPriority.HIGH, 'aurora', () => {
 *   const aurora = createAurora();
 *   scene.add(aurora);
 *   return aurora;
 * });
 * 
 * visualLoader.add(LoadPriority.HIGH, 'chromaticPulse', () => {
 *   const pulse = createChromaticPulse();
 *   camera.add(pulse);
 *   return pulse;
 * });
 * 
 * visualLoader.add(LoadPriority.MEDIUM, 'celestialBodies', () => {
 *   initCelestialBodies(scene);
 *   return true;
 * });
 * 
 * visualLoader.add(LoadPriority.MEDIUM, 'dandelionSeedSystem', () => {
 *   const seeds = createDandelionSeedSystem();
 *   scene.add(seeds);
 *   return seeds;
 * });
 * 
 * visualLoader.add(LoadPriority.LOW, 'melodyRibbon', () => {
 *   return createMelodyRibbon(scene);
 * });
 * 
 * visualLoader.add(LoadPriority.LOW, 'sparkleTrail', () => {
 *   const trail = createSparkleTrail();
 *   scene.add(trail);
 *   return trail;
 * });
 * 
 * visualLoader.add(LoadPriority.LOW, 'discoveryEffect', () => {
 *   const effect = createDiscoveryEffect();
 *   scene.add(effect.mesh);
 *   return effect;
 * });
 * 
 * // Listen for progress events
 * visualLoader.on('progress', ({ loaded, total, percent }) => {
 *   console.log(`Visuals loaded: ${loaded}/${total} (${percent}%)`);
 * });
 * 
 * visualLoader.on('tierComplete', ({ priority, priorityName }) => {
 *   console.log(`Priority tier ${priorityName} complete!`);
 * });
 * 
 * visualLoader.on('complete', ({ loaded }) => {
 *   console.log(`All ${loaded} visual elements loaded!`);
 * });
 * 
 * // Start loading (processes 1-2 items per frame)
 * visualLoader.start();
 * 
 * // Optional: Pause/resume loading
 * // visualLoader.pause();
 * // visualLoader.resume();
 * 
 * // Optional: Check status
 * // const status = visualLoader.getStatus();
 * // console.log(status.isComplete, status.percent);
 * ```
 */

export enum LoadPriority {
  CRITICAL = 0,  // Player sees immediately - load first
  HIGH = 1,      // Visible but not immediately
  MEDIUM = 2,    // Background elements
  LOW = 3,       // Optional/polish effects
}

const PRIORITY_NAMES: Record<LoadPriority, string> = {
  [LoadPriority.CRITICAL]: 'CRITICAL',
  [LoadPriority.HIGH]: 'HIGH',
  [LoadPriority.MEDIUM]: 'MEDIUM',
  [LoadPriority.LOW]: 'LOW',
};

interface LoadItem<T = unknown> {
  id: string;
  priority: LoadPriority;
  loader: () => T;
  result?: T;
  loaded: boolean;
}

interface ProgressEvent {
  loaded: number;
  total: number;
  percent: number;
  currentItem: string | null;
}

interface TierCompleteEvent {
  priority: LoadPriority;
  priorityName: string;
  itemsInTier: number;
}

interface CompleteEvent {
  loaded: number;
  total: number;
  results: Map<string, unknown>;
}

interface ErrorEvent {
  id: string;
  priority: LoadPriority;
  error: Error;
}

type EventType = 'progress' | 'tierComplete' | 'complete' | 'error' | 'itemLoaded';
type EventCallback<T> = (data: T) => void;

export class DeferredLoader {
  private items: LoadItem[] = [];
  private loadedCount = 0;
  private isRunning = false;
  private isPaused = false;
  private currentIndex = 0;
  private completedTiers = new Set<LoadPriority>();
  private results = new Map<string, unknown>();
  private listeners: Map<EventType, EventCallback<unknown>[]> = new Map();
  private rafId: number | null = null;
  private batchSize: number;

  // Use requestIdleCallback if available, fallback to setTimeout(0)
  private useIdleCallback: boolean;
  private idleTimeout: number;

  constructor(options: { batchSize?: number; useIdleCallback?: boolean; idleTimeout?: number } = {}) {
    this.batchSize = options.batchSize ?? 1; // Process 1 item per batch by default for smooth frame times
    this.useIdleCallback = options.useIdleCallback ?? true;
    this.idleTimeout = options.idleTimeout ?? 16; // 16ms = 1 frame at 60fps
  }

  /**
   * Add a visual element to the loading queue
   */
  add<T>(priority: LoadPriority, id: string, loader: () => T): this {
    this.items.push({
      id,
      priority,
      loader,
      loaded: false,
    });
    // Sort by priority so critical items load first
    this.items.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Start loading visual elements in batches
   */
  start(): this {
    if (this.isRunning) return this;
    
    this.isRunning = true;
    this.isPaused = false;
    this.scheduleNextBatch();
    
    return this;
  }

  /**
   * Pause loading (call resume() to continue)
   */
  pause(): this {
    this.isPaused = true;
    return this;
  }

  /**
   * Resume loading after pause
   */
  resume(): this {
    if (!this.isRunning || !this.isPaused) return this;
    
    this.isPaused = false;
    this.scheduleNextBatch();
    return this;
  }

  /**
   * Stop loading completely (cannot be resumed)
   */
  stop(): this {
    this.isRunning = false;
    this.isPaused = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    return this;
  }

  /**
   * Get current loading status
   */
  getStatus(): {
    isRunning: boolean;
    isPaused: boolean;
    isComplete: boolean;
    loaded: number;
    total: number;
    percent: number;
    currentPriority: LoadPriority | null;
  } {
    const total = this.items.length;
    const percent = total > 0 ? Math.round((this.loadedCount / total) * 100) : 100;
    const currentItem = this.items[this.currentIndex];
    
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      isComplete: this.loadedCount >= total && total > 0,
      loaded: this.loadedCount,
      total,
      percent,
      currentPriority: currentItem?.priority ?? null,
    };
  }

  /**
   * Get the result of a loaded item
   */
  getResult<T>(id: string): T | undefined {
    return this.results.get(id) as T | undefined;
  }

  /**
   * Get all loaded results
   */
  getAllResults(): Map<string, unknown> {
    return new Map(this.results);
  }

  /**
   * Check if a specific item has been loaded
   */
  isLoaded(id: string): boolean {
    const item = this.items.find(i => i.id === id);
    return item?.loaded ?? false;
  }

  /**
   * Register an event listener
   */
  on<T>(event: 'progress', callback: EventCallback<ProgressEvent>): void;
  on<T>(event: 'tierComplete', callback: EventCallback<TierCompleteEvent>): void;
  on<T>(event: 'complete', callback: EventCallback<CompleteEvent>): void;
  on<T>(event: 'error', callback: EventCallback<ErrorEvent>): void;
  on<T>(event: 'itemLoaded', callback: EventCallback<{ id: string; priority: LoadPriority; result: unknown }>): void;
  on<T>(event: EventType, callback: EventCallback<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback as EventCallback<unknown>);
  }

  /**
   * Remove an event listener
   */
  off(event: EventType, callback: EventCallback<unknown>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  private emit<T>(event: EventType, data: T): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(data);
        } catch (err) {
          console.error(`[DeferredLoader] Error in '${event}' handler:`, err);
        }
      });
    }
  }

  private scheduleNextBatch(): void {
    if (!this.isRunning || this.isPaused) return;
    if (this.currentIndex >= this.items.length) return;

    if (this.useIdleCallback && typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(
        (deadline) => this.loadNextBatch(deadline),
        { timeout: this.idleTimeout }
      );
    } else {
      // Fallback: use requestAnimationFrame for frame-budget-friendly loading
      this.rafId = requestAnimationFrame(() => {
        this.loadNextBatch(null);
      });
    }
  }

  private loadNextBatch(deadline: IdleDeadline | null): void {
    if (!this.isRunning || this.isPaused) return;

    const itemsToProcess = Math.min(this.batchSize, this.items.length - this.currentIndex);
    const startPriority = this.items[this.currentIndex]?.priority ?? null;
    let itemsProcessedInTier = 0;

    for (let i = 0; i < itemsToProcess; i++) {
      // Check if we're running out of frame time (if using requestIdleCallback)
      if (deadline && deadline.timeRemaining() < 1) {
        this.scheduleNextBatch();
        return;
      }

      const item = this.items[this.currentIndex];
      if (!item || item.loaded) {
        this.currentIndex++;
        continue;
      }

      try {
        const result = item.loader();
        item.result = result;
        item.loaded = true;
        this.results.set(item.id, result);
        this.loadedCount++;
        itemsProcessedInTier++;

        this.emit('itemLoaded', {
          id: item.id,
          priority: item.priority,
          result,
        });

        this.emit('progress', {
          loaded: this.loadedCount,
          total: this.items.length,
          percent: Math.round((this.loadedCount / this.items.length) * 100),
          currentItem: item.id,
        });

        this.currentIndex++;

        // Check if we completed a priority tier
        const nextItem = this.items[this.currentIndex];
        if (nextItem?.priority !== item.priority || this.currentIndex >= this.items.length) {
          if (!this.completedTiers.has(item.priority)) {
            this.completedTiers.add(item.priority);
            this.emit('tierComplete', {
              priority: item.priority,
              priorityName: PRIORITY_NAMES[item.priority],
              itemsInTier: itemsProcessedInTier,
            });
          }
        }
      } catch (error) {
        console.error(`[DeferredLoader] Failed to load '${item.id}':`, error);
        this.emit('error', {
          id: item.id,
          priority: item.priority,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        item.loaded = true; // Mark as loaded to skip in future
        this.currentIndex++;
      }
    }

    // Check if all items are loaded
    if (this.currentIndex >= this.items.length) {
      this.isRunning = false;
      this.emit('complete', {
        loaded: this.loadedCount,
        total: this.items.length,
        results: this.results,
      });
    } else {
      // Schedule next batch
      this.scheduleNextBatch();
    }
  }
}

// Default export for convenience
export default DeferredLoader;
