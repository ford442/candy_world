# Spatial Hash Optimization - Validation Guide

## Overview

This guide explains how to validate the spatial hash optimization and measure its performance impact, fulfilling the "Step 0: Profile First" requirement from `PERFORMANCE_MIGRATION_STRATEGY.md`.

## Prerequisites

The optimization has been implemented with:
- ✅ Spatial hash grid utility (`src/utils/spatial-hash.js`)
- ✅ Integration into physics system (`src/systems/physics.js`)
- ✅ Profiler measurements added
- ✅ Unit tests passing (3.7x speedup confirmed)

## How to Profile and Validate

### Step 1: Start the Development Server

```bash
npm run dev
```

The dev server will start at `http://localhost:5173`

### Step 2: Enable the Profiler

1. Open the application in your browser
2. Press the **'P'** key to toggle the profiler
3. The profiler UI will appear in the bottom-right corner

### Step 3: Navigate to Collision-Heavy Areas

Move the player to areas with many collision objects:
- **Mushroom patches** (20-30 mushrooms clustered together)
- **Cloud layers** (15-20 clouds in sky)
- **Cave entrances** with water gates
- **Vine swing areas**

### Step 4: Monitor Profiler Metrics

Watch for these measurements in the profiler UI:

```
Frame: X.Xms (XX FPS)
Physics: X.Xms          ← Total physics time
  Collisions: X.Xms     ← Collision detection time (our target)
  VineAttach: X.Xms     ← Vine attachment checks
```

### Step 5: Check Console Logs

On startup, the console will show spatial hash statistics:

```
[Physics] Spatial Hash Grids Initialized:
  - Caves: { totalObjects: 15, cellsUsed: 12, avgObjectsPerCell: '1.25', cellSize: 10 }
  - Mushrooms: { totalObjects: 25, cellsUsed: 18, avgObjectsPerCell: '1.39', cellSize: 10 }
  - Clouds: { totalObjects: 18, cellsUsed: 15, avgObjectsPerCell: '1.20', cellSize: 10 }
  - Vines: { totalObjects: 8, cellsUsed: 7, avgObjectsPerCell: '1.14', cellSize: 10 }
```

### Step 6: Look for Lag Spikes

If the profiler detects a frame > 34ms, it will log a warning:

```
⚠️ LAG SPIKE: 45.2ms
┌─────────┬──────────────┬────────┬────────────┐
│ (index) │   System     │ Time   │ % of Frame │
├─────────┼──────────────┼────────┼────────────┤
│    0    │  'Physics'   │ '5.23' │   '11.6%'  │
│    1    │  'Weather'   │ '4.12' │    '9.1%'  │
│    2    │ 'Collisions' │ '0.82' │    '1.8%'  │  ← Should be low!
└─────────┴──────────────┴────────┴────────────┘
```

**Success Criteria:**
- `Collisions` should be **< 2ms** most of the time
- `Collisions` should represent **< 10%** of frame time
- No collision-related lag spikes when moving through dense object areas

## Expected Performance Baseline

### Before Optimization (Hypothetical)
Based on 60 objects with O(N) linear scan:
- Collision time: 2-4ms per frame
- Percentage: 12-24% of 16.67ms frame budget
- Objects checked: 60 per frame

### After Optimization (Target)
With spatial hash reducing to ~5 objects per frame:
- Collision time: 0.5-1.0ms per frame (70-80% reduction)
- Percentage: 3-6% of frame budget
- Objects checked: 2-5 per frame (from 3x3 grid query)

## Performance Migration Decision Tree

Per `PERFORMANCE_MIGRATION_STRATEGY.md`:

### If Collision Time < 2ms/frame
✅ **SUCCESS! Stay in Tier 1 (JavaScript)**
- Mission accomplished
- No further optimization needed
- Document success in migration strategy

### If Collision Time 2-3ms/frame
⚠️ **BORDERLINE - Monitor but likely OK**
- Still within JavaScript tier threshold
- May benefit from minor tweaks (smaller cell size, etc.)
- Document and continue monitoring

### If Collision Time > 3ms/frame
🔄 **Consider Tier 2 (TypeScript)**
- First, verify spatial hash is working (check console logs)
- Profile to ensure grid queries are being used
- If confirmed, consider TypeScript migration for:
  - Better V8 optimization through type hints
  - Prevent deoptimizations
  - Stronger guarantees about object shapes

