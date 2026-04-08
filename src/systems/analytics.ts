/**
 * @file analytics.ts
 * @brief Privacy-First Analytics & Telemetry System for Candy World
 * 
 * @deprecated This file is kept for backward compatibility.
 * Please import from './analytics/index.ts' or just './analytics/' instead.
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

// Re-export everything from the new analytics module for backward compatibility
export * from './analytics/index.ts';
export { default } from './analytics/index.ts';
