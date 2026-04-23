/**
 * @file analytics-debug.ts
 * @brief Analytics Debug Overlay for Candy World
 * 
 * Provides an in-game debug view for analytics data.
 * Toggle with `/stats` command or call `toggleAnalyticsDebug()`.
 * 
 * Features:
 * - Real-time FPS histogram visualization
 * - Session statistics
 * - Event log
 * - Performance metrics
 * - Data export button
 * - Privacy controls
 */

import { analytics, trackEvent } from '../systems/analytics';
import type { FPSHistogram, FrameTimePercentiles } from '../systems/analytics';
import { trapFocusInside } from '../utils/interaction-utils.ts';

// =============================================================================
// Types & Interfaces
// =============================================================================

interface DebugPanelElements {
  container: HTMLElement;
  header: HTMLElement;
  content: HTMLElement;
  fpsCanvas: HTMLCanvasElement;
  sessionSection: HTMLElement;
  metricsSection: HTMLElement;
  eventsSection: HTMLElement;
  controlsSection: HTMLElement;
}

interface DebugStats {
  bufferSize: number;
  queuedEvents: number;
  sessionActive: boolean;
  fpsHistogram: FPSHistogram;
  frameTimePercentiles: FrameTimePercentiles;
}

// =============================================================================
// Styles
// =============================================================================

const DEBUG_STYLES = `
.analytics-debug-container {
  position: fixed;
  top: 10px;
  right: 10px;
  width: 400px;
  max-height: 80vh;
  background: rgba(0, 0, 0, 0.9);
  border: 2px solid #ff69b4;
  border-radius: 12px;
  color: #fff;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  z-index: 9999;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(255, 105, 180, 0.3);
}

.analytics-debug-header {
  background: linear-gradient(90deg, #ff69b4, #ff1493);
  padding: 10px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
}

.analytics-debug-title {
  font-weight: bold;
  font-size: 14px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}

.analytics-debug-close {
  background: none;
  border: none;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  padding: 0 5px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.analytics-debug-close:hover {
  opacity: 1;
}

.analytics-debug-close:focus-visible {
  outline: 2px solid #ff69b4;
  outline-offset: 2px;
}

.analytics-debug-content {
  overflow-y: auto;
  padding: 15px;
  max-height: calc(80vh - 50px);
}

.analytics-debug-section {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid rgba(255, 105, 180, 0.3);
}

.analytics-debug-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.analytics-debug-section-title {
  color: #ff69b4;
  font-weight: bold;
  margin-bottom: 10px;
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 1px;
}

.analytics-debug-stat {
  display: flex;
  justify-content: space-between;
  margin-bottom: 5px;
  padding: 3px 0;
}

.analytics-debug-stat-label {
  color: #aaa;
}

.analytics-debug-stat-value {
  color: #fff;
  font-weight: bold;
}

.analytics-debug-stat-value.good {
  color: #4ade80;
}

.analytics-debug-stat-value.warning {
  color: #fbbf24;
}

.analytics-debug-stat-value.bad {
  color: #f87171;
}

.analytics-debug-fps-canvas {
  width: 100%;
  height: 80px;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 6px;
  margin-top: 10px;
}

.analytics-debug-fps-legend {
  display: flex;
  justify-content: space-around;
  margin-top: 8px;
  font-size: 10px;
}

.analytics-debug-fps-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.analytics-debug-fps-legend-color {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

.analytics-debug-fps-legend-color.fps60 {
  background: #4ade80;
}

.analytics-debug-fps-legend-color.fps30 {
  background: #fbbf24;
}

.analytics-debug-fps-legend-color.fpsLow {
  background: #f87171;
}

.analytics-debug-events {
  max-height: 150px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 6px;
  padding: 10px;
}

.analytics-debug-event {
  font-size: 10px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  gap: 10px;
}

.analytics-debug-event:last-child {
  border-bottom: none;
}

.analytics-debug-event-time {
  color: #888;
  flex-shrink: 0;
}

.analytics-debug-event-type {
  color: #ff69b4;
  flex-shrink: 0;
}

.analytics-debug-event-props {
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analytics-debug-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.analytics-debug-button {
  background: linear-gradient(90deg, #ff69b4, #ff1493);
  border: none;
  color: #fff;
  padding: 10px 15px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: bold;
  transition: transform 0.2s, box-shadow 0.2s;
}

.analytics-debug-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255, 105, 180, 0.4);
}

.analytics-debug-button:active {
  transform: translateY(0);
}

.analytics-debug-button:focus-visible {
  outline: 2px solid #ff69b4;
  outline-offset: 2px;
}

.analytics-debug-button.secondary {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 105, 180, 0.5);
}

.analytics-debug-button.secondary:hover {
  background: rgba(255, 105, 180, 0.2);
}

.analytics-debug-button.danger {
  background: linear-gradient(90deg, #ef4444, #dc2626);
}

.analytics-debug-button.danger:hover {
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
}

.analytics-debug-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.analytics-debug-toggle-label {
  color: #aaa;
}

.analytics-debug-toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  background: #444;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.3s;
  border: none;
  padding: 0;
}

.analytics-debug-toggle-switch:focus-visible {
  outline: 2px solid #ff69b4;
  outline-offset: 2px;
}

.analytics-debug-toggle-switch.active {
  background: #4ade80;
}

.analytics-debug-toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.3s;
}

.analytics-debug-toggle-switch.active::after {
  transform: translateX(20px);
}

.analytics-debug-privacy-notice {
  background: rgba(255, 193, 7, 0.1);
  border: 1px solid rgba(255, 193, 7, 0.3);
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 15px;
  font-size: 11px;
  color: #fbbf24;
}

.analytics-debug-empty {
  color: #666;
  text-align: center;
  padding: 20px;
  font-style: italic;
}

.analytics-debug-minimized {
  width: auto !important;
  min-width: 200px;
}

.analytics-debug-minimized .analytics-debug-content {
  display: none;
}
`;

