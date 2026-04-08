/**
 * @file performance-budget-overlay.ts
 * @brief Debug Overlay for Performance Budget System
 * 
 * Provides real-time performance visualization overlay.
 * 
 * @example
 * ```ts
 * import { PerformanceBudgetOverlay } from './systems/performance-budget';
 * import { performanceBudget } from './systems/performance-budget';
 * 
 * const overlay = new PerformanceBudgetOverlay(performanceBudget);
 * overlay.showDebugOverlay();
 * ```
 */

import {
  BudgetType,
  DebugOverlayOptions
} from './performance-budget-types.ts';
import { PerformanceBudget } from './performance-budget-core.ts';

export { DebugOverlayOptions };

/**
 * Debug overlay for visualizing performance budget metrics in real-time.
 * 
 * Features:
 * - Real-time FPS and frame time display
 * - Memory, instances, and draw call tracking
 * - Performance graph visualization
 * - Violation history display
 * - Adaptive settings status
 */
export class PerformanceBudgetOverlay {
  private performanceBudget: PerformanceBudget;
  private debugOverlay: HTMLElement | null = null;
  private debugCanvas: HTMLCanvasElement | null = null;
  private debugCtx: CanvasRenderingContext2D | null = null;
  private isOverlayVisible = false;
  private overlayOptions: DebugOverlayOptions = {
    position: 'top-right',
    scale: 1.0,
    showGraphs: true,
    showViolations: true,
    opacity: 0.9
  };
  private animationFrameId: number | null = null;

  constructor(performanceBudget: PerformanceBudget, options?: Partial<DebugOverlayOptions>) {
    this.performanceBudget = performanceBudget;
    if (options) {
      this.overlayOptions = { ...this.overlayOptions, ...options };
    }
  }

  /**
   * Show the debug performance overlay
   */
  showDebugOverlay(options?: Partial<DebugOverlayOptions>): void {
    if (this.debugOverlay) {
      this.debugOverlay.style.display = 'block';
      this.isOverlayVisible = true;
      this.startUpdateLoop();
      return;
    }
    
    // Merge options
    this.overlayOptions = { ...this.overlayOptions, ...options };
    
    // Create container
    this.debugOverlay = document.createElement('div');
    this.debugOverlay.id = 'performance-budget-overlay';
    this.debugOverlay.style.cssText = `
      position: fixed;
      ${this.getOverlayPosition()}
      background: rgba(0, 0, 0, ${this.overlayOptions.opacity});
      color: #fff;
      font-family: monospace;
      font-size: ${12 * this.overlayOptions.scale}px;
      padding: 10px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 9999;
      min-width: ${250 * this.overlayOptions.scale}px;
    `;
    
    // Create canvas for graphs
    if (this.overlayOptions.showGraphs) {
      this.debugCanvas = document.createElement('canvas');
      this.debugCanvas.width = 240 * this.overlayOptions.scale;
      this.debugCanvas.height = 100 * this.overlayOptions.scale;
      this.debugCanvas.style.cssText = `
        display: block;
        margin-top: 8px;
        border: 1px solid #444;
      `;
      this.debugCtx = this.debugCanvas.getContext('2d');
      this.debugOverlay.appendChild(this.debugCanvas);
    }
    
    document.body.appendChild(this.debugOverlay);
    this.isOverlayVisible = true;
    this.startUpdateLoop();
  }

  /**
   * Hide the debug overlay
   */
  hideDebugOverlay(): void {
    if (this.debugOverlay) {
      this.debugOverlay.style.display = 'none';
    }
    this.isOverlayVisible = false;
    this.stopUpdateLoop();
  }

  /**
   * Toggle the debug overlay
   */
  toggleDebugOverlay(): void {
    if (this.isOverlayVisible) {
      this.hideDebugOverlay();
    } else {
      this.showDebugOverlay();
    }
  }

