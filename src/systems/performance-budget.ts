/**
 * @file performance-budget.ts
 * @brief Runtime Performance Budget System for Candy World
 * 
 * @deprecated This file is kept for backward compatibility.
 * Please import from './performance-budget/' instead.
 * 
 * Enforces limits on frame time, memory usage, and instance count to prevent
 * silent performance degradation. Provides adaptive quality reduction and
 * debug visualization.
 * 
 * @example
 * ```ts
 * // New recommended import path:
 * import { PerformanceBudget, PERFORMANCE_BUDGETS } from './systems/performance-budget';
 * 
 * // Or import from the submodule directly:
 * import { PerformanceBudget } from './systems/performance-budget/performance-budget-core';
 * import { PerformanceBudgetOverlay } from './systems/performance-budget/performance-budget-overlay';
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
 * 
 * // Show debug overlay
 * const overlay = new PerformanceBudgetOverlay(budget);
 * overlay.showDebugOverlay();
 * ```
 */

// Re-export everything from the new modular structure for backward compatibility
export {
  // Enums and Types
  BudgetMode,
  BudgetType,
  BudgetConfig,
  InstanceBudget,
  PerformanceBudgetConfig,
  PerformanceMetrics,
  BudgetViolation,
  AdaptiveSettings,
  DebugOverlayOptions,
  
  // Constants
  PERFORMANCE_BUDGETS,
  
  // Core class and singleton
  PerformanceBudget,
  performanceBudget,
  
  // Overlay class
  PerformanceBudgetOverlay,
  
  // Default export
  PerformanceBudget as default
} from './performance-budget/index.ts';
