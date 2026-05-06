# candy_world Code Audit Report

**Date:** 2026-03-19  
**Files Audited:** 137 TypeScript files  
**Audit Type:** Static Analysis

---

## 🔴 Critical Issues

### 1. Module Resolution Errors (Blocks Build)
**Files Affected:** 30+ files in src/foliage/, src/compute/, src/rendering/  
**Issue:** Cannot find module 'three/tsl' or 'three/webgpu'

```
error TS2307: Cannot find module 'three/tsl' or its corresponding type declarations.
error TS2307: Cannot find module 'three/webgpu' or its corresponding type declarations.
```

**Root Cause:** TypeScript `moduleResolution` setting doesn't support `three/tsl` path aliases.  
**Fix:** Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "moduleResolution": "bundler"
  }
}
```

---

### 2. Undefined Variable: `_scratchVec1`
**File:** `src/foliage/common.ts:1052`  
**Issue:** Variable used but never declared
```typescript
_scratchVec1.set(0, 0, 0); // _scratchVec1 doesn't exist
```
**Fix:** Add declaration or use existing scratch variable:
```typescript
const _scratchVec1 = new THREE.Vector3();
```

---

### 3. Missing Function Arguments
**File:** `src/foliage/common.ts:954`  
**Issue:** `Expected 1-2 arguments, but got 0`
```typescript
// Line 954 - likely a geometry constructor missing parameters
new THREE.SphereGeometry(); // Needs radius, widthSegments, etc.
```

---

### 4. Type Mismatch in `updateRange`
**File:** `src/foliage/dandelion-seeds.ts:193-195`  
**Issue:** Property 'updateRange' doesn't exist on type 'InstancedBufferAttribute'
```typescript
this.attribute.updateRange.offset = offset;
this.attribute.updateRange.count = count;
```
**Fix:** Use `updateRanges` (plural) array API:
```typescript
this.attribute.updateRanges = [{ start: offset, count: count }];
```

---

## 🟠 High Severity Issues

### 5. Event Listener Leaks (Memory Leaks)
**Count:** 96 `addEventListener` vs 8 `removeEventListener`
**Risk:** DOM nodes retained in memory after disposal

**Files with leaks:**
- `src/core/input.ts` - Multiple window/document listeners
- `src/foliage/post-processing.ts:64` - Resize listener never removed
- `src/rendering/culling-system.ts` - Stats element listeners

**Example fix pattern:**
```typescript
// Add disposal method
public dispose(): void {
  window.removeEventListener('resize', this.handleResize);
  document.removeEventListener('keydown', this.handleKeydown);
}
```

---

### 6. Missing Error Handling (try/catch imbalance)
**Count:** 134 `try {` vs 95 `catch` blocks  
**Risk:** Unhandled exceptions crash the application

**Files needing attention:**
- `src/systems/save-system.ts` - IndexedDB operations
- `src/systems/asset-streaming.ts` - Network requests
- `src/compute/*.ts` - WebGPU compute pipelines

---

### 7. Type Safety Issues (`any` types)
**Count:** 364 usages of `any`  
**Files with most `any` types:**
- `src/foliage/common.ts` - TSL function parameters lack types
- `src/foliage/foliage-batcher.ts` - Batch processing functions
- `src/systems/analytics.ts` - Event data

**Critical in common.ts:**
```typescript
// Lines 117-379 - All Fn() parameters are 'any'
export const triplanarNoise = Fn(([pos, scale]) => { ... })
export const perturbNormal = Fn(([pos, normal, scale, strength]) => { ... })
```
**Fix:** Add proper types:
```typescript
export const triplanarNoise = Fn(([pos, scale]: [Node, number]) => { ... })
```

---

### 8. LocalStorage Without Safety Checks
**Files:**
- `src/systems/unlocks.ts:70` - No try/catch around getItem
- `src/utils/startup-profiler.ts:459` - Direct localStorage access
- `src/systems/accessibility.ts:511` - parse without validation

**Risk:** Throws in private mode, crashes app  
**Fix:** Wrap all localStorage calls:
```typescript
try {
  const data = localStorage.getItem(key);
  return data ? JSON.parse(data) : null;
} catch (e) {
  return null;
}
```

---

## 🟡 Medium Severity Issues

### 9. Console Statement Pollution
**Count:** 365 console.log/warn/error statements  
**Recommendation:** Replace with structured logger or remove before production

**Most verbose files:**
- `src/systems/analytics.ts` - Debug logging
- `src/foliage/*-batcher.ts` - Initialization logs
- `src/utils/startup-profiler.ts` - Performance logs

---

### 10. Unhandled Promise Rejections
**Files with `.then()` without `.catch()`:**
- `src/core/input.ts` (12 instances) - Toast imports
- `src/systems/asset-streaming.ts:1010` - Empty catch
- `src/workers/*.ts` - Worker initialization

**Example issue:**
```typescript
import('../utils/toast.js').then(({ showToast }) => {
  showToast(message);
}); // No catch - fails silently if module missing
```

---

### 11. TODO Comments (Incomplete Features)
**File:** `src/systems/save-integration-example.ts`
```typescript
71:  unlockedAbilities: [], // TODO: Track unlocked abilities
96:  const timeOfDay = getTimeOfDay(); // TODO: Implement based on your time system
106:  season: 'spring', // TODO: Implement season system
108:  moonPhase: 0 // TODO: Implement moon phase tracking
206: // TODO: Connect to your audio system
212: // TODO: Connect to your renderer
```

---

### 12. DOM Access Without Null Checks
**File:** `src/core/input.ts:80-95`
```typescript
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions');
const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
```
**Risk:** `instructions`, `startButton` could be null  
**Fix:** Add null checks before use

---

### 13. Property Type Errors
**File:** `src/foliage/animation.ts:250`
```typescript
// distanceToSquared doesn't exist on Color
const dist = color.distanceToSquared(otherColor);
```
**Fix:** Use `color.equals()` or `color.getHex() === otherColor.getHex()`

---

### 14. Missing Property in Type
**File:** `src/examples/asset-streaming-usage.ts:54`
```typescript
Property 'percent' does not exist on type 'LoadingProgress'
```
**Fix:** Update type definition or use correct property name

---

## 🟢 Low Severity / Code Quality

### 15. Implicit 'any' Parameters
**File:** `src/foliage/arpeggio-batcher.ts:296,349`
```typescript
.forEach((dummy) => { ... })  // Parameter 'dummy' implicitly has 'any' type
.map((index, dummy) => { ... })  // Both parameters 'any'
```

---

### 16. Function Declaration Conflicts
**File:** `src/audio/audio-system.ts:117`  
**Issue:** `All declarations of 'setLoadingStatus' must have identical modifiers`

---

### 17. Timer Accumulation
**Count:** 46 `setInterval/setTimeout`  
**Risk:** Timers not cleared on component disposal  
**Recommendation:** Track all timers and clear in dispose methods

---

## 📊 Summary Statistics

| Metric | Count | Status |
|--------|-------|--------|
| TypeScript Errors | 100+ | 🔴 Critical |
| `any` types | 364 | 🟠 High |
| Console statements | 365 | 🟡 Medium |
| Event listeners (add) | 96 | 🟠 High |
| Event listeners (remove) | 8 | 🟠 High |
| Try blocks | 134 | 🟡 Medium |
| Catch blocks | 95 | 🟡 Medium |
| setInterval/Timeout | 46 | 🟡 Medium |
| TODO comments | 8 | 🟢 Low |
| debugger statements | 0 | ✅ Good |

---

## 🛠️ Recommended Fix Priority

### Wave 1 (Fix First)
1. Fix moduleResolution in tsconfig.json
2. Add `_scratchVec1` declaration in common.ts
3. Fix `updateRange` → `updateRanges` in dandelion-seeds.ts
4. Fix SphereGeometry missing arguments

### Wave 2 (High Priority)
5. Add dispose() methods to remove event listeners
6. Balance try/catch blocks
7. Add localStorage safety wrappers

### Wave 3 (Code Quality)
8. Replace console.log with logger utility
9. Add Promise.catch() handlers
10. Reduce `any` type usage

---

## Files Requiring Immediate Attention

1. `src/foliage/common.ts` - Undefined var, type errors
2. `src/foliage/dandelion-seeds.ts` - API mismatch
3. `src/core/input.ts` - Event leaks, null checks
4. `src/systems/save-system.ts` - Error handling
5. `src/compute/*.ts` - Module resolution
6. `src/audio/audio-system.ts` - Declaration conflict
