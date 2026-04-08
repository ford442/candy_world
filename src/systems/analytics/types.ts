/**
 * @file types.ts
 * @brief Type definitions and constants for the Analytics System
 * 
 * All TypeScript interfaces, types, constants, and utility functions
 * used by the analytics system.
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/** Analytics configuration interface */
export interface AnalyticsConfig {
  /** Whether analytics is enabled */
  enabled: boolean;
  /** Backend endpoint URL - null/undefined = local only */
  endpoint?: string | null;
  /** Sampling rate (1.0 = 100%, 0.1 = 10%) */
  sampleRate: number;
  /** Debug mode - logs to console */
  debug: boolean;
  /** Whether user has opted in (undefined = not asked yet) */
  optIn?: boolean;
  /** Whether to keep data local only (never send to server) */
  localOnly: boolean;
  /** Session ID (anonymous) */
  sessionId?: string;
  /** Maximum events to buffer in memory */
  maxBufferSize: number;
  /** Flush interval in milliseconds */
  flushIntervalMs: number;
  /** Batch send interval in milliseconds */
  batchIntervalMs: number;
}

/** Event types for type safety */
export type EventType = 
  // Session events
  | 'session_start' | 'session_end' | 'session_crashed'
  // Exploration events
  | 'biome_entered' | 'biome_exited' | 'distance_traveled' | 'area_discovered'
  // Interaction events
  | 'entity_discovered' | 'ability_used' | 'item_collected' | 'interaction_made'
  // Progression events
  | 'unlock_achieved' | 'milestone_reached' | 'level_completed'
  // Performance events
  | 'fps_drop' | 'loading_complete' | 'memory_warning' | 'gpu_stress'
  // Custom events
  | string;

/** Base analytics event */
export interface AnalyticsEvent {
  /** Event type */
  type: EventType;
  /** Event timestamp (ISO string) */
  timestamp: string;
  /** Session ID (anonymous) */
  sessionId: string;
  /** Event properties */
  properties: Record<string, unknown>;
  /** Time since session start in ms */
  sessionTime: number;
}

/** Session tracking data */
export interface SessionData {
  /** Anonymous session ID */
  id: string;
  /** Session start timestamp */
  startTime: number;
  /** Session end timestamp (if ended) */
  endTime?: number;
  /** Total duration in ms */
  duration?: number;
  /** Whether session crashed */
  crashed: boolean;
  /** Biomes visited with time spent */
  biomesVisited: Map<string, number>;
  /** Total distance traveled */
  distanceTraveled: number;
  /** Areas discovered */
  areasDiscovered: Set<string>;
  /** Entities discovered */
  entitiesDiscovered: Set<string>;
  /** Abilities used with count */
  abilitiesUsed: Map<string, number>;
  /** Items collected with count */
  itemsCollected: Map<string, number>;
  /** Unlocks achieved */
  unlocksAchieved: string[];
  /** Milestones reached */
  milestonesReached: string[];
}

/** FPS histogram data */
export interface FPSHistogram {
  /** Time spent at 60+ FPS (percentage 0-100) */
  at60fps: number;
  /** Time spent at 30-60 FPS (percentage 0-100) */
  at30fps: number;
  /** Time spent below 30 FPS (percentage 0-100) */
  below30fps: number;
  /** Total samples */
  totalSamples: number;
}

/** Frame time percentiles */
export interface FrameTimePercentiles {
  /** 50th percentile (median) in ms */
  p50: number;
  /** 95th percentile in ms */
  p95: number;
  /** 99th percentile in ms */
  p99: number;
}

/** Loading phase timing */
export interface LoadingPhaseTiming {
  /** Phase name */
  phase: string;
  /** Start timestamp */
  startTime: number;
  /** Duration in ms */
  duration: number;
}

/** Memory usage snapshot */
export interface MemorySnapshot {
  /** Timestamp */
  timestamp: number;
  /** Used JS heap in MB */
  usedJSHeapSize: number;
  /** Total JS heap in MB */
  totalJSHeapSize: number;
  /** JS heap size limit in MB */
  jsHeapSizeLimit: number;
}

