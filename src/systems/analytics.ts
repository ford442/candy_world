/**
 * @file analytics.ts
 * @brief Privacy-First Analytics & Telemetry System for Candy World
 * 
 * Tracks player behavior and performance metrics with a strict privacy-first design.
 * No personal data, no fingerprinting - anonymous session IDs only.
 * 
 * Key Features:
 * - Event tracking (session, exploration, interactions, progression, performance)
 * - Privacy-first: anonymous IDs, opt-in, local-only mode, easy opt-out
 * - Storage & batching: memory buffer, localStorage flush, backend batching
 * - Performance metrics: FPS histogram, frame time percentiles, memory tracking
 * - Dashboard data: JSON export, in-game debug view, external analytics compatible
 * 
 * @example
 * ```ts
 * import { analytics, trackEvent, trackPerformance } from './systems/analytics';
 * 
 * // Track custom event
 * trackEvent('entity_discovered', { entityType: 'mushroom', biome: 'meadow' });
 * 
 * // Track performance
 * trackPerformance('loading_time', 2500);
 * 
 * // Check if player found the lake
 * trackEvent('biome_entered', { biome: 'lake', duration: 120 });
 * 
 * // Check blaster usage
 * trackEvent('ability_used', { ability: 'rainbow_blaster', count: 5 });
 * ```
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
const DEFAULT_CONFIG: AnalyticsConfig = {
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
const STORAGE_KEYS = {
  CONFIG: 'candy_world_analytics_config',
  EVENTS: 'candy_world_analytics_events',
  OPT_IN_SHOWN: 'candy_world_analytics_opt_in_shown',
};

/** Analytics version */
const ANALYTICS_VERSION = '1.0.0';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a random anonymous session ID
 * No fingerprinting, completely random
 */
