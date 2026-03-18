/**
 * @file analytics-usage-example.ts
 * @brief Example usage of the analytics system
 * 
 * This file demonstrates how to integrate analytics into the game.
 * Copy relevant snippets to main.ts or appropriate game modules.
 */

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

import { toggleAnalyticsDebug } from '../src/ui/analytics-debug';

// ============================================================================
// 1. INITIALIZATION (call during game startup)
// ============================================================================

export function initAnalytics(): void {
  // Check if this is first launch
  if (analytics.shouldShowOptIn()) {
    showAnalyticsOptInPrompt();
  }

  // Register console command
  if (typeof window !== 'undefined') {
    // Player can type /stats in console to toggle debug overlay
    (window as any).toggleAnalyticsDebug = toggleAnalyticsDebug;
  }
}

// ============================================================================
// 2. OPT-IN PROMPT (show on first launch)
// ============================================================================

function showAnalyticsOptInPrompt(): void {
  // Create a nice modal/dialog for the user
  const dialog = document.createElement('div');
  dialog.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0,0,0,0.95);
      border: 2px solid #ff69b4;
      border-radius: 16px;
      padding: 30px;
      max-width: 400px;
      color: #fff;
      z-index: 10000;
      font-family: sans-serif;
    ">
      <h2 style="color: #ff69b4; margin-top: 0;">🍭 Help Improve Candy World</h2>
      <p>We'd love to understand how players explore the game.</p>
      <ul style="color: #ccc; font-size: 14px;">
        <li>✅ Anonymous data only</li>
        <li>✅ No personal information</li>
        <li>✅ You can opt out anytime</li>
      </ul>
      <div style="margin-top: 20px; display: flex; gap: 10px;">
        <button id="analytics-opt-in" style="
          flex: 1;
          padding: 12px;
          background: linear-gradient(90deg, #ff69b4, #ff1493);
          border: none;
          border-radius: 8px;
          color: #fff;
          cursor: pointer;
          font-weight: bold;
        ">Enable Analytics</button>
        <button id="analytics-opt-out" style="
          flex: 1;
          padding: 12px;
          background: rgba(255,255,255,0.1);
          border: 1px solid #555;
          border-radius: 8px;
          color: #fff;
          cursor: pointer;
        ">No Thanks</button>
      </div>
      <p style="font-size: 11px; color: #888; margin-top: 15px;">
        <a href="/docs/ANALYTICS.md" target="_blank" style="color: #ff69b4;">Learn more about our privacy policy</a>
      </p>
    </div>
  `;
  
  document.body.appendChild(dialog);
  analytics.markOptInShown();

  // Handle button clicks
  document.getElementById('analytics-opt-in')?.addEventListener('click', () => {
    analytics.setOptIn(true, false); // Enable, allow cloud
    dialog.remove();
    console.log('Analytics enabled - thank you!');
  });

  document.getElementById('analytics-opt-out')?.addEventListener('click', () => {
    analytics.setOptIn(false, false); // Disable
    dialog.remove();
  });
}

// ============================================================================
// 3. GAMEPLAY TRACKING EXAMPLES
// ============================================================================

/**
 * Call when player enters a new biome/area
 */
export function onBiomeEnter(biomeName: string): void {
  trackExploration('biome_enter', biomeName);
}

/**
 * Call when player leaves a biome
 */
export function onBiomeExit(biomeName: string): void {
  trackExploration('biome_exit', biomeName);
}

/**
 * Call periodically to track distance traveled
 */
export function onPlayerMove(distanceMeters: number): void {
  trackExploration('distance', distanceMeters);
}

/**
 * Call when player discovers a new entity type
 */
export function onEntityDiscovered(entityType: string, entityId: string, details: Record<string, unknown>): void {
  trackEntityDiscovered(entityType, entityId, details);
}

/**
 * Call when player uses an ability
 */
export function onAbilityUsed(abilityName: string, context: Record<string, unknown>): void {
  trackAbilityUsed(abilityName, context);
}

/**
 * Call when player collects an item
 */
export function onItemCollected(itemName: string, quantity: number = 1): void {
  trackItemCollected(itemName, { quantity });
}

/**
 * Call when player earns an unlock
 */
export function onUnlockAchieved(unlockId: string): void {
  trackUnlockAchieved(unlockId);
}

/**
 * Call when player reaches a milestone
 */
export function onMilestoneReached(milestoneId: string, value?: number): void {
  trackMilestoneReached(milestoneId, { value });
}

// ============================================================================
// 4. PERFORMANCE TRACKING EXAMPLES
// ============================================================================

/**
 * Track loading phase timing
 */
export function trackLoadingPhase(phaseName: string, durationMs: number): void {
  trackPerformance('loading', durationMs, { phase: phaseName });
}

/**
 * Track frame drop events
 */
export function onFPSDrop(fps: number, durationMs: number): void {
  trackEvent('fps_drop', { fps, duration: durationMs });
}

/**
 * Track memory pressure
 */
export function onMemoryWarning(usedMB: number, limitMB: number): void {
  trackEvent('memory_warning', { 
    usedMB, 
    limitMB, 
    ratio: usedMB / limitMB 
  });
}

// ============================================================================
// 5. SPECIFIC GAME FEATURES TRACKING
// ============================================================================

/**
 * Track lake discovery (answers: "Do players find the lake?")
 */
export function onLakeDiscovered(): void {
  trackEvent('lake_discovered', { 
    timestamp: Date.now(),
    sessionTime: analytics.getSession()?.duration || 0 
  });
  trackMilestoneReached('found_the_lake');
}

/**
 * Track blaster usage (answers: "Do they use the blaster?")
 */
export function onBlasterFired(targetType?: string): void {
  trackAbilityUsed('rainbow_blaster', { target: targetType });
}

/**
 * Track where players get stuck
 */
export function onPlayerStuck(location: string, durationMs: number): void {
  trackEvent('player_stuck', { 
    location, 
    duration: durationMs,
    position: getCurrentPosition() // hypothetical function
  });
}

/**
 * Track mushroom interactions
 */
export function onMushroomInteraction(mushroomId: string, interactionType: 'bounce' | 'collect' | 'observe'): void {
  trackEvent('mushroom_interaction', { 
    mushroomId, 
    interactionType 
  });
}

/**
 * Track cloud interactions
 */
export function onCloudInteraction(cloudId: string, action: 'ride' | 'harpoon' | 'land_on'): void {
  trackEvent('cloud_interaction', { 
    cloudId, 
    action 
  });
}

// Helper function (hypothetical)
function getCurrentPosition(): { x: number; y: number; z: number } {
  return { x: 0, y: 0, z: 0 }; // Replace with actual player position
}

// ============================================================================
// 6. INTEGRATION WITH EXISTING SYSTEMS
// ============================================================================

/**
 * Example: Integrate with the interaction system
 */
export function setupInteractionTracking(interactionSystem: any): void {
  // Hook into proximity enter
  const originalProximityEnter = interactionSystem.onProximityEnter;
  interactionSystem.onProximityEnter = (obj: any, distance: number) => {
    if (obj.userData?.analyticsEvent) {
      trackEvent(obj.userData.analyticsEvent, { 
        distance,
        type: 'proximity' 
      });
    }
    return originalProximityEnter?.call(interactionSystem, obj, distance);
  };
}

/**
 * Example: Integrate with unlock system
 */
export function setupUnlockTracking(unlockSystem: any): void {
  const originalUnlock = unlockSystem.unlock;
  unlockSystem.unlock = (unlockId: string) => {
    onUnlockAchieved(unlockId);
    return originalUnlock?.call(unlockSystem, unlockId);
  };
}

// ============================================================================
// 7. DEBUG COMMANDS
// ============================================================================

if (typeof window !== 'undefined') {
  // Expose debug commands
  (window as any).analyticsDebug = {
    // Toggle debug overlay
    toggle: toggleAnalyticsDebug,
    
    // Export data
    export: () => analytics.downloadExport(),
    
    // Get current stats
    stats: () => analytics.getDebugStats(),
    
    // Clear all data
    clear: () => analytics.clear(),
    
    // Enable/disable
    enable: () => analytics.setEnabled(true),
    disable: () => analytics.setEnabled(false),
    
    // Test events
    testEvent: (name: string) => trackEvent(name, { test: true }),
  };
}
