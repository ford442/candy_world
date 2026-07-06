import { analytics, trackEvent } from '../systems/analytics';
import { trapFocusInside } from '../utils/interaction-utils.ts';
import { yieldToPaint } from '../utils/yield-to-paint.ts';
import {
  DebugPanelElements,
  DebugStats,
  injectStyles,
  makeDraggable,
  createElements,
  drawFPSHistogram,
  updateSessionStats,
  updateMetricsStats,
  updateEventLogUI
} from './analytics-debug-ui.ts';

// =============================================================================
// Analytics Debug Overlay Class
// =============================================================================

export class AnalyticsDebugOverlay {
  private elements: DebugPanelElements | null = null;
  private isVisible = false;
  private isMinimized = false;
  private updateInterval: number | null = null;
  private eventLog: Array<{ time: string; type: string; props: string }> = [];
  private maxEventLog = 50;
  private releaseFocusTrap: (() => void) | null = null;
  private lastFocusedElement: HTMLElement | null = null;

  constructor() {
    injectStyles();
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

    // Add keyboard tactile feedback to all interactive elements in this menu
    if (this.elements?.container) {
      this.elements.container.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const target = e.target as HTMLElement;
          if (
            target &&
            (target.classList.contains('analytics-debug-button') ||
             target.classList.contains('analytics-debug-close') ||
             target.classList.contains('analytics-debug-toggle-switch'))
          ) {
            target.classList.add('keyboard-active');
            setTimeout(() => target.classList.remove('keyboard-active'), 150);
          }
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

    this.lastFocusedElement = document.activeElement as HTMLElement;
    this.elements = createElements(
      () => this.hide(),
      () => this.toggleMinimize()
    );
    this.isVisible = true;

    // Force DOM reflow
    void this.elements.container.offsetWidth;

    // Apply active styles
    this.elements.container.style.opacity = '1';
    this.elements.container.style.transform = 'scale(1)';

    // Trap focus inside the overlay
    yieldToPaint(50).then(() => {
      if (this.isVisible && this.elements?.container) {
        this.releaseFocusTrap = trapFocusInside(this.elements.container);
      }
    });

    // Setup control handlers
    this.setupControls();

    // Track events
    this.hookEventTracking();

    // Start update loop
    this.refresh();
    this.updateInterval = window.setInterval(() => {
      this.refresh();
    }, 1000);

    trackEvent('debug_overlay_opened', {});
  }

  /**
   * Hide the debug overlay
   */
  hide(): void {
    if (!this.isVisible || !this.elements) return;

    // Release focus trap and restore focus
    if (this.releaseFocusTrap) {
      this.releaseFocusTrap();
      this.releaseFocusTrap = null;
    }
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus({ preventScroll: true });
    }
    this.lastFocusedElement = null;

    this.elements.container.style.opacity = '0';
    this.elements.container.style.transform = 'scale(0.95)';
    const containerToRemove = this.elements.container;
    setTimeout(() => {
      containerToRemove.remove();
    }, 300);
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

    drawFPSHistogram(this.elements.fpsCanvas, stats.fpsHistogram);
    updateSessionStats(this.elements.sessionSection, session, stats);
    updateMetricsStats(this.elements.metricsSection, stats);
    this.updateEventLog();
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
    updateEventLogUI(this.elements.eventsSection, this.eventLog);
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
