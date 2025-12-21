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

console.log('[Worklet] Polyfills applied.');
