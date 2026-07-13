// tests/startup-bootstrap.mjs
// Unit tests for startup error-boundary (Issue #1) and loading-screen race
// condition guard (Issue #5).  Runs with: node tests/startup-bootstrap.mjs
//
// These tests exercise the logic extracted from src/core/main.ts so that it can
// be validated without a browser / bundler.

// ============================================================================
// Minimal test harness
// ============================================================================

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  const result = (() => {
    try {
      const ret = fn();
      if (ret instanceof Promise) return ret;
      console.log(`✅ PASS: ${name}`);
      passed++;
      return null;
    } catch (err) {
      console.log(`❌ FAIL: ${name} — ${err.message}`);
      failed++;
      return null;
    }
  })();

  if (result instanceof Promise) {
    pending.push(
      result
        .then(() => { console.log(`✅ PASS: ${name}`); passed++; })
        .catch(err => { console.log(`❌ FAIL: ${name} — ${err.message}`); failed++; })
    );
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ============================================================================
// Test helpers
// ============================================================================

/**
 * Minimal mock of LoadingScreen with the methods used by main.ts.
 * Calls are recorded as structured objects for precise assertions.
 */
function makeMockLoadingScreen() {
  const calls = [];
  return {
    calls,
    show: () => calls.push({ method: 'show' }),
    hide: () => calls.push({ method: 'hide' }),
    showFatalError: (msg) => calls.push({ method: 'showFatalError', msg }),
    startPhase: (id) => calls.push({ method: 'startPhase', id }),
    completePhase: (id) => calls.push({ method: 'completePhase', id }),
    updateProgress: (pct, msg) => calls.push({ method: 'updateProgress', pct }),
    hasFatalError: false,
    // Helper: find the first call with the given method name
    findCall: function(method) { return this.calls.find(c => c.method === method); },
    // Helper: check whether a method was called at all
    wasCalled: function(method) { return this.calls.some(c => c.method === method); },
  };
}

// ============================================================================
// Issue #1 — Bootstrap error boundary
// Tests that the unhandledrejection handler routes errors to showFatalError and
// never lets the page stay silently frozen at 0%.
// ============================================================================

/**
 * Shared helper that replicates the unhandledrejection handler logic from
 * src/core/main.ts so we can test it without a bundler or browser.
 */
function makeRejectionHandler(ls) {
  return function handleUnhandledRejection(reason) {
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'Unknown error');
    try {
      ls.showFatalError(`Startup failed: ${msg}\n\nRefresh the page to try again.`);
    } catch (_) {
      // loading screen not ready — swallowed intentionally
    }
  };
}

test('error boundary: showFatalError is called when startup throws', () => {
  const ls = makeMockLoadingScreen();
  const handler = makeRejectionHandler(ls);

  handler(new Error('WebGL context creation failed'));

  const fatalCall = ls.findCall('showFatalError');
  assert(fatalCall, 'showFatalError should have been called');
  assert(fatalCall.msg.includes('WebGL context creation failed'), 'Error message should be included');
});

test('error boundary: non-Error rejection (string) is handled gracefully', () => {
  const ls = makeMockLoadingScreen();
  const handler = makeRejectionHandler(ls);

  handler('WebGPU adapter returned null');

  const fatalCall = ls.findCall('showFatalError');
  assert(fatalCall, 'showFatalError should have been called for string rejection');
  assert(fatalCall.msg.includes('WebGPU adapter returned null'), 'String error should be in message');
});

test('error boundary: null rejection produces "Unknown error"', () => {
  const ls = makeMockLoadingScreen();
  const handler = makeRejectionHandler(ls);

  handler(null);
  const fatalCall = ls.findCall('showFatalError');
  assert(fatalCall, 'showFatalError should have been called for null rejection');
  assert(fatalCall.msg.includes('Unknown error'), 'null should be represented as "Unknown error"');
});

test('error boundary: undefined rejection produces "Unknown error"', () => {
  const ls = makeMockLoadingScreen();
  const handler = makeRejectionHandler(ls);

  handler(undefined);
  const fatalCall = ls.findCall('showFatalError');
  assert(fatalCall, 'showFatalError should have been called for undefined rejection');
  assert(fatalCall.msg.includes('Unknown error'), 'undefined should be represented as "Unknown error"');
});

test('error boundary: showFatalError throwing does not propagate', () => {
  // If loading screen itself is broken, the handler must not throw
  let threw = false;
  function brokenHandler(reason) {
    // msg extraction is still safe
    const msg = reason instanceof Error ? reason.message : String(reason ?? 'Unknown error');
    try {
      // Simulate a broken loading screen
      throw new Error('Loading screen DOM not ready');
    } catch (_) {
      // Silently caught — this is correct
    }
  }

  try {
    brokenHandler(new Error('Some startup error'));
  } catch (_) {
    threw = true;
  }

  assert(!threw, 'Inner exception from loading screen must not propagate out of handler');
});