function generateSessionId(): string {
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
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Safely access localStorage
 */
function safeLocalStorage(): Storage | null {
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
function loadConfig(): Partial<AnalyticsConfig> {
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
function saveConfig(config: AnalyticsConfig): void {
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
function loadQueuedEvents(): AnalyticsEvent[] {
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
function saveQueuedEvents(events: AnalyticsEvent[]): void {
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
function shouldSample(sampleRate: number): boolean {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}

// ============================================================================
// Analytics System Class
// ============================================================================

/**
 * Privacy-first analytics system for Candy World
 */
class AnalyticsSystem {
  private config: AnalyticsConfig;
  private session: SessionData | null = null;
  private eventBuffer: AnalyticsEvent[] = [];
  private queuedEvents: AnalyticsEvent[] = [];
  private performanceMetrics: PerformanceMetrics;
  private externalProviders: ExternalAnalyticsProvider[] = [];
  
  // Performance tracking
  private frameTimes: number[] = [];
  private fpsSamples: { fps: number; timestamp: number }[] = [];
  private memorySnapshots: MemorySnapshot[] = [];
  private loadingTimings: LoadingPhaseTiming[] = [];
  private currentLoadingPhase: LoadingPhaseTiming | null = null;
  private lastFrameTime: number = 0;
  private frameCount: number = 0;
  private fpsUpdateInterval: number = 0;
  
  // Timers
  private flushTimer: number | null = null;
  private batchTimer: number | null = null;
  private performanceTimer: number | null = null;
  
  // Biome tracking
  private currentBiome: string | null = null;
  private biomeEnterTime: number = 0;
  
  // Crash detection
  private isCrashed: boolean = false;
  private heartbeatInterval: number | null = null;

  constructor() {
    // Load saved config and merge with defaults
    const savedConfig = loadConfig();
    this.config = { ...DEFAULT_CONFIG, ...savedConfig };
    
    // Initialize performance metrics
    this.performanceMetrics = {
      fpsHistogram: { at60fps: 0, at30fps: 0, below30fps: 0, totalSamples: 0 },
      frameTimePercentiles: { p50: 0, p95: 0, p99: 0 },
      loadingTimings: [],
      memoryHistory: [],
    };
    
    // Load any previously queued events
    this.queuedEvents = loadQueuedEvents();
    
    // Setup crash detection
    this.setupCrashDetection();
    
    // Setup performance tracking
    this.setupPerformanceTracking();
    
    if (this.config.debug) {
      console.log('[Analytics] System initialized', { config: this.config });
    }
  }

  // ========================================================================
  // Configuration & Opt-in
  // ========================================================================

  /**
   * Check if opt-in prompt should be shown
   */
  shouldShowOptIn(): boolean {
    const storage = safeLocalStorage();
    if (!storage) return false;
    
    const shown = storage.getItem(STORAGE_KEYS.OPT_IN_SHOWN);
    return !shown && this.config.optIn === undefined;
  }

  /**
   * Mark opt-in prompt as shown
   */
  markOptInShown(): void {
    const storage = safeLocalStorage();
    if (storage) {
      storage.setItem(STORAGE_KEYS.OPT_IN_SHOWN, 'true');
    }
  }

  /**
   * Set user opt-in preference
   * @param enabled - Whether user opts in to analytics
   * @param localOnly - If true, data never leaves device
   */
  setOptIn(enabled: boolean, localOnly: boolean = false): void {
    this.config.optIn = enabled;
    this.config.enabled = enabled;
    this.config.localOnly = localOnly;
    
    if (enabled) {
      // Generate new session ID on opt-in
      this.config.sessionId = generateSessionId();
      this.startSession();
    } else {
      this.endSession();
      this.clear();
    }
    
    saveConfig(this.config);
    
    if (this.config.debug) {
      console.log('[Analytics] Opt-in set:', { enabled, localOnly });
    }
  }

  /**
   * Toggle analytics on/off
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    
    if (enabled && !this.session) {
      this.startSession();
    } else if (!enabled && this.session) {
      this.endSession();
    }
    
    saveConfig(this.config);
  }

  /**
   * Check if analytics is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled && this.session !== null;
  }

  /**
   * Check if in local-only mode
   */
  isLocalOnly(): boolean {
    return this.config.localOnly;
  }

  // ========================================================================
  // Session Management
  // ========================================================================

  /**
   * Start a new analytics session
   */
  startSession(): void {
    if (!this.config.enabled) return;
    if (!shouldSample(this.config.sampleRate)) return;
    
    // End any existing session first
    if (this.session) {
      this.endSession();
    }
    
    const sessionId = this.config.sessionId || generateSessionId();
    this.config.sessionId = sessionId;
    
    this.session = {
      id: sessionId,
      startTime: Date.now(),
      crashed: false,
      biomesVisited: new Map(),
      distanceTraveled: 0,
      areasDiscovered: new Set(),
      entitiesDiscovered: new Set(),
      abilitiesUsed: new Map(),
      itemsCollected: new Map(),
      unlocksAchieved: [],
      milestonesReached: [],
    };
    
    // Track session start event
    this.trackEventInternal('session_start', {
      sessionId,
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      language: navigator.language,
      platform: navigator.platform,
    });
    
    // Setup timers
    this.setupTimers();
    
    // Start heartbeat for crash detection
    this.startHeartbeat();
    
    if (this.config.debug) {
      console.log('[Analytics] Session started:', sessionId);
    }
  }

  /**
   * End the current session
   */
  endSession(): void {
    if (!this.session) return;
    
    // Record any pending biome time
    if (this.currentBiome) {
      const timeSpent = Date.now() - this.biomeEnterTime;
      const current = this.session.biomesVisited.get(this.currentBiome) || 0;
      this.session.biomesVisited.set(this.currentBiome, current + timeSpent);
    }
    
    this.session.endTime = Date.now();
    this.session.duration = this.session.endTime - this.session.startTime;
    
    // Track session end
    this.trackEventInternal('session_end', {
      duration: this.session.duration,
      biomesVisited: Array.from(this.session.biomesVisited.entries()),
      entitiesDiscovered: Array.from(this.session.entitiesDiscovered),
      unlocksAchieved: this.session.unlocksAchieved,
      crashed: this.isCrashed,
    });
    
    // Flush remaining events
    this.flush();
    
    // Send final batch if not local only
    if (!this.config.localOnly && this.config.endpoint) {
      this.sendBatch();
    }
    
    // Cleanup
    this.cleanupTimers();
    this.stopHeartbeat();
    
    if (this.config.debug) {
      console.log('[Analytics] Session ended:', {
        duration: this.session.duration,
        crashed: this.isCrashed,
      });
    }
    
    this.session = null;
  }

  /**
   * Get current session data
   */
  getSession(): SessionData | null {
    return this.session;
  }

  // ========================================================================
  // Event Tracking
  // ========================================================================

  /**
   * Track a custom event
   */
  trackEvent(type: EventType, properties: Record<string, unknown> = {}): void {
    if (!this.config.enabled || !this.session) return;
    
    this.trackEventInternal(type, properties);
  }

  /**
   * Track exploration metrics
   */
  trackExploration(type: 'distance' | 'biome_enter' | 'biome_exit' | 'area_discovered', data: unknown): void {
    if (!this.session) return;
    
    switch (type) {
      case 'distance': {
        const distance = data as number;
        this.session.distanceTraveled += distance;
        // Batch distance updates - don't track every small movement
        if (this.session.distanceTraveled % 100 < distance) {
          this.trackEventInternal('distance_traveled', {
            totalDistance: Math.floor(this.session.distanceTraveled),
          });
        }
        break;
      }
      case 'biome_enter': {
        const biome = data as string;
        
        // Record time in previous biome
        if (this.currentBiome) {
          const timeSpent = Date.now() - this.biomeEnterTime;
          const current = this.session.biomesVisited.get(this.currentBiome) || 0;
          this.session.biomesVisited.set(this.currentBiome, current + timeSpent);
          
          this.trackEventInternal('biome_exited', {
            biome: this.currentBiome,
            timeSpent,
          });
        }
        
        this.currentBiome = biome;
        this.biomeEnterTime = Date.now();
        
        this.trackEventInternal('biome_entered', { biome });
        break;
      }
      case 'biome_exit': {
        if (this.currentBiome) {
          const timeSpent = Date.now() - this.biomeEnterTime;
          const current = this.session.biomesVisited.get(this.currentBiome) || 0;
          this.session.biomesVisited.set(this.currentBiome, current + timeSpent);
          
          this.trackEventInternal('biome_exited', {
            biome: this.currentBiome,
            timeSpent,
          });
          
          this.currentBiome = null;
        }
        break;
      }
      case 'area_discovered': {
        const area = data as string;
        this.session.areasDiscovered.add(area);
        this.trackEventInternal('area_discovered', { area });
        break;
      }
    }
  }

  /**
   * Track entity discovery
   */
  trackEntityDiscovered(entityType: string, entityId: string, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    this.session.entitiesDiscovered.add(entityId);
    this.trackEventInternal('entity_discovered', {
      entityType,
      entityId,
      ...properties,
    });
  }

  /**
   * Track ability usage
   */
  trackAbilityUsed(abilityName: string, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    const current = this.session.abilitiesUsed.get(abilityName) || 0;
    this.session.abilitiesUsed.set(abilityName, current + 1);
    
    this.trackEventInternal('ability_used', {
      ability: abilityName,
      count: current + 1,
      ...properties,
    });
  }

  /**
   * Track item collection
   */
  trackItemCollected(itemName: string, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    const current = this.session.itemsCollected.get(itemName) || 0;
    this.session.itemsCollected.set(itemName, current + 1);
    
    this.trackEventInternal('item_collected', {
      item: itemName,
      count: current + 1,
      ...properties,
    });
  }

  /**
   * Track unlock achievement
   */
  trackUnlockAchieved(unlockId: string, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    if (!this.session.unlocksAchieved.includes(unlockId)) {
      this.session.unlocksAchieved.push(unlockId);
      this.trackEventInternal('unlock_achieved', {
        unlockId,
        ...properties,
      });
    }
  }

  /**
   * Track milestone reached
   */
  trackMilestoneReached(milestoneId: string, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    if (!this.session.milestonesReached.includes(milestoneId)) {
      this.session.milestonesReached.push(milestoneId);
      this.trackEventInternal('milestone_reached', {
        milestoneId,
        ...properties,
      });
    }
  }

  /**
   * Internal event tracking
   */
  private trackEventInternal(type: EventType, properties: Record<string, unknown> = {}): void {
    if (!this.session) return;
    
    const event: AnalyticsEvent = {
      type,
      timestamp: getTimestamp(),
      sessionId: this.session.id,
      properties,
      sessionTime: Date.now() - this.session.startTime,
    };
    
    this.eventBuffer.push(event);
    
    // Notify external providers
    this.externalProviders.forEach(provider => {
      try {
        provider.track(type, properties);
      } catch (e) {
        // Ignore external provider errors
      }
    });
    
    // Flush if buffer is full
    if (this.eventBuffer.length >= this.config.maxBufferSize) {
      this.flush();
    }
    
    if (this.config.debug) {
      console.log('[Analytics] Event:', event);
    }
  }

  // ========================================================================
  // Performance Tracking
  // ========================================================================

  /**
   * Track a performance metric
   */
  trackPerformance(metric: string, value: number, properties: Record<string, unknown> = {}): void {
    if (!this.config.enabled) return;
    
    this.trackEventInternal(`perf_${metric}`, {
      value,
      ...properties,
    });
  }

  /**
   * Start tracking a loading phase
   */
  startLoadingPhase(phase: string): void {
    this.currentLoadingPhase = {
      phase,
      startTime: performance.now(),
      duration: 0,
    };
  }

  /**
   * End tracking a loading phase
   */
  endLoadingPhase(phase: string): void {
    if (this.currentLoadingPhase && this.currentLoadingPhase.phase === phase) {
      this.currentLoadingPhase.duration = performance.now() - this.currentLoadingPhase.startTime;
      this.loadingTimings.push({ ...this.currentLoadingPhase });
      this.performanceMetrics.loadingTimings.push({ ...this.currentLoadingPhase });
      
      this.trackEventInternal('loading_complete', {
        phase,
        duration: this.currentLoadingPhase.duration,
      });
      
      this.currentLoadingPhase = null;
    }
  }

  /**
   * Record frame time for performance analysis
   * Call this from your render loop
   */
  recordFrameTime(deltaTime: number): void {
    if (!this.config.enabled) return;
    
    const now = performance.now();
    
    // Calculate FPS
    if (this.lastFrameTime > 0) {
      const frameTime = now - this.lastFrameTime;
      this.frameTimes.push(frameTime);
      
      // Keep last 1000 samples
      if (this.frameTimes.length > 1000) {
        this.frameTimes.shift();
      }
      
      // Sample FPS every 500ms
      if (now - this.fpsUpdateInterval > 500) {
        const fps = Math.round(1000 / frameTime);
        this.fpsSamples.push({ fps, timestamp: now });
        
        // Keep last 100 samples
        if (this.fpsSamples.length > 100) {
          this.fpsSamples.shift();
        }
        
        this.fpsUpdateInterval = now;
      }
      
      // Update histogram every 100 frames
      this.frameCount++;
      if (this.frameCount % 100 === 0) {
        this.updateFPSHistogram();
      }
    }
    
    this.lastFrameTime = now;
  }

  /**
   * Record memory snapshot
   */
  recordMemorySnapshot(): void {
    if (!this.config.enabled) return;
    
    if (performance && (performance as any).memory) {
      const mem = (performance as any).memory;
      const snapshot: MemorySnapshot = {
        timestamp: Date.now(),
        usedJSHeapSize: Math.round(mem.usedJSHeapSize / 1048576 * 100) / 100, // MB
        totalJSHeapSize: Math.round(mem.totalJSHeapSize / 1048576 * 100) / 100,
        jsHeapSizeLimit: Math.round(mem.jsHeapSizeLimit / 1048576 * 100) / 100,
      };
      
      this.memorySnapshots.push(snapshot);
      this.performanceMetrics.memoryHistory.push(snapshot);
      
      // Keep last 100 snapshots
      if (this.memorySnapshots.length > 100) {
        this.memorySnapshots.shift();
      }
      
      // Warn if memory is high (>80% of limit)
      const usageRatio = snapshot.usedJSHeapSize / snapshot.jsHeapSizeLimit;
      if (usageRatio > 0.8) {
        this.trackEventInternal('memory_warning', {
          usageRatio,
          usedMB: snapshot.usedJSHeapSize,
          limitMB: snapshot.jsHeapSizeLimit,
        });
      }
    }
  }

  /**
   * Update FPS histogram from collected samples
   */
  private updateFPSHistogram(): void {
    if (this.fpsSamples.length === 0) return;
    
    let at60fps = 0;
    let at30fps = 0;
    let below30fps = 0;
    
    this.fpsSamples.forEach(sample => {
      if (sample.fps >= 60) {
        at60fps++;
      } else if (sample.fps >= 30) {
        at30fps++;
      } else {
        below30fps++;
      }
    });
    
    const total = this.fpsSamples.length;
    
    this.performanceMetrics.fpsHistogram = {
      at60fps: Math.round(at60fps / total * 100),
      at30fps: Math.round(at30fps / total * 100),
      below30fps: Math.round(below30fps / total * 100),
      totalSamples: total,
    };
    
    // Calculate frame time percentiles
    if (this.frameTimes.length > 0) {
      const sorted = [...this.frameTimes].sort((a, b) => a - b);
      const len = sorted.length;
      
      this.performanceMetrics.frameTimePercentiles = {
        p50: sorted[Math.floor(len * 0.5)],
        p95: sorted[Math.floor(len * 0.95)],
        p99: sorted[Math.floor(len * 0.99)],
      };
    }
  }

  /**
   * Get current FPS histogram
   */
  getFPSHistogram(): FPSHistogram {
    return { ...this.performanceMetrics.fpsHistogram };
  }

  /**
   * Get frame time percentiles
   */
  getFrameTimePercentiles(): FrameTimePercentiles {
    return { ...this.performanceMetrics.frameTimePercentiles };
  }

  // ========================================================================
  // Storage & Batching
  // ========================================================================

  /**
   * Flush events to localStorage
   */
  flush(): void {
    if (this.eventBuffer.length === 0) return;
    
    // Add to queued events
    this.queuedEvents.push(...this.eventBuffer);
    
    // Save to localStorage
    saveQueuedEvents(this.queuedEvents);
    
    if (this.config.debug) {
      console.log('[Analytics] Flushed', this.eventBuffer.length, 'events');
    }
    
    // Clear buffer
    this.eventBuffer = [];
  }

  /**
   * Send batched events to backend
   */
  private async sendBatch(): Promise<void> {
    if (this.config.localOnly || !this.config.endpoint) return;
    if (this.queuedEvents.length === 0) return;
    
    // Check online status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (this.config.debug) {
        console.log('[Analytics] Offline - batch queued for later');
      }
      return;
    }
    
    const batch = this.queuedEvents.splice(0, 100); // Send max 100 at a time
    
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.session?.id,
          events: batch,
          timestamp: getTimestamp(),
        }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      // Save remaining events
      saveQueuedEvents(this.queuedEvents);
      
      if (this.config.debug) {
        console.log('[Analytics] Sent batch:', batch.length, 'events');
      }
    } catch (e) {
      // Put events back in queue
      this.queuedEvents.unshift(...batch);
      saveQueuedEvents(this.queuedEvents);
      
      if (this.config.debug) {
        console.warn('[Analytics] Failed to send batch:', e);
      }
    }
  }

  /**
   * Setup flush and batch timers
   */
  private setupTimers(): void {
    if (typeof window === 'undefined') return;
    
    // Periodic flush to localStorage
    this.flushTimer = window.setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
    
    // Periodic batch send to backend
    if (!this.config.localOnly && this.config.endpoint) {
      this.batchTimer = window.setInterval(() => {
        this.sendBatch();
      }, this.config.batchIntervalMs);
    }
    
    // Memory snapshot every 30 seconds
    this.performanceTimer = window.setInterval(() => {
      this.recordMemorySnapshot();
    }, 30000);
  }

  /**
   * Cleanup timers
   */
  private cleanupTimers(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }
  }

  // ========================================================================
  // Crash Detection
  // ========================================================================

  /**
   * Setup crash detection
   */
  private setupCrashDetection(): void {
    if (typeof window === 'undefined') return;
    
    // Listen for beforeunload to detect clean exits
    window.addEventListener('beforeunload', () => {
      this.endSession();
    });
    
    // Listen for errors
    window.addEventListener('error', (event) => {
      this.trackEventInternal('session_crashed', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      });
      this.isCrashed = true;
      this.flush();
    });
    
    // Listen for unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.trackEventInternal('session_crashed', {
        type: 'unhandled_promise',
        reason: String(event.reason),
      });
      this.isCrashed = true;
      this.flush();
    });
  }

  /**
   * Start heartbeat for crash detection
   */
  private startHeartbeat(): void {
    if (typeof window === 'undefined') return;
    
    // Send heartbeat every 10 seconds
    this.heartbeatInterval = window.setInterval(() => {
      if (this.session) {
        // Store last heartbeat time
        const storage = safeLocalStorage();
        if (storage) {
          storage.setItem('candy_world_analytics_heartbeat', String(Date.now()));
        }
      }
    }, 10000);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ========================================================================
  // Performance Tracking Setup
  // ========================================================================

  /**
   * Setup performance tracking
   */
  private setupPerformanceTracking(): void {
    if (typeof window === 'undefined') return;
    
    // Listen for visibility changes (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.trackEventInternal('app_backgrounded', {});
        this.flush();
      } else {
        this.trackEventInternal('app_foregrounded', {});
      }
    });
  }

  // ========================================================================
  // External Analytics Providers
  // ========================================================================

  /**
   * Register an external analytics provider
   */
  registerProvider(provider: ExternalAnalyticsProvider): void {
    this.externalProviders.push(provider);
    
    // Identify with current session
    if (this.session) {
      try {
        provider.identify(this.session.id);
      } catch (e) {
        // Ignore errors
      }
    }
  }

  /**
   * Unregister an external provider
   */
  unregisterProvider(name: string): void {
    this.externalProviders = this.externalProviders.filter(p => p.name !== name);
  }

  // ========================================================================
  // Data Export & Management
  // ========================================================================

  /**
   * Export all collected data as JSON
   */
  exportData(): AnalyticsExport {
    // Flush any pending events
    this.flush();
    
    // Combine all events
    const allEvents = [...this.queuedEvents, ...this.eventBuffer];
    
    // Convert Maps and Sets to arrays for serialization
    const sessionData: SessionData = this.session ? {
      ...this.session,
      biomesVisited: new Map(this.session.biomesVisited),
      areasDiscovered: new Set(this.session.areasDiscovered),
      entitiesDiscovered: new Set(this.session.entitiesDiscovered),
      abilitiesUsed: new Map(this.session.abilitiesUsed),
      itemsCollected: new Map(this.session.itemsCollected),
    } : {
      id: 'none',
      startTime: 0,
      crashed: false,
      biomesVisited: new Map(),
      distanceTraveled: 0,
      areasDiscovered: new Set(),
      entitiesDiscovered: new Set(),
      abilitiesUsed: new Map(),
      itemsCollected: new Map(),
      unlocksAchieved: [],
      milestonesReached: [],
    };
    
    return {
      version: ANALYTICS_VERSION,
      exportedAt: getTimestamp(),
      session: sessionData,
      events: allEvents,
      performance: { ...this.performanceMetrics },
      appVersion: '1.0.0', // Should match package.json
      userAgent: navigator.userAgent,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
    };
  }

  /**
   * Export data as a downloadable JSON file
   */
  downloadExport(): void {
    const data = this.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `candy-world-analytics-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    URL.revokeObjectURL(url);
    
    if (this.config.debug) {
      console.log('[Analytics] Data exported');
    }
  }

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.eventBuffer = [];
    this.queuedEvents = [];
    this.frameTimes = [];
    this.fpsSamples = [];
    this.memorySnapshots = [];
    this.loadingTimings = [];
    
    // Clear localStorage
    const storage = safeLocalStorage();
    if (storage) {
      storage.removeItem(STORAGE_KEYS.EVENTS);
      storage.removeItem(STORAGE_KEYS.CONFIG);
    }
    
    if (this.config.debug) {
      console.log('[Analytics] All data cleared');
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): AnalyticsConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<AnalyticsConfig>): void {
    this.config = { ...this.config, ...updates };
    saveConfig(this.config);
  }

  /**
   * Get debug statistics
   */
  getDebugStats(): {
    bufferSize: number;
    queuedEvents: number;
    sessionActive: boolean;
    fpsHistogram: FPSHistogram;
    frameTimePercentiles: FrameTimePercentiles;
  } {
    return {
      bufferSize: this.eventBuffer.length,
      queuedEvents: this.queuedEvents.length,
      sessionActive: this.session !== null,
      fpsHistogram: this.getFPSHistogram(),
      frameTimePercentiles: this.getFrameTimePercentiles(),
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global analytics system instance */
export const analytics = new AnalyticsSystem();

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Track a custom event
 * @param name - Event name
 * @param properties - Event properties
 */
export function trackEvent(name: EventType, properties: Record<string, unknown> = {}): void {
  analytics.trackEvent(name, properties);
}

/**
 * Track a performance metric
 * @param metric - Metric name
 * @param value - Metric value
 * @param properties - Additional properties
 */
export function trackPerformance(metric: string, value: number, properties: Record<string, unknown> = {}): void {
  analytics.trackPerformance(metric, value, properties);
}

/**
 * Track exploration metrics
 * @param type - Exploration type
 * @param data - Exploration data
 */
export function trackExploration(
  type: 'distance' | 'biome_enter' | 'biome_exit' | 'area_discovered',
  data: unknown
): void {
  analytics.trackExploration(type, data);
}

/**
 * Track entity discovery
 * @param entityType - Type of entity
 * @param entityId - Unique entity identifier
 * @param properties - Additional properties
 */
export function trackEntityDiscovered(
  entityType: string,
  entityId: string,
  properties: Record<string, unknown> = {}
): void {
  analytics.trackEntityDiscovered(entityType, entityId, properties);
}

/**
 * Track ability usage
 * @param abilityName - Name of ability
 * @param properties - Additional properties
 */
export function trackAbilityUsed(abilityName: string, properties: Record<string, unknown> = {}): void {
  analytics.trackAbilityUsed(abilityName, properties);
}

/**
 * Track item collection
 * @param itemName - Name of item
 * @param properties - Additional properties
 */
export function trackItemCollected(itemName: string, properties: Record<string, unknown> = {}): void {
  analytics.trackItemCollected(itemName, properties);
}

/**
 * Track unlock achievement
 * @param unlockId - Unlock identifier
 * @param properties - Additional properties
 */
export function trackUnlockAchieved(unlockId: string, properties: Record<string, unknown> = {}): void {
  analytics.trackUnlockAchieved(unlockId, properties);
}

/**
 * Track milestone reached
 * @param milestoneId - Milestone identifier
 * @param properties - Additional properties
 */
export function trackMilestoneReached(milestoneId: string, properties: Record<string, unknown> = {}): void {
  analytics.trackMilestoneReached(milestoneId, properties);
}

// Default export
export default analytics;
