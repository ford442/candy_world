/**
 * @file index.ts
 * @brief Analytics System barrel export
 * 
 * Privacy-First Analytics & Telemetry System for Candy World
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
// Re-export all types and utilities
// ============================================================================

export * from './types.ts';

// ============================================================================
// Export core classes and singleton
// ============================================================================

export { AnalyticsSystem, analytics } from './core.ts';

// ============================================================================
// Export performance tracker
// ============================================================================

export { PerformanceTracker } from './performance.ts';

// ============================================================================
// Convenience Functions
// ============================================================================

import { analytics } from './core.ts';
import type { EventType } from './types.ts';

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

// ============================================================================
// Default export
// ============================================================================

export { analytics as default } from './core.ts';