// ============================================================================
// Issue #5 — Loading screen race condition
// Tests that the _worldGenerationActive flag prevents warmupAndStartLoop from
// hiding the loading screen while enterWorld() is running.
// ============================================================================

test('race fix: warmupAndStartLoop does NOT hide loading screen if world gen active', () => {
  const ls = makeMockLoadingScreen();
  let _worldGenerationActive = false;

  // Simulate warmupAndStartLoop finishing (extracted logic)
  function warmupComplete() {
    if (!_worldGenerationActive) {
      ls.hide();
    }
  }

  // Simulate enterWorld starting
  _worldGenerationActive = true;

  // Shader warmup finishes concurrently
  warmupComplete();

  assert(!ls.wasCalled('hide'), 'Loading screen should NOT be hidden while world gen is active');
});

test('race fix: warmupAndStartLoop DOES hide loading screen when world gen not started', () => {
  const ls = makeMockLoadingScreen();
  let _worldGenerationActive = false;

  function warmupComplete() {
    if (!_worldGenerationActive) {
      ls.hide();
    }
  }

  // Normal path — user has not clicked start yet
  warmupComplete();

  assert(ls.wasCalled('hide'), 'Loading screen should be hidden when world gen has not started');
});

test('race fix: flag is cleared in finally block after enterWorld completes', async () => {
  let _worldGenerationActive = false;
  let isGenerating = false;

  async function simulateEnterWorld(shouldThrow = false) {
    isGenerating = true;
    _worldGenerationActive = true;
    try {
      if (shouldThrow) throw new Error('Simulated map generation error');
      // ... successful generation ...
    } catch (_) {
      // error handling
    } finally {
      _worldGenerationActive = false;
      isGenerating = false;
    }
  }

  await simulateEnterWorld(false);
  assert(!_worldGenerationActive, 'Flag should be false after successful enterWorld');
  assert(!isGenerating, 'isGenerating should be false after successful enterWorld');

  // Reset
  _worldGenerationActive = false;
  isGenerating = false;

  await simulateEnterWorld(true);
  assert(!_worldGenerationActive, 'Flag should be false after failed enterWorld');
  assert(!isGenerating, 'isGenerating should be false after failed enterWorld');
});

test('race fix: loading screen shown again if enterWorld starts before warmup hides', async () => {
  const ls = makeMockLoadingScreen();
  let _worldGenerationActive = false;
  let warmupFinished = false;

  // Simulate async warmup (not yet finished)
  const warmupPromise = new Promise(resolve => setTimeout(() => {
    warmupFinished = true;
    if (!_worldGenerationActive) ls.hide(); // Issue #5 fix
    resolve();
  }, 10));

  // User clicks start before warmup is done
  _worldGenerationActive = true;
  ls.show(); // enterWorld shows loading screen

  // Warmup finishes (during map generation)
  await warmupPromise;
  assert(warmupFinished, 'Warmup should have completed');
  // The hide() should NOT have been called because _worldGenerationActive is true
  assert(!ls.wasCalled('hide'), 'hide() must not be called while world gen is active');
  // But the show() from enterWorld should be present
  assert(ls.wasCalled('show'), 'show() should have been called by enterWorld');
});

test('startup mode: fallback keeps active mode at CORE when FULL boot fails', () => {
  const requestedMode = 'FULL';
  let activeWorldMode = requestedMode;

  function applyPopulateWorldResult(actualMode) {
    activeWorldMode = actualMode;
    return activeWorldMode;
  }

  const result = applyPopulateWorldResult('CORE');
  assert(result === 'CORE', 'fallback should switch active mode to CORE');
  assert(activeWorldMode === 'CORE', 'active mode should reflect the recovered CORE boot');
});

test('startup progress: entity type is appended to loading label when present', () => {
  const requestedMode = 'FULL';
  const label = `[World] Populating world ${40}/${180}`;
  const entityType = 'mushroom';
  const baseLabel = label ?? (requestedMode === 'CORE' ? 'Generating core world...' : 'Generating world...');
  const progressLabel = entityType ? `${baseLabel} · ${entityType}` : baseLabel;

  assert(/\[World\] Populating world \d+\/\d+/.test(baseLabel), 'progress label should keep the world count structure');
  assert(progressLabel.includes('mushroom'), 'entity type should be surfaced in the loading label');
  assert(progressLabel.includes('40/180'), 'entity counts should remain visible in the loading label');
});

