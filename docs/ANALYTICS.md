# Analytics & Telemetry System

**Version:** 1.0.0  
**Last Updated:** March 2025

---

## Overview

Candy World's analytics system is designed with a **privacy-first** approach. We track game performance and player behavior to improve the game experience, but we never collect personal data or use fingerprinting techniques.

### Key Principles

- ✅ **Anonymous only** - Random session IDs, no IP tracking
- ✅ **Opt-in by default** - Clear consent prompt on first launch
- ✅ **Local-only option** - Data never leaves your device
- ✅ **Easy opt-out** - Disable anytime in settings
- ✅ **Transparent** - See exactly what we collect via `/stats` command

---

## Quick Start

### For Players

```typescript
// Toggle analytics debug overlay
/stats              // or call toggleAnalyticsDebug()

// In the debug overlay:
// - Toggle analytics on/off
// - Enable local-only mode
// - Export your data as JSON
// - Clear all stored data
```

### For Developers

```typescript
import { 
  analytics, 
  trackEvent, 
  trackPerformance,
  trackExploration,
  trackAbilityUsed,
  trackEntityDiscovered
} from './systems/analytics';

// Start analytics (after user opt-in)
analytics.setOptIn(true, false);  // (enabled, localOnly)

// Track custom events
trackEvent('entity_discovered', { 
  entityType: 'mushroom', 
  biome: 'meadow' 
});

// Track performance metrics
trackPerformance('loading_time', 2500);

// Track exploration
trackExploration('biome_enter', 'lake');
trackExploration('distance', 50);  // meters traveled

// Track gameplay
trackAbilityUsed('rainbow_blaster', { target: 'cloud' });
trackEntityDiscovered('mushroom', 'mushroom_001', { color: 'red' });

// Export data
const data = analytics.exportData();
analytics.downloadExport();

// Clear all data
analytics.clear();
```

---

## Event Types

### Session Events

| Event | Description | Properties |
|-------|-------------|------------|
| `session_start` | Player started playing | `sessionId`, `userAgent`, `screenResolution` |
| `session_end` | Player ended session | `duration`, `biomesVisited`, `entitiesDiscovered` |
| `session_crashed` | Error/crash detected | `message`, `filename`, `reason` |

### Exploration Events

| Event | Description | Properties |
|-------|-------------|------------|
| `biome_entered` | Player entered a biome | `biome` |
| `biome_exited` | Player left a biome | `biome`, `timeSpent` |
| `distance_traveled` | Movement tracked | `totalDistance` |
| `area_discovered` | New area found | `area` |

### Interaction Events

| Event | Description | Properties |
|-------|-------------|------------|
| `entity_discovered` | First encounter | `entityType`, `entityId` |
| `ability_used` | Ability activation | `ability`, `count`, `target` |
| `item_collected` | Item pickup | `item`, `count` |
| `interaction_made` | Generic interaction | `type`, `target` |

### Progression Events

| Event | Description | Properties |
|-------|-------------|------------|
| `unlock_achieved` | Unlock earned | `unlockId` |
| `milestone_reached` | Milestone hit | `milestoneId` |
| `level_completed` | Level finished | `level`, `time` |

### Performance Events

| Event | Description | Properties |
|-------|-------------|------------|
| `perf_*` | Custom performance | `value`, ... |
| `fps_drop` | FPS below threshold | `fps`, `duration` |
| `loading_complete` | Phase finished | `phase`, `duration` |
| `memory_warning` | High memory usage | `usageRatio`, `usedMB` |

---

## Configuration

```typescript
interface AnalyticsConfig {
  enabled: boolean;           // Master switch
  endpoint?: string | null;   // Backend URL (null = local only)
  sampleRate: number;         // 1.0 = 100%, 0.1 = 10%
  debug: boolean;             // Console logging
  optIn?: boolean;            // User consent
  localOnly: boolean;         // Never send to server
  maxBufferSize: number;      // Events before flush
  flushIntervalMs: number;    // LocalStorage flush (30s)
  batchIntervalMs: number;    // Backend batch (5min)
}
```

### Default Configuration

```typescript
const defaultConfig = {
  enabled: false,           // Disabled until opt-in
  endpoint: null,
  sampleRate: 1.0,
  debug: false,
  localOnly: false,
  maxBufferSize: 1000,
  flushIntervalMs: 30000,
  batchIntervalMs: 300000,
};
```

---

## Privacy-First Design

### What We DON'T Collect

