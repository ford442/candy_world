// src/debug/panel.ts
// Debug UI panel for toggling initialization stages

import {
  DEBUG_CONFIG,
  DEBUG_STAGES,
  StageLoader,
  getAllStageStatuses,
  StageStatus,
  type DebugStages,
  type StageMetadata,
} from './stages.ts';

/**
 * Debug panel UI controller
 */
export class DebugPanel {
  private panel: HTMLElement | null = null;
  private stageElements: Map<keyof DebugStages, HTMLElement> = new Map();
  private updateInterval: number | null = null;
  private batcherStatsEl: HTMLElement | null = null;

  /**
   * Create and show the debug panel
   */
  createPanel(): void {
    if (this.panel) {
      console.warn('[DebugPanel] Panel already exists');
      return;
    }

    // Create panel container
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.9);
      color: #0f0;
      padding: 12px;
      border: 2px solid #0f0;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      max-width: 280px;
      max-height: 80vh;
      overflow-y: auto;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(0, 255, 0, 0.3);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      font-weight: bold;
      font-size: 13px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #0f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;
    header.innerHTML = `
      <span>🐛 Debug Stages</span>
      <button id="debug-panel-close" style="
        background: transparent;
        border: 1px solid #f00;
        color: #f00;
        padding: 2px 6px;
        cursor: pointer;
        font-size: 10px;
        border-radius: 3px;
      ">✕</button>
    `;
    panel.appendChild(header);

    // Stage list
    const stageList = document.createElement('div');
    stageList.id = 'debug-stage-list';
    stageList.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 6px;
    `;

    Object.keys(DEBUG_STAGES).forEach((stageName) => {
      const stage = stageName as keyof DebugStages;
      const row = this.createStageRow(stage, DEBUG_STAGES[stage]);
      stageList.appendChild(row);
      this.stageElements.set(stage, row);
    });

    panel.appendChild(stageList);

    const actions = document.createElement('div');
    actions.style.cssText = `
      margin-top: 10px;
      display: flex;
      gap: 8px;
    `;
    actions.innerHTML = `
      <button id="debug-export-map" style="
        background: #103820;
        border: 1px solid #37ff85;
        color: #7dffaf;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 10px;
        border-radius: 3px;
      ">Export Map</button>
    `;
    panel.appendChild(actions);

    // Batcher telemetry (live instances/capacity/VRAM estimate)
    const batcherStats = document.createElement('div');
    batcherStats.style.cssText = `
      margin-top: 10px;
      padding: 8px;
      background: rgba(0, 40, 20, 0.35);
      border: 1px solid rgba(55, 255, 133, 0.35);
      border-radius: 4px;
      font-size: 10px;
      line-height: 1.35;
      white-space: pre-wrap;
      color: #9dffc3;
    `;
    batcherStats.textContent = 'Batcher Stats: waiting for world init...';
    this.batcherStatsEl = batcherStats;
    panel.appendChild(batcherStats);

    // Instructions
    const instructions = document.createElement('div');
    instructions.style.cssText = `
      margin-top: 12px;
      padding-top: 8px;
      border-top: 1px solid #0f0;
      font-size: 10px;
      color: #888;
      line-height: 1.4;
    `;
    instructions.innerHTML = `
      <div style="color: #0f0; margin-bottom: 4px;">Keyboard Shortcuts:</div>
      <div>• <kbd style="background:#333;padding:1px 4px;border-radius:2px">P</kbd> - Toggle Profiler</div>
      <div>• <kbd style="background:#333;padding:1px 4px;border-radius:2px">O</kbd> - Toggle Startup Overlay</div>
      <div style="margin-top: 6px; color: #0f0;">Status Legend:</div>
      <div>⏳ Loading • ✅ Success • ❌ Failed • ⏭️ Skipped</div>
    `;
    panel.appendChild(instructions);

    // Add to DOM
    document.body.appendChild(panel);
    this.panel = panel;

    // Setup event listeners
    this.setupEventListeners();

    // Start periodic status updates
    this.startStatusUpdates();

    console.log('[DebugPanel] Panel created');
  }

  /**
   * Create a stage row element
   */
  private createStageRow(stage: keyof DebugStages, enabled: boolean): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 3px;
      transition: background 0.2s;
    `;
    row.setAttribute('data-stage', stage);

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabled;
    checkbox.id = `debug-${stage}`;
    checkbox.style.cssText = `
      cursor: pointer;
      width: 14px;
      height: 14px;
    `;

    // Label
    const label = document.createElement('label');
    label.htmlFor = `debug-${stage}`;
    label.textContent = stage;
    label.style.cssText = `
      flex: 1;
      cursor: pointer;
      user-select: none;
      font-size: 11px;
    `;

    // Status indicator
    const status = document.createElement('span');
    status.className = 'stage-status';
    status.textContent = '⏸️';
    status.style.cssText = `
      font-size: 14px;
    `;

    // Duration display
    const duration = document.createElement('span');
    duration.className = 'stage-duration';
    duration.textContent = '';
    duration.style.cssText = `
      font-size: 10px;
      color: #888;
      min-width: 40px;
      text-align: right;
    `;

