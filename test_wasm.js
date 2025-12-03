const fs = require('fs');

async function test() {
  const wasmBuffer = fs.readFileSync('public/build/optimized.wasm');
  const memory = new WebAssembly.Memory({ initial: 100 });
  
  const { instance } = await WebAssembly.instantiate(wasmBuffer, {
    env: {
      memory: memory,
      emscripten_notify_memory_growth: () => {},
      abort: () => console.error('WASM Aborted'),
      seed: () => Math.random()
    },
    wasi_snapshot_preview1: {
      fd_write: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
      proc_exit: (code) => console.log('WASM exit:', code),
      random_get: (bufPtr, bufLen) => {
        const mem = new Uint8Array(memory.buffer);
        for (let i = 0; i < bufLen; i++) {
          mem[bufPtr + i] = Math.floor(Math.random() * 256);
        }
        return 0;
      }
    }
  });
  
  const wasm = instance.exports;
  console.log('Exports keys:', Object.keys(wasm));
  console.log('updateParticles present?', 'updateParticles' in wasm);
  console.log('Memory present?', 'memory' in wasm);
  console.log('Memory type:', typeof wasm.memory);
  console.log('Is memory an ArrayBuffer?', wasm.memory instanceof ArrayBuffer);
  console.log('Is memory a WebAssembly.Memory?', wasm.memory instanceof WebAssembly.Memory);
  
  const updateFn = wasm._updateParticles || wasm.updateParticles;
  console.log('updateFn found?', !!updateFn);
}

test().catch(console.error);