- ❌ IP addresses
- ❌ Device fingerprints
- ❌ Personal identifiers
- ❌ Geographic location
- ❌ Cookies or tracking pixels
- ❌ Third-party data sharing

### What We DO Collect

- ✅ Anonymous random session IDs
- ✅ Gameplay behavior (biomes visited, abilities used)
- ✅ Performance metrics (FPS, loading times)
- ✅ Error reports (for debugging)
- ✅ Device type (desktop/mobile - for optimization)

### Data Storage

| Mode | Storage | Transmission |
|------|---------|--------------|
| **Local Only** | localStorage | Never |
| **Full Analytics** | localStorage + memory | Batched every 5 min |

### Opt-In Flow

```
First Launch
    ↓
Show Privacy Prompt
    ↓
┌─────────────────┐    ┌─────────────────┐
│  Enable Analytics │ or │  Keep Disabled  │
│  [Local Only]     │    │                 │
└─────────────────┘    └─────────────────┘
    ↓                         ↓
Start Session              No tracking
    ↓
Player can toggle in settings anytime
```

---

## Performance Metrics

### FPS Histogram

Tracks percentage of time spent at different frame rates:

```typescript
interface FPSHistogram {
  at60fps: number;      // % time at 60+ FPS (target)
  at30fps: number;      // % time at 30-60 FPS (acceptable)
  below30fps: number;   // % time below 30 FPS (poor)
  totalSamples: number;
}
```

### Frame Time Percentiles

```typescript
interface FrameTimePercentiles {
  p50: number;   // Median frame time (ms)
  p95: number;   // 95th percentile (ms)
  p99: number;   // 99th percentile (ms)
}
```

### Memory Tracking

```typescript
interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;    // MB
  totalJSHeapSize: number;   // MB
  jsHeapSizeLimit: number;   // MB
}
```

### Loading Phase Timings

```typescript
interface LoadingPhaseTiming {
  phase: string;      // e.g., "wasm-init", "world-generation"
  startTime: number;
  duration: number;   // ms
}
```

---

## Debug Overlay

Toggle with `/stats` command or `toggleAnalyticsDebug()`.

### Features

- **FPS Histogram** - Visual bar chart of frame rate distribution
- **Session Stats** - Duration, biomes visited, entities discovered
- **Performance Metrics** - Frame time percentiles, samples collected
- **Event Log** - Recent events with timestamps
- **Controls** - Enable/disable, export, clear data

### Screenshot

```
┌─────────────────────────────┐
│  🍭 Analytics Debug     − × │
├─────────────────────────────┤
│  Performance (FPS)          │
│  ┌─────────────────────┐    │
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░│    │
│  │ 85%  10%    5%      │    │
│  │ 60+  30-60  <30     │    │
│  └─────────────────────┘    │
│                             │
│  Session Stats              │
│  Duration: 15m 32s          │
│  Biomes Visited: 4          │
│  Entities Discovered: 12    │
│                             │
│  [📥 Export Data]           │
│  [🗑️ Clear All Data]        │
└─────────────────────────────┘
```

---

## External Analytics Integration

Compatible with external analytics providers:

```typescript
import { analytics } from './systems/analytics';

// Plausible
const plausibleProvider = {
  name: 'plausible',
  track: (name, props) => {
    if (window.plausible) {
      window.plausible(name, { props });
    }
  },
  identify: (id) => {
    // Plausible doesn't use identify
  }
};

// PostHog
const posthogProvider = {
  name: 'posthog',
  track: (name, props) => {
    if (window.posthog) {
      window.posthog.capture(name, props);
    }
  },
  identify: (id, traits) => {
    if (window.posthog) {
      window.posthog.identify(id, traits);
    }
  }
};

// Register providers
analytics.registerProvider(plausibleProvider);
analytics.registerProvider(posthogProvider);
```

---

## Data Export Format

