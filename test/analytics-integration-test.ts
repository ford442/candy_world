/**
 * @file analytics-integration-test.ts
 * @brief Integration test for analytics system
 */

// Test imports from analytics.ts
import {
  analytics,
  trackEvent,
  trackPerformance,
  trackExploration,
  trackEntityDiscovered,
  trackAbilityUsed,
  trackItemCollected,
  trackUnlockAchieved,
  trackMilestoneReached,
} from '../src/systems/analytics';

// Test imports from analytics-debug.ts
import {
  analyticsDebug,
  toggleAnalyticsDebug,
  showAnalyticsDebug,
  hideAnalyticsDebug,
  registerStatsCommand,
} from '../src/ui/analytics-debug';

// Test type imports
import type {
  AnalyticsConfig,
  AnalyticsEvent,
  SessionData,
  FPSHistogram,
  FrameTimePercentiles,
  PerformanceMetrics,
  AnalyticsExport,
} from '../src/systems/analytics';

// Test basic usage
function testAnalytics(): void {
  // Test config
  const config: AnalyticsConfig = {
    enabled: true,
    sampleRate: 1.0,
    debug: false,
    localOnly: true,
    maxBufferSize: 100,
    flushIntervalMs: 30000,
    batchIntervalMs: 300000,
  };

  // Test analytics methods
  analytics.setOptIn(true, true);
  analytics.setEnabled(true);
  
  // Test tracking functions
  trackEvent('test_event', { test: true });
  trackPerformance('test_metric', 100);
  trackExploration('biome_enter', 'meadow');
  trackEntityDiscovered('mushroom', 'mushroom_001');
  trackAbilityUsed('rainbow_blaster');
  trackItemCollected('crystal');
  trackUnlockAchieved('double_jump');
  trackMilestoneReached('first_visit');

  // Test debug overlay
  toggleAnalyticsDebug();
  showAnalyticsDebug();
  hideAnalyticsDebug();
  registerStatsCommand();

  // Test data export
  const data: AnalyticsExport = analytics.exportData();
  console.log('Analytics data exported:', data.version);

  // Test session data
  const session: SessionData | null = analytics.getSession();
  if (session) {
    console.log('Session ID:', session.id);
  }

  // Test FPS histogram
  const fpsHistogram: FPSHistogram = analytics.getFPSHistogram();
  console.log('60fps:', fpsHistogram.at60fps);

  // Test frame time percentiles
  const percentiles: FrameTimePercentiles = analytics.getFrameTimePercentiles();
  console.log('p50:', percentiles.p50);

  // Test performance metrics
  const metrics: PerformanceMetrics = {
    fpsHistogram: { at60fps: 80, at30fps: 15, below30fps: 5, totalSamples: 100 },
    frameTimePercentiles: { p50: 16, p95: 20, p99: 30 },
    loadingTimings: [],
    memoryHistory: [],
  };
  console.log('Metrics:', metrics);
}

// Run test if this file is executed directly
if (typeof window !== 'undefined') {
  (window as any).testAnalytics = testAnalytics;
}

export { testAnalytics };