### If Collision Time > 8ms/frame
🚨 **Investigate Issue**
- Something is likely wrong (spatial hash not enabled, etc.)
- Check console for "[Physics] Spatial Hash Grids Initialized"
- Verify `spatialHashEnabled` flag is true
- Review grid statistics for reasonable distribution

## Testing Collision Behaviors

Ensure all collision interactions still work correctly:

### 1. Mushroom Bounce (Trampolines)
- **Action**: Jump onto a mushroom marked as trampoline
- **Expected**: Player bounces up 15+ units, mushroom squashes briefly
- **Validates**: Mushroom collision detection works with spatial hash

### 2. Cave Water Gates (Push Back)
- **Action**: Walk into a flooded cave entrance
- **Expected**: Player pushed back by water gate force
- **Validates**: Cave collision detection works with spatial hash

### 3. Cloud Platforms
- **Action**: Jump onto cloud (y > 15) with tier = 1
- **Expected**: Player lands on cloud surface, can walk and jump
- **Validates**: Cloud collision detection works with spatial hash

### 4. Vine Swinging
- **Action**: Move near a vine anchor point
- **Expected**: Player attaches to vine, can swing and release
- **Validates**: Vine attachment detection works with spatial hash

### 5. No False Collisions
- **Action**: Walk in open areas far from objects
- **Expected**: No unexpected stops, pushes, or bounces
- **Validates**: Spatial hash doesn't create false positives

## Debugging Tools

### Enable Verbose Logging
If you need more details, you can temporarily add logging to physics.js:

```javascript
// In resolveSpecialCollisions()
const nearbyCaves = spatialHashEnabled ? caveGrid.query(playerPos.x, playerPos.z) : foliageCaves;
console.log(`Nearby caves: ${nearbyCaves.length} (spatial hash: ${spatialHashEnabled})`);
```

### Check Grid Statistics
In browser console, you can access grid stats (if exposed):

```javascript
// In physics.js, add export if needed
export function getCollisionStats() {
    return {
        spatialHashEnabled,
        caves: caveGrid?.getStats(),
        mushrooms: mushroomGrid?.getStats(),
        clouds: cloudGrid?.getStats(),
        vines: vineGrid?.getStats()
    };
}
```

### Disable Spatial Hash (A/B Test)
To compare before/after, temporarily set:

```javascript
let spatialHashEnabled = false; // Disable optimization
```

Then profile both versions to measure the exact improvement.

## Browser DevTools Performance Panel

For deeper analysis:

1. Open Chrome DevTools (F12)
2. Go to **Performance** tab
3. Click **Record** 🔴
4. Move player around for 5-10 seconds
5. Stop recording
6. Look for `resolveSpecialCollisions` in the flame chart
7. Check "Self Time" for the function

**Before optimization**: Expect to see high self-time (2-4ms)
**After optimization**: Self-time should drop significantly (0.5-1ms)

## Reporting Results

After validation, document findings in this format:

```markdown
## Spatial Hash Validation Results

**Date**: YYYY-MM-DD
**Browser**: Chrome/Edge/Firefox version
**Scene Complexity**: X caves, Y mushrooms, Z clouds, W vines

### Profiler Metrics
- Average collision time: X.XX ms
- Max collision time: X.XX ms
- Frame budget usage: X.X%

### Comparison
- Before (estimated): X.XX ms
- After (measured): X.XX ms
- Improvement: XX% reduction

### Behavioral Tests
- ✅ Mushroom bounce works
- ✅ Cave gates push back
- ✅ Cloud platforms work
- ✅ Vine swinging works
- ✅ No false collisions

### Decision
[✅ Stay in JavaScript | ⚠️ Monitor | 🔄 Consider TypeScript]
```

## Migration Strategy Alignment

This optimization fulfills the requirement from `PERFORMANCE_MIGRATION_STRATEGY.md` (line 54):

> **Priority C: Future Research (Do NOT migrate yet)**
> | Function | File | Blocker |
> | `updatePhysics` | `src/systems/physics.js` | **Needs spatial hashing in JS first; profile after** |

✅ **Spatial hashing implemented in JavaScript (Tier 1)**
✅ **Profiling infrastructure in place**
⏳ **Awaiting manual validation and profiling results**

Once validated, update the migration strategy document with actual results to inform future optimization decisions.