```typescript
interface AnalyticsExport {
  version: '1.0.0';
  exportedAt: '2025-03-19T00:00:00.000Z';
  appVersion: '1.0.0';
  userAgent: 'Mozilla/5.0...';
  screenResolution: '1920x1080';
  
  session: {
    id: 'a1b2c3d4...';
    startTime: 1710800000000;
    duration: 932000;
    crashed: false;
    biomesVisited: [['meadow', 300000], ['lake', 200000]];
    distanceTraveled: 1543.5;
    areasDiscovered: ['lake_shore', 'mushroom_grove'];
    entitiesDiscovered: ['mushroom_001', 'cloud_005'];
    abilitiesUsed: [['rainbow_blaster', 15], ['harpoon', 3]];
    itemsCollected: [['crystal', 7], ['pollen', 23]];
    unlocksAchieved: ['double_jump', 'blaster_unlock'];
    milestonesReached: ['first_mushroom', '1000m_traveled'];
  };
  
  events: [
    {
      type: 'session_start';
      timestamp: '2025-03-19T00:00:00.000Z';
      sessionId: 'a1b2c3d4...';
      sessionTime: 0;
      properties: { ... };
    },
    // ... more events
  ];
  
  performance: {
    fpsHistogram: { at60fps: 85, at30fps: 10, below30fps: 5 };
    frameTimePercentiles: { p50: 15.2, p95: 18.5, p99: 25.1 };
    loadingTimings: [...];
    memoryHistory: [...];
  };
}
```

---

## Privacy Policy Template

> **Copy this for your game's privacy policy:**

---

### Candy World Analytics Privacy Policy

**Last Updated:** March 19, 2025

#### What Data We Collect

Candy World uses an anonymous analytics system to help us improve the game. We collect:

**Gameplay Data (Anonymous)**
- Which areas of the game you explore
- Abilities you use and items you collect
- Unlocks and milestones you achieve
- Session duration and game completion

**Performance Data (Anonymous)**
- Frame rate (FPS) statistics
- Loading times
- Memory usage
- Error reports when crashes occur

**Technical Data (Anonymous)**
- Browser/device type (for optimization)
- Screen resolution
- Anonymous session identifier (randomly generated)

#### What We Don't Collect

We do NOT collect:
- Your name, email, or any personal information
- Your IP address
- Precise location
- Data from outside the game
- Cookies or tracking identifiers

#### How We Use Data

- **Improve Performance** - Identify lag and optimize frame rates
- **Fix Bugs** - Understand crashes and errors
- **Balance Gameplay** - See which areas are too hard or easy
- **Guide Development** - Understand what features players enjoy

#### Data Storage

- Data is stored locally on your device by default
- If you enable cloud analytics, data is sent to our servers in batches
- All data is anonymous and cannot identify you personally
- You can export or delete your data at any time via the `/stats` command

#### Your Choices

**Opt-In/Opt-Out**
- Analytics is disabled by default
- You'll be asked to opt-in on first launch
- You can change this anytime in settings or via `/stats`

**Local-Only Mode**
- Choose "Local Only" to keep data on your device
- No data is sent to our servers
- You can still export your data manually

**Data Export**
- Use `/stats` → "Export Data" to download your data as JSON
- Review exactly what information we have

**Data Deletion**
- Use `/stats` → "Clear All Data" to delete everything
- Or disable analytics to stop collection

#### Contact Us

If you have questions about our analytics practices, contact us at:
- Email: privacy@candyworld.game
- Discord: #privacy-support

#### Changes to This Policy

We may update this policy. Check the "Last Updated" date above. Significant changes will be announced in-game.

---

## Best Practices

### For Game Developers

1. **Always ask for opt-in** - Never enable analytics without consent
2. **Default to local-only** - Let users choose cloud analytics separately
3. **Be transparent** - Show exactly what data is collected
4. **Respect opt-out** - Immediately stop tracking when disabled
5. **Minimize data** - Only collect what's needed for improvements

### Integration Checklist

- [ ] Add privacy prompt on first launch
- [ ] Include opt-out in settings menu
- [ ] Document all tracked events
- [ ] Test data export functionality
- [ ] Verify local-only mode works
- [ ] Add privacy policy to website
- [ ] Test crash detection
- [ ] Verify FPS tracking accuracy

---

## Troubleshooting

### Analytics not working?

```typescript
// Check if enabled
console.log(analytics.isEnabled());

// Check config
console.log(analytics.getConfig());

// Enable debug mode
analytics.updateConfig({ debug: true });

// Check for errors in console
```

### Events not appearing?

1. Verify analytics is enabled: `analytics.isEnabled()`
2. Check session is active: `analytics.getSession()`
3. Enable debug mode to see events logged
4. Check browser console for errors

### Data not exporting?

1. Ensure events are being tracked
2. Check localStorage is available (not blocked)
3. Try manually triggering flush: `analytics.flush()`
4. Check for errors in console

---

## API Reference

See inline JSDoc comments in:
- `src/systems/analytics.ts` - Core analytics system
- `src/ui/analytics-debug.ts` - Debug overlay

---

## Questions?

- Check the debug overlay: `/stats`
- Review your data: `analytics.exportData()`
- Contact: analytics-support@candyworld.game
