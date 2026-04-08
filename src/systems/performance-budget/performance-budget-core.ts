/**
 * @file performance-budget-core.ts
 * @brief Runtime Performance Budget System Core for Candy World
 * 
 * Enforces limits on frame time, memory usage, and instance count to prevent
 * silent performance degradation. Provides adaptive quality reduction.
 * 
 * @example
 * ```ts
 * import { PerformanceBudget, PERFORMANCE_BUDGETS } from './systems/performance-budget';
 * 
 * // Auto-detect budget based on hardware
 * const budget = new PerformanceBudget();
 * budget.autoDetectBudget();
 * 
 * // Or use a preset
 * const budget = new PerformanceBudget(PERFORMANCE_BUDGETS.desktop);
 * 
 * // In render loop
 * budget.beginFrame();
 * // ... render ...
 * budget.endFrame();
 * 
 * // Check budgets
 * if (budget.isOverBudget('frameTime')) {
 *   budget.applyAdaptiveReduction();
 * }
 * ```
 */

import {
  BudgetMode,
  BudgetType,
  BudgetConfig,
  InstanceBudget,
  PerformanceBudgetConfig,
  PerformanceMetrics,
  BudgetViolation,
  AdaptiveSettings,
  PERFORMANCE_BUDGETS
} from './performance-budget-types.ts';

// Re-export types for convenience
export {
  BudgetMode,
  BudgetType,
  BudgetConfig,
  InstanceBudget,
  PerformanceBudgetConfig,
  PerformanceMetrics,
  BudgetViolation,
  AdaptiveSettings,
  PERFORMANCE_BUDGETS
};

/**
 * Runtime performance budget system that tracks and enforces performance limits.
 * 
 * Features:
 * - Track frame time, memory, instances, draw calls, and shader compilations
 * - Configurable enforcement modes (OFF, WARN, STRICT, ADAPTIVE)
 * - Automatic quality reduction when budgets are exceeded
 * - Hardware-based budget auto-detection
 */
export class PerformanceBudget {
  // Configuration
  private config: PerformanceBudgetConfig;
  private budgets: Map<BudgetType, BudgetConfig> = new Map();
  private instanceBudgets: Map<string, InstanceBudget> = new Map();
  
  // Runtime state
  private frameStartTime = 0;
  private currentMetrics: PerformanceMetrics = {
    frameTime: 0,
    memory: 0,
    instances: 0,
    drawCalls: 0,
    shaderCompilations: 0,
    timestamp: 0
  };
  
  // Tracking history for adaptive mode
  private frameTimeHistory: number[] = [];
  private readonly historyLength = 60; // 1 second at 60fps
  private consecutiveOverBudgetFrames: Map<BudgetType, number> = new Map();
  
  // Violation tracking
  private violations: BudgetViolation[] = [];
  private maxViolations = 100;
  
  // Adaptive settings
  private adaptiveSettings: AdaptiveSettings = {
    lodDistanceMultiplier: 1.0,
    shadowDistanceMultiplier: 1.0,
    particleDensityMultiplier: 1.0,
    aggressiveBatching: false,
    meshMerging: false,
    unloadDistantFoliage: false
  };
  
  // Draw call tracking
  private drawCallCount = 0;
  private shaderCompilationCount = 0;
  
  // Event callbacks
  private onViolationCallbacks: ((violation: BudgetViolation) => void)[] = [];
  private onAdaptiveChangeCallbacks: ((settings: AdaptiveSettings) => void)[] = [];

