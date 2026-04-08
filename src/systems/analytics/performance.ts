/**
 * @file performance.ts
 * @brief Performance tracking for the Analytics System
 * 
 * PerformanceTracker class for tracking FPS, frame times,
 * memory usage, loading phases, and generating performance metrics.
 */

import {
  type FPSHistogram,
  type FrameTimePercentiles,
  type LoadingPhaseTiming,
  type MemorySnapshot,
  type PerformanceMetrics,
  type EventType,
  type SessionData,
  getTimestamp,
} from './types.ts';

/**
 * Callback type for internal event tracking
 */
type TrackEventInternalFn = (type: EventType, properties: Record<string, unknown>) => void;

/**
 * Performance tracker for monitoring FPS, memory, and loading times
 */
export class PerformanceTracker {
  private performanceMetrics: PerformanceMetrics;
  
  // Performance tracking
  private frameTimes: number[] = [];
  private fpsSamples: { fps: number; timestamp: number }[] = [];
  private memorySnapshots: MemorySnapshot[] = [];
  private loadingTimings: LoadingPhaseTiming[] = [];
  private currentLoadingPhase: LoadingPhaseTiming | null = null;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fpsUpdateInterval: number = 0;
  
  // Configuration and callbacks
  private enabled: boolean = false;
  private trackEventInternal: TrackEventInternalFn | null = null;

  constructor() {
    // Initialize performance metrics
    this.performanceMetrics = {
      fpsHistogram: { at60fps: 0, at30fps: 0, below30fps: 0, totalSamples: 0 },
      frameTimePercentiles: { p50: 0, p95: 0, p99: 0 },
      loadingTimings: [],
      memoryHistory: [],
    };
  }

  /**
   * Initialize the performance tracker with dependencies
   */
  initialize(enabled: boolean, trackEventInternal: TrackEventInternalFn): void {
    this.enabled = enabled;
    this.trackEventInternal = trackEventInternal;
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Track a performance metric
   */
  trackPerformance(metric: string, value: number, properties: Record<string, unknown> = {}): void {
    if (!this.enabled || !this.trackEventInternal) return;
    
    this.trackEventInternal(`perf_${metric}`, {
      value,
      ...properties,
    });
  }

  /**
   * Start tracking a loading phase
   */
  startLoadingPhase(phase: string): void {
    this.currentLoadingPhase = {
      phase,
      startTime: performance.now(),
      duration: 0,
    };
  }

  /**
   * End tracking a loading phase
   */
  endLoadingPhase(phase: string): void {
    if (this.currentLoadingPhase && this.currentLoadingPhase.phase === phase) {
      this.currentLoadingPhase.duration = performance.now() - this.currentLoadingPhase.startTime;
      this.loadingTimings.push({ ...this.currentLoadingPhase });
      this.performanceMetrics.loadingTimings.push({ ...this.currentLoadingPhase });
      
      if (this.trackEventInternal) {
        this.trackEventInternal('loading_complete', {
          phase,
          duration: this.currentLoadingPhase.duration,
        });
      }
      
      this.currentLoadingPhase = null;
    }
  }

  /**
   * Record frame time for performance analysis
   * Call this from your render loop
   */
  recordFrameTime(deltaTime: number): void {
    if (!this.enabled) return;
    
    const now = performance.now();
    
    // Calculate FPS
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      
      // Keep last 1000 samples
      if (this.frameTimes.length > 1000) {
        this.frameTimes.shift();
      }
      
      // Sample FPS every 500ms
      if (now - this.fpsUpdateInterval > 500) {
        const fps = Math.round(1000 / frameTime);
        this.fpsSamples.push({ fps, timestamp: now });
        
        // Keep last 100 samples
        if (this.fpsSamples.length > 100) {
          this.fpsSamples.shift();
        }
        
        this.fpsUpdateInterval = now;
      }
      
      // Update histogram every 100 frames
      this.frameCount++;
      if (this.frameCount % 100 === 0) {
        this.updateFPSHistogram();
      }
    }
    
    this.lastFrameTime = now;
  }

