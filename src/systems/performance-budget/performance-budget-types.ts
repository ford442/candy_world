/**
 * @file performance-budget-types.ts
 * @brief Type definitions for Performance Budget System
 * 
 * Contains all types, interfaces, enums, and constants for the performance budget system.
 */

/** Budget enforcement modes */
export enum BudgetMode {
  /** No enforcement - tracking only */
  OFF = 'off',
  /** Console warnings when exceeded */
  WARN = 'warn',
  /** Warnings + aggressive optimizations */
  STRICT = 'strict',
  /** Automatically reduce quality to meet budget */
  ADAPTIVE = 'adaptive'
}

/** Budget types that can be tracked */
export type BudgetType = 
  | 'frameTime' 
  | 'memory' 
  | 'instances' 
  | 'drawCalls' 
  | 'shaderCompilations';

/** Budget configuration for a single budget type */
export interface BudgetConfig {
  /** Budget limit (units depend on type) */
  limit: number;
  /** Enforcement mode for this budget */
  mode: BudgetMode;
  /** Grace period in frames before triggering warnings (for spiky metrics) */
  graceFrames: number;
  /** Threshold for adaptive reduction (0-1, percentage of budget) */
  adaptiveThreshold: number;
}

/** Instance budget per foliage type */
export interface InstanceBudget {
  maxCount: number;
  currentCount: number;
  mode: BudgetMode;
}

/** Complete budget configuration */
export interface PerformanceBudgetConfig {
  /** Target frame time in milliseconds (16.67ms = 60fps) */
  frameTime: number;
  /** Memory budget in megabytes */
  memory: number;
  /** Maximum total instances across all types */
  instances: number;
  /** Maximum draw calls per frame */
  drawCalls: number;
  /** Maximum shader compilations per session */
  shaderCompilations: number;
  /** Per-foliage-type instance budgets */
  instanceBudgets?: Record<string, number>;
  /** Global enforcement mode (can be overridden per-budget) */
  defaultMode?: BudgetMode;
}

/** Performance metrics snapshot */
export interface PerformanceMetrics {
  frameTime: number;
  memory: number;
  instances: number;
  drawCalls: number;
  shaderCompilations: number;
  timestamp: number;
}

/** Budget violation event */
export interface BudgetViolation {
  type: BudgetType;
  budget: number;
  actual: number;
  overBy: number;
  overByPercent: number;
  timestamp: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** Adaptive quality settings */
export interface AdaptiveSettings {
  /** Current LOD distance multiplier (1.0 = default) */
  lodDistanceMultiplier: number;
  /** Current shadow distance multiplier */
  shadowDistanceMultiplier: number;
  /** Current particle density multiplier */
  particleDensityMultiplier: number;
  /** Whether aggressive batching is enabled */
  aggressiveBatching: boolean;
  /** Whether mesh merging is enabled */
  meshMerging: boolean;
  /** Whether distant foliage unloading is enabled */
  unloadDistantFoliage: boolean;
}

/** Debug overlay options */
export interface DebugOverlayOptions {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  scale: number;
  showGraphs: boolean;
  showViolations: boolean;
  opacity: number;
}

// ============================================================================
// Configuration Presets
// ============================================================================

/** Pre-configured budgets for different device tiers */
export const PERFORMANCE_BUDGETS = {
  /** Mobile devices - 30fps target, 128MB memory */
  mobile: {
    frameTime: 33.33,
    memory: 128,
    instances: 500,
    drawCalls: 100,
    shaderCompilations: 50,
    defaultMode: BudgetMode.ADAPTIVE
  } as PerformanceBudgetConfig,
  
  /** Desktop devices - 60fps target, 512MB memory */
  desktop: {
    frameTime: 16.67,
    memory: 512,
    instances: 2000,
    drawCalls: 500,
    shaderCompilations: 200,
    defaultMode: BudgetMode.WARN
  } as PerformanceBudgetConfig,
  
  /** High-end devices - 90fps target, 1GB memory */
  highEnd: {
    frameTime: 11.11,
    memory: 1024,
    instances: 5000,
    drawCalls: 1000,
    shaderCompilations: 500,
    defaultMode: BudgetMode.WARN
  } as PerformanceBudgetConfig
};