  constructor(config?: Partial<PerformanceBudgetConfig>) {
    this.config = {
      frameTime: 16.67,
      memory: 512,
      instances: 2000,
      drawCalls: 500,
      shaderCompilations: 200,
      defaultMode: BudgetMode.WARN,
      ...config
    };
    
    this.initializeBudgets();
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  private initializeBudgets(): void {
    const defaultMode = this.config.defaultMode ?? BudgetMode.WARN;
    
    // Initialize standard budgets
    this.budgets.set('frameTime', {
      limit: this.config.frameTime,
      mode: defaultMode,
      graceFrames: 3,
      adaptiveThreshold: 0.9
    });
    
    this.budgets.set('memory', {
      limit: this.config.memory,
      mode: defaultMode,
      graceFrames: 10,
      adaptiveThreshold: 0.85
    });
    
    this.budgets.set('instances', {
      limit: this.config.instances,
      mode: defaultMode,
      graceFrames: 5,
      adaptiveThreshold: 0.95
    });
    
    this.budgets.set('drawCalls', {
      limit: this.config.drawCalls,
      mode: defaultMode,
      graceFrames: 2,
      adaptiveThreshold: 0.95
    });
    
    this.budgets.set('shaderCompilations', {
      limit: this.config.shaderCompilations,
      mode: BudgetMode.WARN, // Shader compilations are one-time, less critical
      graceFrames: 0,
      adaptiveThreshold: 1.0
    });
    
    // Initialize per-type instance budgets if provided
    if (this.config.instanceBudgets) {
      for (const [type, limit] of Object.entries(this.config.instanceBudgets)) {
        this.instanceBudgets.set(type, {
          maxCount: limit,
          currentCount: 0,
          mode: defaultMode
        });
      }
    }
  }

  // ============================================================================
  // Auto-Detection
  // ============================================================================

  /**
   * Automatically detect and set appropriate budget based on hardware capabilities.
   * Uses navigator.hardwareConcurrency, navigator.deviceMemory, and WebGPU adapter info.
   * 
   * @returns The detected tier ('mobile' | 'desktop' | 'highEnd')
   */
  async autoDetectBudget(): Promise<'mobile' | 'desktop' | 'highEnd'> {
    let score = 0;
    
    // Check CPU cores (hardwareConcurrency)
    const cores = navigator.hardwareConcurrency || 4;
    if (cores <= 4) score -= 2;
    else if (cores <= 8) score += 0;
    else score += 2;
    
    // Check device memory (if available)
    const deviceMemory = (navigator as any).deviceMemory;
    if (deviceMemory) {
      if (deviceMemory <= 4) score -= 2;
      else if (deviceMemory <= 8) score += 0;
      else score += 2;
    }
    
    // Check WebGPU capabilities
    try {
      if ('gpu' in navigator) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          const info = await adapter.requestAdapterInfo();
          
          // Check for discrete GPU
          const isDiscrete = info.architecture === 'discrete' || 
                            info.description?.toLowerCase().includes('nvidia') ||
                            info.description?.toLowerCase().includes('amd') ||
                            info.description?.toLowerCase().includes('radeon') ||
                            info.description?.toLowerCase().includes('geforce');
          
          if (isDiscrete) score += 3;
          else score += 1;
          
          // Check device type
          if (info.deviceType === 'integrated') score -= 1;
          else if (info.deviceType === 'discrete') score += 1;
        }
      }
    } catch (e) {
      // WebGPU not available, rely on other metrics
    }
    
    // Check for mobile user agent
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (isMobile) score -= 2;
    
    // Determine tier based on score
    let tier: 'mobile' | 'desktop' | 'highEnd';
    if (score <= -2) {
      tier = 'mobile';
    } else if (score >= 3) {
      tier = 'highEnd';
    } else {
      tier = 'desktop';
    }
    
    // Apply the detected budget
    this.setBudget(PERFORMANCE_BUDGETS[tier]);
    
    console.log(`[PerformanceBudget] Auto-detected tier: ${tier} (score: ${score})`);
    