  /**
   * Record memory snapshot
   */
  recordMemorySnapshot(): void {
    if (!this.enabled || !this.trackEventInternal) return;
    
    if (performance && (performance as any).memory) {
      const mem = (performance as any).memory;
      const snapshot: MemorySnapshot = {
        timestamp: Date.now(),
        usedJSHeapSize: Math.round(mem.usedJSHeapSize / 1048576 * 100) / 100, // MB
        totalJSHeapSize: Math.round(mem.totalJSHeapSize / 1048576 * 100) / 100,
        jsHeapSizeLimit: Math.round(mem.jsHeapSizeLimit / 1048576 * 100) / 100,
      };
      
      this.memorySnapshots.push(snapshot);
      this.performanceMetrics.memoryHistory.push(snapshot);
      
      // Keep last 100 snapshots
      if (this.memorySnapshots.length > 100) {
        this.memorySnapshots.shift();
      }
      
      // Warn if memory is high (>80% of limit)
      const usageRatio = snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit;
      if (usageRatio > 0.8) {
        this.trackEventInternal('memory_warning', {
          usageRatio,
          usedMB: snapshot.usedJSHeapSize,
          limitMB: snapshot.jsHeapSizeLimit,
        });
      }
    }
  }

  /**
   * Update FPS histogram from collected samples
   */
  private updateFPSHistogram(): void {
    if (this.fpsSamples.length === 0) return;
    
    let at60fps = 0;
    let at30fps = 0;
    let below30fps = 0;
    
    this.fpsSamples.forEach(sample => {
      if (sample.fps >= 60) {
        at60fps++;
      } else if (sample.fps >= 30) {
        at30fps++;
      } else {
        below30fps++;
      }
    });
    
    const total = this.fpsSamples.length;
    
    this.performanceMetrics.fpsHistogram = {
      at60fps: Math.round(at60fps / total * 100),
      at30fps: Math.round(at30fps / total * 100),
      below30fps: Math.round(below30fps / total * 100),
      totalSamples: total,
    };
    
    // Calculate frame time percentiles
    if (this.frameTimes.length > 0) {
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const len = sorted.length;
      
      this.performanceMetrics.frameTimePercentiles = {
        p50: sorted[Math.floor(len * 0.5)],
        p95: sorted[Math.floor(len * 0.95)],
        p99: sorted[Math.floor(len * 0.99)],
      };
    }
  }

  /**
   * Get current FPS histogram
   */
  getFPSHistogram(): FPSHistogram {
    return { ...this.performanceMetrics.fpsHistogram };
  }

  /**
   * Get frame time percentiles
   */
  getFrameTimePercentiles(): FrameTimePercentiles {
    return { ...this.performanceMetrics.frameTimePercentiles };
  }

  /**
   * Get performance metrics for export
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Setup performance tracking (visibility change listener)
   */
  setupPerformanceTracking(trackEventInternal: TrackEventInternalFn): void {
    if (typeof window === 'undefined') return;
    
    // Listen for visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        trackEventInternal('app_backgrounded', {});
      } else {
        trackEventInternal('app_foregrounded', {});
      }
    });
  }

  /**
   * Clear all performance data
   */
  clear(): void {
    this.frameTimes = [];
    this.fpsSamples = [];
    this.memorySnapshots = [];
    this.loadingTimings = [];
    this.currentLoadingPhase = null;
    this.lastFrameTime = 0;
    this.frameCount = 0;
    this.fpsUpdateInterval = 0;
    
    this.performanceMetrics = {
      fpsHistogram: { at60fps: 0, at30fps: 0, below30fps: 0, totalSamples: 0 },
      frameTimePercentiles: { p50: 0, p95: 0, p99: 0 },
      loadingTimings: [],
      memoryHistory: [],
    };
  }
}
