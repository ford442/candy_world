/**
 * @file core.ts
 * @brief Core Analytics System
 * 
 * Privacy-first analytics system for Candy World.
 * Tracks player behavior with anonymous session IDs, opt-in consent,
 * and local-only mode support.
 */

import {
  type AnalyticsConfig,
  type AnalyticsEvent,
  type AnalyticsExport,
  type EventType,
  type ExternalAnalyticsProvider,
  type FPSHistogram,
  type FrameTimePercentiles,
  type SessionData,
  DEFAULT_CONFIG,
  STORAGE_KEYS,
  ANALYTICS_VERSION,
  generateSessionId,
  getTimestamp,
  safeLocalStorage,
  shouldSample,
  loadConfig,
  saveConfig,
  loadQueuedEvents,
  saveQueuedEvents,
} from './types.ts';

import { PerformanceTracker } from './performance.ts';

/**
 * Privacy-first analytics system for Candy World
 */
export class AnalyticsSystem {
  private config: AnalyticsConfig;
  private session: SessionData | null = null;
  private eventBuffer: AnalyticsEvent[] = [];
  private queuedEvents: AnalyticsEvent[] = [];
  private externalProviders: ExternalAnalyticsProvider[] = [];
  
  // Performance tracking
  private performanceTracker: PerformanceTracker;
  
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
    
    // Initialize performance tracker
    this.performanceTracker = new PerformanceTracker();
    this.performanceTracker.initialize(this.config.enabled, this.trackEventInternal.bind(this));
    
    // Load any previously queued events
    this.queuedEvents = loadQueuedEvents();
    
    // Setup crash detection
    this.setupCrashDetection();
    
    // Setup performance tracking
    this.performanceTracker.setupPerformanceTracking(this.trackEventInternal.bind(this));
    
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
    
    this.performanceTracker.setEnabled(enabled);
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
    this.performanceTracker.setEnabled(enabled);
    
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
  // Performance Tracking (delegates to PerformanceTracker)
  // ========================================================================

  /**
   * Track a performance metric
   */
  trackPerformance(metric: string, value: number, properties: Record<string, unknown> = {}): void {
    this.performanceTracker.trackPerformance(metric, value, properties);
  }

  /**
   * Start tracking a loading phase
   */
  startLoadingPhase(phase: string): void {
    this.performanceTracker.startLoadingPhase(phase);
  }

  /**
   * End tracking a loading phase
   */
  endLoadingPhase(phase: string): void {
    this.performanceTracker.endLoadingPhase(phase);
  }

  /**
   * Record frame time for performance analysis
   * Call this from your render loop
   */
  recordFrameTime(deltaTime: number): void {
    this.performanceTracker.recordFrameTime(deltaTime);
  }

  /**
   * Record memory snapshot
   */
  recordMemorySnapshot(): void {
    this.performanceTracker.recordMemorySnapshot();
  }

  /**
   * Get current FPS histogram
   */
  getFPSHistogram(): FPSHistogram {
    return this.performanceTracker.getFPSHistogram();
  }

  /**
   * Get frame time percentiles
   */
  getFrameTimePercentiles(): FrameTimePercentiles {
    return this.performanceTracker.getFrameTimePercentiles();
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
      performance: this.performanceTracker.getPerformanceMetrics(),
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
    
    // Clear performance tracker
    this.performanceTracker.clear();
    
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
    this.performanceTracker.setEnabled(this.config.enabled);
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