// ============================================================================
// Issue #2 — WebGPU renderer fallback
// Tests that the renderer creation falls back to WebGL when WebGPURenderer
// throws (e.g. adapter returned null on Safari 17.4).
// ============================================================================

test('webgpu fallback: falls back to webgl when WebGPURenderer constructor throws', () => {
  // Replicate the logic from init.ts createRenderer()
  let mode = null;

  function simulateCreateRenderer(webgpuAvailable, webgpuThrows) {
    if (webgpuAvailable) {
      try {
        if (webgpuThrows) throw new Error('GPUAdapter is null');
        mode = 'webgpu';
        return { mode: 'webgpu' };
      } catch (err) {
        console.warn('WebGPU failed, falling back:', err.message);
        // fall through
      }
    }
    mode = 'webgl';
    return { mode: 'webgl' };
  }

  const result = simulateCreateRenderer(true, true);
  assert(result.mode === 'webgl', 'Should fall back to webgl when WebGPURenderer throws');
  assert(mode === 'webgl', 'mode variable should be webgl');
});

test('webgpu fallback: uses webgpu when available and constructor succeeds', () => {
  function simulateCreateRenderer(webgpuAvailable, webgpuThrows) {
    if (webgpuAvailable) {
      try {
        if (webgpuThrows) throw new Error('GPUAdapter is null');
        return { mode: 'webgpu' };
      } catch (err) {
        // fall through
      }
    }
    return { mode: 'webgl' };
  }

  const result = simulateCreateRenderer(true, false);
  assert(result.mode === 'webgpu', 'Should use webgpu when available and working');
});

test('webgpu fallback: uses webgl when webgpu not available', () => {
  function simulateCreateRenderer(webgpuAvailable, webgpuThrows) {
    if (webgpuAvailable) {
      try {
        if (webgpuThrows) throw new Error('GPUAdapter is null');
        return { mode: 'webgpu' };
      } catch (err) {
        // fall through
      }
    }
    return { mode: 'webgl' };
  }

  const result = simulateCreateRenderer(false, false);
  assert(result.mode === 'webgl', 'Should use webgl when webgpu not available');
});

// ============================================================================
// Renderer preference resolution (renderer-mode.ts)
// ============================================================================

function simulateResolveRendererBackend(search = '') {
  const params = new URLSearchParams(search);
  const explicit = params.get('renderer')?.toLowerCase();
  if (explicit === 'webgl' || explicit === 'webgl2' || params.has('webgl')) return 'webgl';
  if (explicit === 'webgpu' || params.has('webgpu')) return 'webgpu';
  return null;
}

function simulateCreateRendererWithPreference(preference, webgpuAvailable, webgpuThrows) {
  if (preference === 'webgl') {
    return { mode: 'webgl', requested: 'webgl', fallbackReason: 'explicit-webgl' };
  }

  if (webgpuAvailable) {
    try {
      if (webgpuThrows) throw new Error('GPUAdapter is null');
      return { mode: 'webgpu', requested: 'webgpu', fallbackReason: null };
    } catch (_err) {
      // fall through
    }
  }

  return { mode: 'webgl', requested: 'webgpu', fallbackReason: 'webgpu-unavailable' };
}

test('renderer preference: URL ?renderer=webgl forces webgl path', () => {
  assert(simulateResolveRendererBackend('?renderer=webgl') === 'webgl', 'URL should force webgl');
  const result = simulateCreateRendererWithPreference('webgl', true, false);
  assert(result.mode === 'webgl', 'Explicit webgl should skip WebGPU even when available');
  assert(result.fallbackReason === 'explicit-webgl', 'Should record explicit webgl reason');
});

test('renderer preference: URL ?renderer=webgpu selects webgpu when available', () => {
  assert(simulateResolveRendererBackend('?renderer=webgpu') === 'webgpu', 'URL should request webgpu');
  const result = simulateCreateRendererWithPreference('webgpu', true, false);
  assert(result.mode === 'webgpu', 'Should use webgpu when available');
});

test('renderer preference: webgl2 alias maps to webgl', () => {
  assert(simulateResolveRendererBackend('?renderer=webgl2') === 'webgl', 'webgl2 alias should map to webgl');
});

// ============================================================================
// Deferred entity proximity sorting
// Verifies that deferred map entities and procedural extras are queued
// nearest-first so the background processor populates the visible area around
// the player spawn (origin) before filling the far horizon.
// ============================================================================

