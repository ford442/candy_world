// public/js/worklet-polyfills.js

// 1. Ensure globalThis exists
if (typeof globalThis === 'undefined') {
  self.globalThis = self;
}

// 2. Polyfill performance.now()
if (typeof globalThis.performance === 'undefined') {
  const _start = Date.now();
  globalThis.performance = {
    now: () => Date.now() - _start
  };
}

// 3. Polyfill crypto.getRandomValues()
// Emscripten sometimes needs this for random number generation
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    getRandomValues: (array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }
  };
}

// 4. Polyfill setTimeout/clearTimeout for AudioWorklet
// AudioWorklets don't have access to window.setTimeout
if (typeof globalThis.setTimeout === 'undefined') {
  // Minimal setTimeout implementation using a busy-wait approach
  // This is not ideal for performance but works for compatibility
  const timeouts = new Map();
  let timeoutId = 1;
  
  globalThis.setTimeout = function(callback, delay = 0, ...args) {
    const id = timeoutId++;
    const startTime = Date.now();
    
    // Store the timeout info
    timeouts.set(id, {
      callback,
      targetTime: startTime + delay,
      args,
      cleared: false
    });
    
    // We can't actually schedule async execution in AudioWorklet
    // The callback will need to be checked/polled elsewhere or
    // executed synchronously if delay is 0
    if (delay <= 0) {
      try {
        callback(...args);
      } catch (e) {
        console.error('[Worklet] setTimeout callback error:', e);
      }
      timeouts.delete(id);
    }
    
    return id;
  };
  
  globalThis.clearTimeout = function(id) {
    const timeout = timeouts.get(id);
    if (timeout) {
      timeout.cleared = true;
      timeouts.delete(id);
    }
  };
  
  // Helper function to poll pending timeouts - can be called from process()
  globalThis._pollTimeouts = function() {
    const now = Date.now();
    for (const [id, timeout] of timeouts) {
      if (!timeout.cleared && now >= timeout.targetTime) {
        timeouts.delete(id);
        try {
          timeout.callback(...timeout.args);
        } catch (e) {
          console.error('[Worklet] setTimeout callback error:', e);
        }
      }
    }
  };
}

// 5. Polyfill setInterval/clearInterval
if (typeof globalThis.setInterval === 'undefined') {
  const intervals = new Map();
  let intervalId = 1;
  
  globalThis.setInterval = function(callback, delay = 0, ...args) {
    const id = intervalId++;
    const startTime = Date.now();
    
    intervals.set(id, {
      callback,
      delay,
      lastRun: startTime,
      args,
      cleared: false
    });
    
    return id;
  };
  
  globalThis.clearInterval = function(id) {
    const interval = intervals.get(id);
    if (interval) {
      interval.cleared = true;
      intervals.delete(id);
    }
  };
  
  // Extend _pollTimeouts to also handle intervals
  const originalPoll = globalThis._pollTimeouts;
  globalThis._pollTimeouts = function() {
    // Call original if it exists
    if (originalPoll && originalPoll !== globalThis._pollTimeouts) {
      originalPoll();
    }
    
    const now = Date.now();
    for (const [id, interval] of intervals) {
      if (!interval.cleared && now >= interval.lastRun + interval.delay) {
        interval.lastRun = now;
        try {
          interval.callback(...interval.args);
        } catch (e) {
          console.error('[Worklet] setInterval callback error:', e);
        }
      }
    }
  };
}

console.log('[Worklet] Polyfills applied.');