    return tier;
  }

  /**
   * Set a new budget configuration
   */
  setBudget(config: PerformanceBudgetConfig): void {
    this.config = config;
    this.initializeBudgets();
    this.resetMetrics();
  }

  // ============================================================================
  // Frame Tracking
  // ============================================================================

  /**
   * Call at the beginning of each frame to start timing
   */
  beginFrame(): void {
    this.frameStartTime = performance.now();
    this.drawCallCount = 0;
  }

  /**
   * Call at the end of each frame to complete timing and check budgets
   */
  endFrame(): void {
    const frameEndTime = performance.now();
    const frameTime = frameEndTime - this.frameStartTime;
    
    // Update metrics
    this.currentMetrics.frameTime = frameTime;
    this.currentMetrics.timestamp = frameEndTime;
    this.currentMetrics.drawCalls = this.drawCallCount;
    
    // Update memory estimate
    this.updateMemoryEstimate();
    
    // Update history
    this.frameTimeHistory.push(frameTime);
    if (this.frameTimeHistory.length > this.historyLength) {
      this.frameTimeHistory.shift();
    }
    
    // Check all budgets
    this.checkBudgets();
  }

  /**
   * Get the current frame time in milliseconds
   */
  getFrameTime(): number {
    return this.currentMetrics.frameTime;
  }

  /**
   * Get average frame time over the last N frames
   */
  getAverageFrameTime(frames = 60): number {
    const recent = this.frameTimeHistory.slice(-frames);
    if (recent.length === 0) return 0;
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    const avgFrameTime = this.getAverageFrameTime();
    if (avgFrameTime === 0) return 0;
    return 1000 / avgFrameTime;
  }

  // ============================================================================
  // Memory Tracking
  // ============================================================================

  private updateMemoryEstimate(): void {
    // Try to get actual memory usage if available (Chrome only)
    const memory = (performance as any).memory;
    if (memory) {
      // Convert to MB
      this.currentMetrics.memory = memory.usedJSHeapSize / (1024 * 1024);
    } else {
      // Estimate based on tracked instances
      this.currentMetrics.memory = this.estimateMemoryUsage();
    }
  }

  private estimateMemoryUsage(): number {
    // Rough estimation: ~1KB per instance + base overhead
    const instanceMemory = this.currentMetrics.instances * 1;
    const baseOverhead = 50; // Base JS heap overhead in MB
    return baseOverhead + instanceMemory;
  }

  /**
   * Get current memory usage in MB
   */
  getMemoryUsage(): number {
    return this.currentMetrics.memory;
  }

  // ============================================================================
  // Instance Tracking
  // ============================================================================

  /**
   * Register instances of a specific type
   * @param type The foliage/instance type
   * @param count Number of instances
   * @returns Whether the registration was within budget
   */
  registerInstances(type: string, count: number): boolean {
    // Update total instances
    this.currentMetrics.instances += count;
    
    // Update per-type budget if tracked
    const budget = this.instanceBudgets.get(type);
    if (budget) {
      budget.currentCount += count;
      
      // Check if over budget
      if (budget.currentCount > budget.maxCount) {
        this.handleViolation('instances', budget.maxCount, budget.currentCount);
        
        if (budget.mode === BudgetMode.STRICT) {
          return false;
        }
      }
    }
    
    // Check total instance budget
    const totalBudget = this.budgets.get('instances');
    if (totalBudget && this.currentMetrics.instances > totalBudget.limit) {
      this.handleViolation('instances', totalBudget.limit, this.currentMetrics.instances);
      
      if (totalBudget.mode === BudgetMode.STRICT) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Unregister instances of a specific type
   */
  unregisterInstances(type: string, count: number): void {
    this.currentMetrics.instances = Math.max(0, this.currentMetrics.instances - count);
    
    const budget = this.instanceBudgets.get(type);
    if (budget) {
      budget.currentCount = Math.max(0, budget.currentCount - count);
    }
  }

  /**
   * Get current instance count
   */
  getInstanceCount(): number {
    return this.currentMetrics.instances;
  }

  /**
   * Get instance count for a specific type
   */
  getInstanceCountByType(type: string): number {
    return this.instanceBudgets.get(type)?.currentCount ?? 0;
  }

  // ============================================================================
  // Draw Call Tracking
  // ============================================================================

  /**
   * Increment the draw call counter
   */
  incrementDrawCalls(count = 1): void {
    this.drawCallCount += count;
  }

  /**
   * Get current draw call count for this frame
   */
  getDrawCallCount(): number {
    return this.drawCallCount;
  }

  // ============================================================================
  // Shader Compilation Tracking
  // ============================================================================

  /**
   * Track a shader compilation
   */
  trackShaderCompilation(): void {
    this.shaderCompilationCount++;
    this.currentMetrics.shaderCompilations = this.shaderCompilationCount;
    
    const budget = this.budgets.get('shaderCompilations');
    if (budget && this.shaderCompilationCount > budget.limit) {
      this.handleViolation('shaderCompilations', budget.limit, this.shaderCompilationCount);
    }
  }

  /**
   * Get total shader compilations this session
   */
  getShaderCompilationCount(): number {
    return this.shaderCompilationCount;
  }

  // ============================================================================
  // Budget Checking
  // ============================================================================

  private checkBudgets(): void {
    // Check frame time
    const frameTimeBudget = this.budgets.get('frameTime');
    if (frameTimeBudget) {
      const avgFrameTime = this.getAverageFrameTime(10); // Check over 10 frames
      if (avgFrameTime > frameTimeBudget.limit) {
        this.handleViolation('frameTime', frameTimeBudget.limit, avgFrameTime);
      }
    }
    
    // Check memory
    const memoryBudget = this.budgets.get('memory');
    if (memoryBudget && this.currentMetrics.memory > memoryBudget.limit) {
      this.handleViolation('memory', memoryBudget.limit, this.currentMetrics.memory);
    }
    
    // Check instances
    const instanceBudget = this.budgets.get('instances');
    if (instanceBudget && this.currentMetrics.instances > instanceBudget.limit) {
      this.handleViolation('instances', instanceBudget.limit, this.currentMetrics.instances);
    }
    
    // Check draw calls
    const drawCallBudget = this.budgets.get('drawCalls');
    if (drawCallBudget && this.drawCallCount > drawCallBudget.limit) {
      this.handleViolation('drawCalls', drawCallBudget.limit, this.drawCallCount);
    }
  }

  private handleViolation(type: BudgetType, budget: number, actual: number): void {
    const overBy = actual - budget;
    const overByPercent = (overBy / budget) * 100;
    
    // Determine severity
    let severity: 'low' | 'medium' | 'high' | 'critical';
    if (overByPercent < 10) severity = 'low';
    else if (overByPercent < 25) severity = 'medium';
    else if (overByPercent < 50) severity = 'high';
    else severity = 'critical';
    
    // Track consecutive frames
    const consecutive = (this.consecutiveOverBudgetFrames.get(type) || 0) + 1;
    this.consecutiveOverBudgetFrames.set(type, consecutive);
    
    const budgetConfig = this.budgets.get(type);
    if (!budgetConfig) return;
    
    // Check grace period
    if (consecutive < budgetConfig.graceFrames) {
      return; // Still in grace period
    }
    
    // Create violation record
    const violation: BudgetViolation = {
      type,
      budget,
      actual,
      overBy,
      overByPercent,
      timestamp: performance.now(),
      severity
    };
    
    this.violations.push(violation);
    if (this.violations.length > this.maxViolations) {
      this.violations.shift();
    }
    
    // Handle based on mode
    switch (budgetConfig.mode) {
      case BudgetMode.OFF:
        break;
        
      case BudgetMode.WARN:
        console.warn(
          `[PerformanceBudget] ${type} exceeded: ${actual.toFixed(2)} / ${budget.toFixed(2)} ` +
          `(+${overByPercent.toFixed(1)}%) - ${severity}`
        );
        break;
        
      case BudgetMode.STRICT:
        console.error(
          `[PerformanceBudget] STRICT: ${type} exceeded: ${actual.toFixed(2)} / ${budget.toFixed(2)} ` +
          `(+${overByPercent.toFixed(1)}%)`
        );
        break;
        
      case BudgetMode.ADAPTIVE:
        this.applyAdaptiveReduction(type);
        break;
    }
    
    // Notify listeners
    this.onViolationCallbacks.forEach(cb => {
      try {
        cb(violation);
      } catch (e) {
        console.error('[PerformanceBudget] Error in violation callback:', e);
      }
    });
  }

  /**
   * Check if a specific budget type is currently over budget
   */
  isOverBudget(type: BudgetType): boolean {
    const budget = this.budgets.get(type);
    if (!budget) return false;
    
    switch (type) {
      case 'frameTime':
        return this.getAverageFrameTime(5) > budget.limit;
      case 'memory':
        return this.currentMetrics.memory > budget.limit;
      case 'instances':
        return this.currentMetrics.instances > budget.limit;
      case 'drawCalls':
        return this.drawCallCount > budget.limit;
      case 'shaderCompilations':
        return this.shaderCompilationCount > budget.limit;
      default:
        return false;
    }
  }

  /**
   * Get remaining budget for a type (negative if over)
   */
  getRemainingBudget(type: BudgetType): number {
    const budget = this.budgets.get(type);
    if (!budget) return 0;
    
    switch (type) {
      case 'frameTime':
        return budget.limit - this.currentMetrics.frameTime;
      case 'memory':
        return budget.limit - this.currentMetrics.memory;
      case 'instances':
        return budget.limit - this.currentMetrics.instances;
      case 'drawCalls':
        return budget.limit - this.drawCallCount;
      case 'shaderCompilations':
        return budget.limit - this.shaderCompilationCount;
      default:
        return 0;
    }
  }

  /**
   * Get budget utilization as a percentage (0-100+)
   */
  getBudgetUtilization(type: BudgetType): number {
    const budget = this.budgets.get(type);
    if (!budget || budget.limit === 0) return 0;
    
    switch (type) {
      case 'frameTime':
        return (this.currentMetrics.frameTime / budget.limit) * 100;
      case 'memory':
        return (this.currentMetrics.memory / budget.limit) * 100;
      case 'instances':
        return (this.currentMetrics.instances / budget.limit) * 100;
      case 'drawCalls':
        return (this.drawCallCount / budget.limit) * 100;
      case 'shaderCompilations':
        return (this.shaderCompilationCount / budget.limit) * 100;
      default:
        return 0;
    }
  }

  // ============================================================================
  // Adaptive Quality Reduction
  // ============================================================================

  /**
   * Apply adaptive quality reduction based on the budget type that's over
   */
  applyAdaptiveReduction(type?: BudgetType): void {
    const specificType = type || this.findMostOverBudget();
    if (!specificType) return;
    
    const budget = this.budgets.get(specificType);
    if (!budget) return;
    
    const utilization = this.getBudgetUtilization(specificType);
    if (utilization < budget.adaptiveThreshold * 100) return;
    
    let changed = false;
    
    switch (specificType) {
      case 'frameTime':
        changed = this.reduceForFrameTime();
        break;
      case 'memory':
        changed = this.reduceForMemory();
        break;
      case 'instances':
        changed = this.reduceForInstances();
        break;
      case 'drawCalls':
        changed = this.reduceForDrawCalls();
        break;
    }
    
    if (changed) {
      console.log(`[PerformanceBudget] Applied adaptive reduction for ${specificType}:`, this.adaptiveSettings);
      
      this.onAdaptiveChangeCallbacks.forEach(cb => {
        try {
          cb(this.adaptiveSettings);
        } catch (e) {
          console.error('[PerformanceBudget] Error in adaptive callback:', e);
        }
      });
      
      // Reset consecutive counter after applying reduction
      this.consecutiveOverBudgetFrames.set(specificType, 0);
    }
  }

  private findMostOverBudget(): BudgetType | null {
    let maxUtilization = 0;
    let worstType: BudgetType | null = null;
    
    for (const type of this.budgets.keys()) {
      const utilization = this.getBudgetUtilization(type);
      if (utilization > maxUtilization) {
        maxUtilization = utilization;
        worstType = type;
      }
    }
    
    return worstType;
  }

  private reduceForFrameTime(): boolean {
    let changed = false;
    
    // Reduce LOD distance
    if (this.adaptiveSettings.lodDistanceMultiplier > 0.5) {
      this.adaptiveSettings.lodDistanceMultiplier *= 0.9;
      changed = true;
    }
    
    // Reduce shadow distance
    if (this.adaptiveSettings.shadowDistanceMultiplier > 0.5) {
      this.adaptiveSettings.shadowDistanceMultiplier *= 0.9;
      changed = true;
    }
    
    // Reduce particle density
    if (this.adaptiveSettings.particleDensityMultiplier > 0.3) {
      this.adaptiveSettings.particleDensityMultiplier *= 0.9;
      changed = true;
    }
    
    // Enable aggressive batching if not already
    if (!this.adaptiveSettings.aggressiveBatching) {
      this.adaptiveSettings.aggressiveBatching = true;
      changed = true;
    }
    
    return changed;
  }

  private reduceForMemory(): boolean {
    let changed = false;
    
    // Enable distant foliage unloading
    if (!this.adaptiveSettings.unloadDistantFoliage) {
      this.adaptiveSettings.unloadDistantFoliage = true;
      changed = true;
    }
    
    // Reduce LOD distance to unload more
    if (this.adaptiveSettings.lodDistanceMultiplier > 0.5) {
      this.adaptiveSettings.lodDistanceMultiplier *= 0.85;
      changed = true;
    }
    
    return changed;
  }

  private reduceForInstances(): boolean {
    let changed = false;
    
    // Enable aggressive batching
    if (!this.adaptiveSettings.aggressiveBatching) {
      this.adaptiveSettings.aggressiveBatching = true;
      changed = true;
    }
    
    // Reduce LOD distance
    if (this.adaptiveSettings.lodDistanceMultiplier > 0.5) {
      this.adaptiveSettings.lodDistanceMultiplier *= 0.9;
      changed = true;
    }
    
    // Enable distant foliage unloading
    if (!this.adaptiveSettings.unloadDistantFoliage) {
      this.adaptiveSettings.unloadDistantFoliage = true;
      changed = true;
    }
    
    return changed;
  }

  private reduceForDrawCalls(): boolean {
    let changed = false;
    
    // Enable mesh merging
    if (!this.adaptiveSettings.meshMerging) {
      this.adaptiveSettings.meshMerging = true;
      changed = true;
    }
    
    // Enable aggressive batching
    if (!this.adaptiveSettings.aggressiveBatching) {
      this.adaptiveSettings.aggressiveBatching = true;
      changed = true;
    }
    
    // Reduce LOD distance
    if (this.adaptiveSettings.lodDistanceMultiplier > 0.5) {
      this.adaptiveSettings.lodDistanceMultiplier *= 0.9;
      changed = true;
    }
    
    return changed;
  }

  /**
   * Get current adaptive quality settings
   */
  getAdaptiveSettings(): AdaptiveSettings {
    return { ...this.adaptiveSettings };
  }

  /**
   * Reset adaptive settings to default
   */
  resetAdaptiveSettings(): void {
    this.adaptiveSettings = {
      lodDistanceMultiplier: 1.0,
      shadowDistanceMultiplier: 1.0,
      particleDensityMultiplier: 1.0,
      aggressiveBatching: false,
      meshMerging: false,
      unloadDistantFoliage: false
    };
    
    this.onAdaptiveChangeCallbacks.forEach(cb => {
      try {
        cb(this.adaptiveSettings);
      } catch (e) {
        console.error('[PerformanceBudget] Error in adaptive callback:', e);
      }
    });
  }

  // ============================================================================
  // Event Listeners
  // ============================================================================

  /**
   * Register a callback for budget violations
   */
  onViolation(callback: (violation: BudgetViolation) => void): void {
    this.onViolationCallbacks.push(callback);
  }

  /**
   * Remove a violation callback
   */
  offViolation(callback: (violation: BudgetViolation) => void): void {
    const index = this.onViolationCallbacks.indexOf(callback);
    if (index > -1) {
      this.onViolationCallbacks.splice(index, 1);
    }
  }

  /**
   * Register a callback for adaptive settings changes
   */
  onAdaptiveChange(callback: (settings: AdaptiveSettings) => void): void {
    this.onAdaptiveChangeCallbacks.push(callback);
  }

  /**
   * Remove an adaptive change callback
   */
  offAdaptiveChange(callback: (settings: AdaptiveSettings) => void): void {
    const index = this.onAdaptiveChangeCallbacks.indexOf(callback);
    if (index > -1) {
      this.onAdaptiveChangeCallbacks.splice(index, 1);
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get all recent violations
   */
  getViolations(): BudgetViolation[] {
    return [...this.violations];
  }

  /**
   * Clear violation history
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Get current performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.currentMetrics };
  }

  /**
   * Reset all metrics and counters
   */
  resetMetrics(): void {
    this.currentMetrics = {
      frameTime: 0,
      memory: 0,
      instances: 0,
      drawCalls: 0,
      shaderCompilations: 0,
      timestamp: 0
    };
    this.frameTimeHistory = [];
    this.consecutiveOverBudgetFrames.clear();
    this.violations = [];
    this.shaderCompilationCount = 0;
    this.drawCallCount = 0;
  }

  /**
   * Get full status report
   */
  getStatus(): {
    config: PerformanceBudgetConfig;
    metrics: PerformanceMetrics;
    adaptiveSettings: AdaptiveSettings;
    violations: number;
    isOverBudget: Record<BudgetType, boolean>;
    utilization: Record<BudgetType, number>;
  } {
    const isOverBudget: Record<BudgetType, boolean> = {
      frameTime: this.isOverBudget('frameTime'),
      memory: this.isOverBudget('memory'),
      instances: this.isOverBudget('instances'),
      drawCalls: this.isOverBudget('drawCalls'),
      shaderCompilations: this.isOverBudget('shaderCompilations')
    };
    
    const utilization: Record<BudgetType, number> = {
      frameTime: this.getBudgetUtilization('frameTime'),
      memory: this.getBudgetUtilization('memory'),
      instances: this.getBudgetUtilization('instances'),
      drawCalls: this.getBudgetUtilization('drawCalls'),
      shaderCompilations: this.getBudgetUtilization('shaderCompilations')
    };
    
    return {
      config: this.config,
      metrics: this.getMetrics(),
      adaptiveSettings: this.getAdaptiveSettings(),
      violations: this.violations.length,
      isOverBudget,
      utilization
    };
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.onViolationCallbacks = [];
    this.onAdaptiveChangeCallbacks = [];
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/** Global performance budget instance */
export const performanceBudget = new PerformanceBudget();

// Export default
export default PerformanceBudget;