// =============================================================================
// Analytics Debug Overlay Class
// =============================================================================

class AnalyticsDebugOverlay {
  private elements: DebugPanelElements | null = null;
  private isVisible = false;
  private isMinimized = false;
  private updateInterval: number | null = null;
  private eventLog: Array<{ time: string; type: string; props: string }> = [];
  private maxEventLog = 50;
  private releaseFocusTrap: (() => void) | null = null;

  constructor() {
    this.injectStyles();
  }

  /**
   * Inject CSS styles into the document
   */
  private injectStyles(): void {
    if (document.getElementById('analytics-debug-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'analytics-debug-styles';
    style.textContent = DEBUG_STYLES;
    document.head.appendChild(style);
  }

  /**
   * Create the debug panel elements
   */
  private createElements(): DebugPanelElements {
    const container = document.createElement('div');
    container.className = 'analytics-debug-container';
    container.id = 'analytics-debug-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'analytics-debug-header';
    
    const title = document.createElement('span');
    title.className = 'analytics-debug-title';
    title.innerHTML = '<span aria-hidden="true">🍭</span> Analytics Debug';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'analytics-debug-close';
    closeBtn.setAttribute('aria-label', 'Close analytics debug overlay');
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '<span aria-hidden="true">×</span>';
    closeBtn.onclick = () => this.hide();
    
    const minimizeBtn = document.createElement('button');
    minimizeBtn.className = 'analytics-debug-close';
    minimizeBtn.setAttribute('aria-label', 'Minimize analytics debug overlay');
    minimizeBtn.title = 'Minimize';
    minimizeBtn.innerHTML = '<span aria-hidden="true">−</span>';
    minimizeBtn.onclick = () => this.toggleMinimize();
    minimizeBtn.style.marginRight = '5px';
    
    header.appendChild(title);
    header.appendChild(minimizeBtn);
    header.appendChild(closeBtn);
    
    // Make header draggable
    this.makeDraggable(header, container);

    // Content
    const content = document.createElement('div');
    content.className = 'analytics-debug-content';

    // Privacy notice if not opted in
    const config = analytics.getConfig();
    if (!config.enabled) {
      const privacyNotice = document.createElement('div');
      privacyNotice.className = 'analytics-debug-privacy-notice';
      privacyNotice.innerHTML = `
        <span aria-hidden="true">⚠️</span> Analytics is disabled. Enable it to see live data.
        <br>Data is anonymous and privacy-focused.
      `;
      content.appendChild(privacyNotice);
    }

    // FPS Section
    const fpsSection = document.createElement('div');
    fpsSection.className = 'analytics-debug-section';
    fpsSection.innerHTML = `
      <div class="analytics-debug-section-title">Performance (FPS)</div>
      <canvas class="analytics-debug-fps-canvas" width="350" height="80"></canvas>
      <div class="analytics-debug-fps-legend">
        <div class="analytics-debug-fps-legend-item">
          <div class="analytics-debug-fps-legend-color fps60"></div>
          <span>60+ FPS</span>
        </div>
        <div class="analytics-debug-fps-legend-item">
          <div class="analytics-debug-fps-legend-color fps30"></div>
          <span>30-60 FPS</span>
        </div>
        <div class="analytics-debug-fps-legend-item">
          <div class="analytics-debug-fps-legend-color fpsLow"></div>
          <span><30 FPS</span>
        </div>
      </div>
    `;
    content.appendChild(fpsSection);

    // Session Section
    const sessionSection = document.createElement('div');
    sessionSection.className = 'analytics-debug-section';
    sessionSection.innerHTML = `
      <div class="analytics-debug-section-title">Session Stats</div>
      <div id="analytics-session-stats"></div>
    `;
    content.appendChild(sessionSection);

    // Metrics Section
    const metricsSection = document.createElement('div');
    metricsSection.className = 'analytics-debug-section';
    metricsSection.innerHTML = `
      <div class="analytics-debug-section-title">Performance Metrics</div>
      <div id="analytics-metrics-stats"></div>
    `;
    content.appendChild(metricsSection);

    // Events Section
    const eventsSection = document.createElement('div');
    eventsSection.className = 'analytics-debug-section';
    eventsSection.innerHTML = `
      <div class="analytics-debug-section-title">Recent Events</div>
      <div class="analytics-debug-events" id="analytics-events-log">
        <div class="analytics-debug-empty">No events yet...<br><br><button class="analytics-debug-button" id="analytics-test-event-btn"><span aria-hidden="true">🔔</span> Send Test Event</button></div>
      </div>
    `;
    content.appendChild(eventsSection);

    // Controls Section
    const controlsSection = document.createElement('div');
    controlsSection.className = 'analytics-debug-section';
    controlsSection.innerHTML = `
      <div class="analytics-debug-section-title">Controls</div>
      <div class="analytics-debug-controls">
        <div class="analytics-debug-toggle">
          <span class="analytics-debug-toggle-label" id="label-analytics-enabled">Analytics Enabled</span>
          <button type="button" role="switch" aria-checked="${config.enabled ? 'true' : 'false'}" aria-labelledby="label-analytics-enabled" class="analytics-debug-toggle-switch ${config.enabled ? 'active' : ''}" id="analytics-toggle-enabled"></button>
        </div>
        <div class="analytics-debug-toggle">
          <span class="analytics-debug-toggle-label" id="label-analytics-local">Local Only Mode</span>
          <button type="button" role="switch" aria-checked="${config.localOnly ? 'true' : 'false'}" aria-labelledby="label-analytics-local" class="analytics-debug-toggle-switch ${config.localOnly ? 'active' : ''}" id="analytics-toggle-local"></button>
        </div>
        <button class="analytics-debug-button" id="analytics-export-btn"><span aria-hidden="true">📥</span> Export Data</button>
        <button class="analytics-debug-button secondary" id="analytics-refresh-btn"><span aria-hidden="true">🔄</span> Refresh</button>
        <button class="analytics-debug-button danger" id="analytics-clear-btn"><span aria-hidden="true">🗑️</span> Clear All Data</button>
      </div>
    `;
    content.appendChild(controlsSection);

    container.appendChild(header);
    container.appendChild(content);
    document.body.appendChild(container);

    // Setup control handlers
    this.setupControls();

    // Track events
    this.hookEventTracking();

    return {
      container,
      header,
      content,
      fpsCanvas: fpsSection.querySelector('canvas')!,
      sessionSection: sessionSection.querySelector('#analytics-session-stats')!,
      metricsSection: metricsSection.querySelector('#analytics-metrics-stats')!,
      eventsSection: eventsSection.querySelector('#analytics-events-log')!,
      controlsSection,
    };
  }

  /**
   * Make the panel draggable
   */
  private makeDraggable(handle: HTMLElement, container: HTMLElement): void {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      container.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      container.style.left = `${startLeft + dx}px`;
      container.style.top = `${startTop + dy}px`;
      container.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
      container.style.cursor = 'default';
    });
  }