    // Event listener
    checkbox.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      StageLoader.toggleStage(stage, target.checked);
    });

    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(status);
    row.appendChild(duration);

    return row;
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Close button
    const closeBtn = document.getElementById('debug-panel-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide();
      });
    }

    const exportBtn = document.getElementById('debug-export-map');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        if (!window.exportCurrentWorldToMap) {
          console.warn('[DebugPanel] exportCurrentWorldToMap is not available yet');
          return;
        }
        exportBtn.setAttribute('disabled', 'true');
        try {
          const result = await window.exportCurrentWorldToMap({
            download: true,
            fileName: 'canonical-part1-map.json',
            sourceLabel: 'debug-panel-export',
            includeInstancedFallback: true
          });
          console.log(`[DebugPanel] Exported ${result.stats.totalEntities} entities.`);
        } catch (error) {
          console.error('[DebugPanel] Failed to export map:', error);
        } finally {
          exportBtn.removeAttribute('disabled');
        }
      });
    }

    // Keyboard shortcut to toggle panel (D key)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'd' || e.key === 'D') {
        if (DEBUG_CONFIG.enabled) {
          if (this.panel && this.panel.style.display !== 'none') {
            this.hide();
          } else {
            this.show();
          }
        }
      }
    });
  }

  /**
   * Start periodic status updates
   */
  private startStatusUpdates(): void {
    // Update every 500ms
    this.updateInterval = window.setInterval(() => {
      this.updateStatuses();
    }, 500);
  }

  /**
   * Update stage statuses in the UI
   */
  private updateStatuses(): void {
    const statuses = getAllStageStatuses();

    statuses.forEach((metadata, stage) => {
      const row = this.stageElements.get(stage);
      if (!row) return;

      const statusEl = row.querySelector('.stage-status') as HTMLElement;
      const durationEl = row.querySelector('.stage-duration') as HTMLElement;

      if (!statusEl || !durationEl) return;

      // Update status icon and color
      switch (metadata.status) {
        case StageStatus.PENDING:
          statusEl.textContent = '⏸️';
          row.style.background = 'rgba(255, 255, 255, 0.05)';
          break;
        case StageStatus.LOADING:
          statusEl.textContent = '⏳';
          row.style.background = 'rgba(255, 255, 0, 0.1)';
          break;
        case StageStatus.SUCCESS:
          statusEl.textContent = '✅';
          row.style.background = 'rgba(0, 255, 0, 0.1)';
          break;
        case StageStatus.FAILED:
          statusEl.textContent = '❌';
          row.style.background = 'rgba(255, 0, 0, 0.1)';
          break;
        case StageStatus.SKIPPED:
          statusEl.textContent = '⏭️';
          row.style.background = 'rgba(128, 128, 128, 0.1)';
          break;
      }

      // Update duration
      if (metadata.duration !== undefined) {
        durationEl.textContent = `${metadata.duration.toFixed(0)}ms`;
      } else {
        durationEl.textContent = '';
      }

      // Add error tooltip
      if (metadata.error) {
        row.title = `Error: ${metadata.error}`;
        row.style.cursor = 'help';
      }
    });

    this.updateBatcherStats();
  }

  private updateBatcherStats(): void {
    if (!this.batcherStatsEl) return;
    const provider = window.__getBatcherTelemetry;
    if (!provider) {
      this.batcherStatsEl.textContent = 'Batcher Stats: unavailable';
      return;
    }
    const telemetry = provider();
    const topEntries = telemetry.entries
      .slice()
      .sort((a, b) => b.instances - a.instances)
      .slice(0, 5);
    const bytesToMb = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
    const rows = topEntries.map((entry) => {
      const utilization = entry.capacity > 0 ? (entry.instances / entry.capacity) * 100 : 0;
      return `${entry.label.padEnd(18)} ${String(entry.instances).padStart(4)}/${String(entry.capacity).padEnd(4)} ${utilization.toFixed(0).padStart(3)}%`;
    });
    this.batcherStatsEl.textContent =
      `Batcher Stats\n` +
      `Instances: ${telemetry.totalInstances}/${telemetry.totalCapacity}  Draws: ${telemetry.totalDrawCalls}\n` +
      `Est. VRAM: ${bytesToMb(telemetry.totalEstimatedVramBytes)}\n` +
      rows.join('\n');
  }

  /**
   * Show the debug panel
   */
  show(): void {
    if (this.panel) {
      this.panel.style.display = 'block';
    }
  }

  /**
   * Hide the debug panel
   */
  hide(): void {
    if (this.panel) {
      this.panel.style.display = 'none';
    }
  }

  /**
   * Destroy the debug panel
   */
  destroy(): void {
    if (this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.panel) {
      this.panel.remove();
      this.panel = null;
    }

    this.stageElements.clear();
  }
}

// Singleton instance
let debugPanelInstance: DebugPanel | null = null;

/**
 * Get or create the debug panel instance
 */
export function getDebugPanel(): DebugPanel {
  if (!debugPanelInstance) {
    debugPanelInstance = new DebugPanel();
  }
  return debugPanelInstance;
}

/**
 * Initialize debug panel if debug mode is enabled
 */
export function initDebugPanel(): void {
  if (DEBUG_CONFIG.enabled) {
    const panel = getDebugPanel();
    panel.createPanel();
    console.log('%c[Debug] Panel initialized. Press D to toggle visibility.', 'color: cyan; font-weight: bold');
  }
}