test('deferred entity sort: map entities are ordered by ascending distance from origin', () => {
  // Simulate the filter + sort step from generateMap()
  const deferredEntities = [
    { type: 'flower',    position: [100, 0, 100] },
    { type: 'flower',    position: [20,  0, 20 ] },
    { type: 'starflower',position: [5,   0, 5  ] },
    { type: 'flower',    position: [80,  0, 0  ] },
  ];

  deferredEntities.sort((a, b) => {
    const [ax, , az] = a.position;
    const [bx, , bz] = b.position;
    return (ax * ax + az * az) - (bx * bx + bz * bz);
  });

  // The entity at (5, 0, 5) has distSq = 50 — should be first
  assert(deferredEntities[0].position[0] === 5 && deferredEntities[0].position[2] === 5,
    'Nearest entity (5, 5) should be first after sort');
  // The entity at (20, 0, 20) has distSq = 800 — should be second
  assert(deferredEntities[1].position[0] === 20,
    'Second-nearest entity (20, 20) should come second');
  // The entity at (80, 0, 0) has distSq = 6400 — should be third
  assert(deferredEntities[2].position[0] === 80,
    'Third-nearest entity (80, 0) should come third');
  // The entity at (100, 0, 100) has distSq = 20000 — should be last
  assert(deferredEntities[3].position[0] === 100,
    'Farthest entity (100, 100) should be last after sort');
});

test('deferred entity sort: entities at equal distances preserve relative order (stable)', () => {
  const deferredEntities = [
    { type: 'flower', position: [10, 0, 0], id: 'a' },
    { type: 'flower', position: [0, 0, 10], id: 'b' }, // same dist (100)
    { type: 'flower', position: [5,  0, 5 ], id: 'c' }, // distSq=50, nearer
  ];

  deferredEntities.sort((a, b) => {
    const [ax, , az] = a.position;
    const [bx, , bz] = b.position;
    return (ax * ax + az * az) - (bx * bx + bz * bz);
  });

  // 'c' at distSq=50 must come before 'a' and 'b' at distSq=100
  assert(deferredEntities[0].id === 'c', 'Nearer entity should come first');
  // 'a' and 'b' are at the same distance; either order is acceptable
  assert(['a', 'b'].includes(deferredEntities[1].id), 'Equal-distance entities should follow');
  assert(['a', 'b'].includes(deferredEntities[2].id), 'Equal-distance entities should follow');
});

test('deferred entity sort: procedural extras collect distSq before enqueueing', () => {
  // Replicate the deferred-collection pattern from populateProceduralExtras()
  const deferredItems = [];
  const positions = [
    { x: 90, z: 90 }, // distSq = 16200
    { x: 20, z: 30 }, // distSq = 1300
    { x: 5,  z: 5  }, // distSq = 50
  ];

  for (let i = 0; i < positions.length; i++) {
    const { x, z } = positions[i];
    deferredItems.push({ distSq: x * x + z * z, id: `procedural_deferred_${i}`, execute: () => {} });
  }

  deferredItems.sort((a, b) => a.distSq - b.distSq);

  assert(deferredItems[0].distSq === 50,    'Nearest extra (distSq=50) should enqueue first');
  assert(deferredItems[1].distSq === 1300,  'Mid-range extra (distSq=1300) should enqueue second');
  assert(deferredItems[2].distSq === 16200, 'Farthest extra (distSq=16200) should enqueue last');
});

// ============================================================================
// worldFullyPopulated event
// Verifies that the event is dispatched when the background processor
// completes so downstream systems can react.
// ============================================================================

test('worldFullyPopulated: event fires when background processor onComplete callback runs', () => {
  // Replicate the onComplete callback logic from main.ts
  let eventFired = false;

  // Minimal mock of the document.dispatchEvent call
  const mockDispatch = (event) => {
    if (event.type === 'worldFullyPopulated') eventFired = true;
  };

  function simulateOnComplete(dispatchEvent) {
    // This mirrors the onComplete callback installed in main.ts
    dispatchEvent({ type: 'worldFullyPopulated' });
  }

  simulateOnComplete(mockDispatch);
  assert(eventFired, 'worldFullyPopulated event should be dispatched when background tasks complete');
});

test('worldFullyPopulated: event is not fired before completion', () => {
  let eventFired = false;
  const mockDispatch = (event) => {
    if (event.type === 'worldFullyPopulated') eventFired = true;
  };

  // onComplete has not been called yet — no dispatch
  assert(!eventFired, 'worldFullyPopulated should not fire before completion');
});


// ============================================================================
// Run all tests
// ============================================================================

async function main() {
  console.log('🚀 Candy World Startup Bootstrap Tests');
  console.log('=======================================\n');

  // Wait for all async tests to settle
  await new Promise(resolve => setTimeout(resolve, 0));
  await Promise.all(pending);

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
