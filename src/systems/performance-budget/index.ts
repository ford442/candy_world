/**
 * @file index.ts
 * @brief Performance Budget System Barrel Export
 * 
 * Re-exports everything from the performance budget system modules
 * for convenient importing. Maintains backward compatibility with
 * the original single-file structure.
 * 
 * @example
 * ```ts
 * // Import everything
 * import { 
 *   PerformanceBudget, 
 *   performanceBudget, 
 *   PERFORMANCE_BUDGETS,
 *   BudgetMode,
 *   PerformanceBudgetOverlay
 * } from './systems/performance-budget';
 * 
 * // Use the singleton
 * performanceBudget.beginFrame();
 * // ... render ...
 * performanceBudget.endFrame();
 * 
 * // Use the overlay
 * const overlay = new PerformanceBudgetOverlay(performanceBudget);
 * overlay.showDebugOverlay();
 * ```
 */

// ============================================================================
// Re-export from types module
// ============================================================================

export {
  BudgetMode,
  BudgetType,
  BudgetConfig,
  InstanceBudget,
  PerformanceBudgetConfig,
  PerformanceMetrics,
  BudgetViolation,
  AdaptiveSettings,
  DebugOverlayOptions,
  PERFORMANCE_BUDGETS
} from './performance-budget-types.ts';

// ============================================================================
// Re-export from core module
// ============================================================================

export {
  PerformanceBudget,
  performanceBudget
} from './performance-budget-core.ts';

// ============================================================================
// Re-export from overlay module
// ============================================================================

export {
  PerformanceBudgetOverlay,
  DebugOverlayOptions as OverlayDebugOverlayOptions
} from './performance-budget-overlay.ts';

// ============================================================================
// Backward compatibility exports
// ============================================================================

// Re-export PerformanceBudget as default for backward compatibility
export { PerformanceBudget as default } from './performance-budget-core.ts';
