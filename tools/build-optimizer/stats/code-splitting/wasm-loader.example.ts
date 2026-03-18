// Lazy WASM loading
let wasmModule: any = null;
let wasmPromise: Promise<any> | null = null;

export async function initWasmLazy() {
  if (wasmModule) return wasmModule;
  if (wasmPromise) return wasmPromise;
  
  wasmPromise = import('./utils/wasm-loader.js')
    .then(({ initWasm }) => initWasm())
    .then((module) => {
      wasmModule = module;
      return module;
    });
  
  return wasmPromise;
}

// Preload hint for WASM
export function preloadWasm() {
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'fetch';
  link.href = '/wasm/candy_physics-[hash].wasm';
  document.head.appendChild(link);
}