/** GPU timing info (if available) */
export interface GPUTiming {
  /** GPU frame time in ms */
  gpuTime: number;
  /** CPU frame time in ms */
  cpuTime: number;
  /** GPU/CPU ratio */
  ratio: number;
}

/** Performance metrics collection */
export interface PerformanceMetrics {
  /** FPS histogram */
  fpsHistogram: FPSHistogram;
  /** Frame time percentiles */
  frameTimePercentiles: FrameTimePercentiles;
  /** Loading phase timings */
  loadingTimings: LoadingPhaseTiming[];
  /** Memory usage over time */
  memoryHistory: MemorySnapshot[];
  /** GPU timing data (if available) */
  gpuTiming?: GPUTiming[];
}

/** Complete analytics data export */
export interface AnalyticsExport {
  /** Export version */
  version: string;
  /** Export timestamp */
  exportedAt: string;
  /** Session data */
  session: SessionData;
  /** All events */
  events: AnalyticsEvent[];
  /** Performance metrics */
  performance: PerformanceMetrics;
  /** App version */
  appVersion: string;
  /** User agent (browser info only) */
  userAgent: string;
  /** Screen resolution */
  screenResolution: string;
}

/** External analytics provider interface */
export interface ExternalAnalyticsProvider {
  /** Provider name */
  name: string;
  /** Track event */
  track(name: string, properties: Record<string, unknown>): void;
  /** Identify user (with anonymous ID only) */
  identify(userId: string, traits?: Record<string, unknown>): void;
}

// ============================================================================
// Default Configuration
// ============================================================================

/** Default analytics configuration */
export const DEFAULT_CONFIG: AnalyticsConfig = {
  enabled: false, // Disabled until opt-in
  endpoint: null,
  sampleRate: 1.0,
  debug: false,
  localOnly: false,
  maxBufferSize: 1000,
  flushIntervalMs: 30000, // 30 seconds
  batchIntervalMs: 300000, // 5 minutes
};

/** Storage keys */
export const STORAGE_KEYS = {
  CONFIG: 'candy_world_analytics_config',
  EVENTS: 'candy_world_analytics_events',
  OPT_IN_SHOWN: 'candy_world_analytics_opt_in_shown',
};

/** Analytics version */
export const ANALYTICS_VERSION = '1.0.0';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random anonymous session ID
 * No fingerprinting, completely random
 */
export function generateSessionId(): string {
  const array = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for older browsers
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get current timestamp in ISO format
 */
export function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Safely access localStorage
 */
export function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      // Test access
      localStorage.getItem('__test__');
      return localStorage;
    }
  } catch {
    // localStorage not available (private mode, etc.)
  }
  return null;
}

/**
 * Load config from localStorage
 */
export function loadConfig(): Partial<AnalyticsConfig> {
  const storage = safeLocalStorage();
  if (!storage) return {};
  
  try {
    const saved = storage.getItem(STORAGE_KEYS.CONFIG);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[Analytics] Failed to load config:', e);
  }
  return {};
}

/**
 * Save config to localStorage
 */
export function saveConfig(config: AnalyticsConfig): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  
  try {
    storage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
  } catch (e) {
    console.warn('[Analytics] Failed to save config:', e);
  }
}

/**
 * Load queued events from localStorage
 */
export function loadQueuedEvents(): AnalyticsEvent[] {
  const storage = safeLocalStorage();
  if (!storage) return [];
  
  try {
    const saved = storage.getItem(STORAGE_KEYS.EVENTS);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[Analytics] Failed to load queued events:', e);
  }
  return [];
}

/**
 * Save queued events to localStorage
 */
export function saveQueuedEvents(events: AnalyticsEvent[]): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  
  try {
    // Keep only last 500 events to prevent storage overflow
    const toSave = events.slice(-500);
    storage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(toSave));
  } catch (e) {
    // Storage full or unavailable
    console.warn('[Analytics] Failed to save queued events:', e);
  }
}

/**
 * Check if we should sample this session
 */
export function shouldSample(sampleRate: number): boolean {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}