  /**
   * Setup control button handlers
   */
  private setupControls(): void {
    // Enable/disable toggle
    const enabledToggle = document.getElementById('analytics-toggle-enabled');
    if (enabledToggle) {
      enabledToggle.addEventListener('click', () => {
        const config = analytics.getConfig();
        analytics.setEnabled(!config.enabled);
        enabledToggle.classList.toggle('active');
        enabledToggle.setAttribute('aria-checked', (!config.enabled).toString());
        this.refresh();
      });
    }

    // Local only toggle
    const localToggle = document.getElementById('analytics-toggle-local');
    if (localToggle) {
      localToggle.addEventListener('click', () => {
        const config = analytics.getConfig();
        analytics.updateConfig({ localOnly: !config.localOnly });
        localToggle.classList.toggle('active');
        localToggle.setAttribute('aria-checked', (!config.localOnly).toString());
      });
    }

    // Export button
    const exportBtn = document.getElementById('analytics-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        analytics.downloadExport();
        trackEvent('debug_export_data', {});
      });
    }

    // Refresh button
    const refreshBtn = document.getElementById('analytics-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.refresh();
      });
    }

    // Clear button
    const clearBtn = document.getElementById('analytics-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all analytics data? This cannot be undone.')) {
          analytics.clear();
          this.eventLog = [];
          this.refresh();
        }
      });
    }

    // Event delegation for dynamically added buttons (like the CTA in empty state)
    if (this.elements?.eventsSection) {
      this.elements.eventsSection.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('#analytics-test-event-btn');
        if (button) {
          trackEvent('test_event', { source: 'debug_ui' });
        }
      });
    }
  }

  /**
   * Hook into analytics event tracking
   */
  private hookEventTracking(): void {
    // We'll get events from the debug stats updates
    // In a real implementation, we might want to subscribe to events
  }

  /**
   * Show the debug overlay
   */
  show(): void {
    if (this.isVisible) return;
    
    this.elements = this.createElements();
    this.isVisible = true;
    
    // Start update loop
    this.refresh();
    this.updateInterval = window.setInterval(() => {
      this.refresh();
    }, 1000);
    
    this.releaseFocusTrap = trapFocusInside(this.elements.container);
    trackEvent('debug_overlay_opened', {});
  }

  /**
   * Hide the debug overlay
   */
  hide(): void {
    if (!this.isVisible || !this.elements) return;
    
    if (this.releaseFocusTrap) {
      this.releaseFocusTrap();
      this.releaseFocusTrap = null;
    }

    this.elements.container.remove();
    this.elements = null;
    this.isVisible = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    trackEvent('debug_overlay_closed', {});
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Toggle minimize state
   */
  toggleMinimize(): void {
    if (!this.elements) return;
    
    this.isMinimized = !this.isMinimized;
    this.elements.container.classList.toggle('analytics-debug-minimized', this.isMinimized);
  }

  /**
   * Refresh the display
   */
  refresh(): void {
    if (!this.elements) return;
    
    const stats = analytics.getDebugStats();
    const session = analytics.getSession();
    
    this.drawFPSHistogram(stats.fpsHistogram);
    this.updateSessionStats(session, stats);
    this.updateMetricsStats(stats);
    this.updateEventLog();
  }

  /**
   * Draw FPS histogram
   */
  private drawFPSHistogram(histogram: FPSHistogram): void {
    if (!this.elements) return;
    
    const canvas = this.elements.fpsCanvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw bars
    const barWidth = canvas.width / 3;
    const maxHeight = canvas.height - 10;
    
    // 60+ FPS (green)
    const h60 = (histogram.at60fps / 100) * maxHeight;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(0, canvas.height - h60, barWidth - 5, h60);
    
    // 30-60 FPS (yellow)
    const h30 = (histogram.at30fps / 100) * maxHeight;
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(barWidth, canvas.height - h30, barWidth - 5, h30);
    
    // <30 FPS (red)
    const hLow = (histogram.below30fps / 100) * maxHeight;
    ctx.fillStyle = '#f87171';
    ctx.fillRect(barWidth * 2, canvas.height - hLow, barWidth - 5, hLow);
    
    // Draw text
    ctx.fillStyle = '#fff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    
    ctx.fillText(`${histogram.at60fps}%`, barWidth / 2, canvas.height - h60 - 5);
    ctx.fillText(`${histogram.at30fps}%`, barWidth * 1.5, canvas.height - h30 - 5);
    ctx.fillText(`${histogram.below30fps}%`, barWidth * 2.5, canvas.height - hLow - 5);
  }

  /**
   * Update session stats display
   */
  private updateSessionStats(session: ReturnType<typeof analytics.getSession>, stats: DebugStats): void {
    if (!this.elements) return;
    
    const container = this.elements.sessionSection;
    
    if (!session) {
      container.innerHTML = `
        <div class="analytics-debug-stat">
          <span class="analytics-debug-stat-label">Status:</span>
          <span class="analytics-debug-stat-value bad">No active session</span>
        </div>
      `;
      return;
    }
    
    const duration = session.duration || (Date.now() - session.startTime);
    const durationSec = Math.floor(duration / 1000);
    const durationMin = Math.floor(durationSec / 60);
    const durationStr = durationMin > 0 
      ? `${durationMin}m ${durationSec % 60}s`
      : `${durationSec}s`;
    
    container.innerHTML = `
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Session ID:</span>
        <span class="analytics-debug-stat-value" title="${session.id}">${session.id.slice(0, 8)}...</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Duration:</span>
        <span class="analytics-debug-stat-value">${durationStr}</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Biomes Visited:</span>
        <span class="analytics-debug-stat-value">${session.biomesVisited.size}</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Distance Traveled:</span>
        <span class="analytics-debug-stat-value">${Math.floor(session.distanceTraveled)}m</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Entities Discovered:</span>
        <span class="analytics-debug-stat-value">${session.entitiesDiscovered.size}</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Unlocks Achieved:</span>
        <span class="analytics-debug-stat-value">${session.unlocksAchieved.length}</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Events in Buffer:</span>
        <span class="analytics-debug-stat-value ${stats.bufferSize > 500 ? 'warning' : 'good'}">${stats.bufferSize}</span>
      </div>
    `;
  }

  /**
   * Update performance metrics display
   */
  private updateMetricsStats(stats: DebugStats): void {
    if (!this.elements) return;
    
    const container = this.elements.metricsSection;
    const percentiles = stats.frameTimePercentiles;
    
    // Determine performance classes
    const p50Class = percentiles.p50 <= 16.67 ? 'good' : percentiles.p50 <= 33.33 ? 'warning' : 'bad';
    const p95Class = percentiles.p95 <= 16.67 ? 'good' : percentiles.p95 <= 33.33 ? 'warning' : 'bad';
    const p99Class = percentiles.p99 <= 16.67 ? 'good' : percentiles.p99 <= 33.33 ? 'warning' : 'bad';
    
    container.innerHTML = `
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Frame Time (p50):</span>
        <span class="analytics-debug-stat-value ${p50Class}">${percentiles.p50.toFixed(2)}ms</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Frame Time (p95):</span>
        <span class="analytics-debug-stat-value ${p95Class}">${percentiles.p95.toFixed(2)}ms</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Frame Time (p99):</span>
        <span class="analytics-debug-stat-value ${p99Class}">${percentiles.p99.toFixed(2)}ms</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">FPS Samples:</span>
        <span class="analytics-debug-stat-value">${stats.fpsHistogram.totalSamples}</span>
      </div>
      <div class="analytics-debug-stat">
        <span class="analytics-debug-stat-label">Queued Events:</span>
        <span class="analytics-debug-stat-value">${stats.queuedEvents}</span>
      </div>
    `;
  }

  /**
   * Add an event to the log
   */
  addEvent(type: string, properties: Record<string, unknown>): void {
    const time = new Date().toLocaleTimeString();
    const props = JSON.stringify(properties);
    const truncatedProps = props.length > 50 ? props.slice(0, 50) + '...' : props;
    
    this.eventLog.unshift({ time, type, props: truncatedProps });
    
    // Keep only recent events
    if (this.eventLog.length > this.maxEventLog) {
      this.eventLog.pop();
    }
    
    // Update display if visible
    if (this.isVisible) {
      this.updateEventLog();
    }
  }

  /**
   * Update event log display
   */
  private updateEventLog(): void {
    if (!this.elements) return;
    
    const container = this.elements.eventsSection;
    
    if (this.eventLog.length === 0) {
      container.innerHTML = `
        <div class="analytics-debug-empty">No events yet...<br><br><button class="analytics-debug-button" id="analytics-test-event-btn"><span aria-hidden="true">🔔</span> Send Test Event</button></div>
      `;
      return;
    }
    
    container.innerHTML = this.eventLog.map(event => `
      <div class="analytics-debug-event">
        <span class="analytics-debug-event-time">${event.time}</span>
        <span class="analytics-debug-event-type">${event.type}</span>
        <span class="analytics-debug-event-props">${event.props}</span>
      </div>
    `).join('');
    
    // Scroll to top
    container.scrollTop = 0;
  }

  /**
   * Check if overlay is visible
   */
  isOpen(): boolean {
    return this.isVisible;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

/** Global analytics debug overlay instance */
export const analyticsDebug = new AnalyticsDebugOverlay();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Toggle the analytics debug overlay
 */
export function toggleAnalyticsDebug(): void {
  analyticsDebug.toggle();
}

/**
 * Show the analytics debug overlay
 */
export function showAnalyticsDebug(): void {
  analyticsDebug.show();
}

/**
 * Hide the analytics debug overlay
 */
export function hideAnalyticsDebug(): void {
  analyticsDebug.hide();
}

// =============================================================================
// Console Command Registration
// =============================================================================

/**
 * Register the /stats command
 */
export function registerStatsCommand(): void {
  if (typeof window === 'undefined') return;
  
  // Add to window for console access
  (window as any).toggleAnalyticsDebug = toggleAnalyticsDebug;
  (window as any).showAnalyticsDebug = showAnalyticsDebug;
  (window as any).hideAnalyticsDebug = hideAnalyticsDebug;
  (window as any).analyticsDebug = analyticsDebug;
  
  console.log('%c🍭 Candy World Analytics', 'color: #ff69b4; font-weight: bold; font-size: 14px');
  console.log('%cAvailable commands:', 'color: #888');
  console.log('  %ctoggleAnalyticsDebug()%c - Toggle debug overlay', 'color: #4ade80', 'color: #aaa');
  console.log('  %canalytics.exportData()%c - Get all analytics data', 'color: #4ade80', 'color: #aaa');
  console.log('  %canalytics.downloadExport()%c - Download data as JSON', 'color: #4ade80', 'color: #aaa');
  
  // Listen for /stats in console input (for games with chat)
  const originalConsoleLog = console.log;
  console.log = function(...args: any[]) {
    originalConsoleLog.apply(console, args);
    
    // Check if this is a command message
    if (args.length > 0 && typeof args[0] === 'string') {
      const msg = args[0].trim().toLowerCase();
      if (msg === '/stats' || msg === '/analytics') {
        toggleAnalyticsDebug();
      }
    }
  };
}

// Auto-register on import
if (typeof window !== 'undefined') {
  registerStatsCommand();
}

// =============================================================================
// Default Export
// =============================================================================

export default analyticsDebug;