  /**
   * Check if the overlay is currently visible
   */
  isDebugOverlayVisible(): boolean {
    return this.isOverlayVisible;
  }

  private getOverlayPosition(): string {
    switch (this.overlayOptions.position) {
      case 'top-left':
        return 'top: 10px; left: 10px;';
      case 'top-right':
        return 'top: 10px; right: 10px;';
      case 'bottom-left':
        return 'bottom: 10px; left: 10px;';
      case 'bottom-right':
        return 'bottom: 10px; right: 10px;';
      default:
        return 'top: 10px; right: 10px;';
    }
  }

  private startUpdateLoop(): void {
    if (this.animationFrameId !== null) return;
    
    const update = () => {
      if (!this.isOverlayVisible) return;
      this.updateDebugOverlay();
      this.animationFrameId = requestAnimationFrame(update);
    };
    
    this.animationFrameId = requestAnimationFrame(update);
  }

  private stopUpdateLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private updateDebugOverlay(): void {
    if (!this.debugOverlay) return;
    
    const metrics = this.performanceBudget.getMetrics();
    const status = this.performanceBudget.getStatus();
    const fps = this.performanceBudget.getFPS().toFixed(1);
    const frameTime = metrics.frameTime.toFixed(2);
    const frameTimeBudget = status.config.frameTime ?? 16.67;
    const memory = metrics.memory.toFixed(1);
    const memoryBudget = status.config.memory ?? 512;
    const instances = metrics.instances;
    const instanceBudget = status.config.instances ?? 2000;
    const drawCalls = metrics.drawCalls;
    const drawCallBudget = status.config.drawCalls ?? 500;
    const violations = this.performanceBudget.getViolations();
    const adaptiveSettings = this.performanceBudget.getAdaptiveSettings();
    
    // Determine colors based on budget status
    const getColor = (type: BudgetType) => {
      const utilization = status.utilization[type];
      if (utilization > 100) return '#ff4444'; // Over budget - red
      if (utilization > 90) return '#ffaa44'; // Near budget - orange
      return '#44ff44'; // Good - green
    };
    
    // Build text content
    let html = `
      <div style="font-weight: bold; margin-bottom: 8px; font-size: ${14 * this.overlayOptions.scale}px;">
        ⚡ Performance Budget
      </div>
      <div style="display: grid; grid-template-columns: 1fr auto auto; gap: 4px 8px;">
        <span>FPS:</span>
        <span style="color: ${getColor('frameTime')}; font-weight: bold;">${fps}</span>
        <span style="color: #888;">target</span>
        
        <span>Frame Time:</span>
        <span style="color: ${getColor('frameTime')}; font-weight: bold;">${frameTime}ms</span>
        <span style="color: #888;">${frameTimeBudget.toFixed(2)}ms</span>
        
        <span>Memory:</span>
        <span style="color: ${getColor('memory')}; font-weight: bold;">${memory}MB</span>
        <span style="color: #888;">${memoryBudget}MB</span>
        
        <span>Instances:</span>
        <span style="color: ${getColor('instances')}; font-weight: bold;">${instances}</span>
        <span style="color: #888;">${instanceBudget}</span>
        
        <span>Draw Calls:</span>
        <span style="color: ${getColor('drawCalls')}; font-weight: bold;">${drawCalls}</span>
        <span style="color: #888;">${drawCallBudget}</span>
      </div>
    `;
    
    // Show adaptive settings
    html += `
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444; font-size: ${10 * this.overlayOptions.scale}px; color: #aaa;">
        <div>LOD: ${(adaptiveSettings.lodDistanceMultiplier * 100).toFixed(0)}% | 
             Shadows: ${(adaptiveSettings.shadowDistanceMultiplier * 100).toFixed(0)}% | 
             Particles: ${(adaptiveSettings.particleDensityMultiplier * 100).toFixed(0)}%</div>
        <div>${adaptiveSettings.aggressiveBatching ? '⚡ Batching ' : ''}
             ${adaptiveSettings.meshMerging ? '🔗 Merging ' : ''}
             ${adaptiveSettings.unloadDistantFoliage ? '🗑️ Unload ' : ''}</div>
      </div>
    `;
    
    // Show recent violations
    if (this.overlayOptions.showViolations && violations.length > 0) {
      const recent = violations.slice(-3);
      html += `
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #444;">
          <div style="color: #ff6666; font-size: ${10 * this.overlayOptions.scale}px;">⚠️ Recent Violations:</div>
      `;
      for (const v of recent) {
        html += `
          <div style="font-size: ${9 * this.overlayOptions.scale}px; color: #ff8888;">
            ${v.type}: +${v.overByPercent.toFixed(0)}%
          </div>
        `;
      }
      html += '</div>';
    }
    
    this.debugOverlay.innerHTML = html;
    
    // Add canvas back if it was removed
    if (this.overlayOptions.showGraphs && this.debugCanvas && !this.debugOverlay.contains(this.debugCanvas)) {
      this.debugOverlay.appendChild(this.debugCanvas);
    }
    
    // Draw graph
    if (this.overlayOptions.showGraphs && this.debugCtx) {
      this.drawPerformanceGraph();
    }
  }

  private drawPerformanceGraph(): void {
    if (!this.debugCtx || !this.debugCanvas) return;
    
    const ctx = this.debugCtx;
    const width = this.debugCanvas.width;
    const height = this.debugCanvas.height;
    
    // Get history from performance budget (we need to access it somehow)
    // Since we don't have direct access to frameTimeHistory, we'll use the metrics
    const frameTimeHistory: number[] = [];
    
    // Clear
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    const status = this.performanceBudget.getStatus();
    const budget = status.config.frameTime ?? 16.67;
    
    // Since we can't access the history directly, we'll show current frame time as a bar
    const currentFrameTime = this.performanceBudget.getFrameTime();
    const maxValue = Math.max(budget * 2, currentFrameTime * 1.5, 33.33);
    
    // Draw budget line
    const budgetY = height - (budget / maxValue) * (height - 10);
    
    ctx.strokeStyle = '#44ff44';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(0, budgetY);
    ctx.lineTo(width, budgetY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw current frame time as a simple bar
    const barHeight = (currentFrameTime / maxValue) * (height - 10);
    const barY = height - barHeight;
    
    ctx.fillStyle = currentFrameTime > budget ? '#ff4444' : '#4488ff';
    ctx.fillRect(width * 0.1, barY, width * 0.8, barHeight);
    
    // Draw labels
    ctx.fillStyle = '#888';
    ctx.font = `${10 * this.overlayOptions.scale}px monospace`;
    ctx.fillText(`${maxValue.toFixed(1)}ms`, 4, 12);
    ctx.fillText(`${budget.toFixed(1)}ms`, 4, budgetY - 2);
    ctx.fillText(`${currentFrameTime.toFixed(1)}ms`, 4, height - 4);
  }

  /**
   * Update the overlay options
   */
  setOptions(options: Partial<DebugOverlayOptions>): void {
    this.overlayOptions = { ...this.overlayOptions, ...options };
    
    // Recreate overlay if visible
    if (this.isOverlayVisible) {
      this.dispose();
      this.showDebugOverlay();
    }
  }

  /**
   * Get current overlay options
   */
  getOptions(): DebugOverlayOptions {
    return { ...this.overlayOptions };
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stopUpdateLoop();
    
    if (this.debugOverlay) {
      if (this.debugOverlay.parentNode) {
        this.debugOverlay.parentNode.removeChild(this.debugOverlay);
      }
      this.debugOverlay = null;
    }
    
    this.debugCanvas = null;
    this.debugCtx = null;
    this.isOverlayVisible = false;
  }
}

export default PerformanceBudgetOverlay;
