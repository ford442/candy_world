/**
 * Emscripten WASM Compilation Worker
 * 
 * Fetches and compiles Emscripten-generated WASM files off the main thread.
 * This provides significant startup performance benefits by moving the
 * compilation overhead to a background thread.
 * 
 * Usage:
 *   const worker = new Worker('./emscripten.worker.ts', { type: 'module' });
 *   worker.postMessage({ url: '/path/to/module.wasm' });
 *   worker.onmessage = (e) => {
 *     if (e.data.type === 'SUCCESS') {
 *       const compiledModule = e.data.module;
 *       // Use compiled module...
 *     }
 *   };
 */

import type { EmscriptenWorkerRequest, EmscriptenWorkerResponse } from './worker-types';

// Worker state
let isProcessing = false;

/**
 * Validate WASM response headers
 */
function validateWasmResponse(response: Response): { valid: boolean; warning?: string } {
  const contentType = response.headers.get('content-type') || response.headers.get('Content-Type') || '';
  
  if (contentType && !contentType.includes('wasm') && !contentType.includes('octet')) {
    return {
      valid: true,
      warning: `Unexpected content-type: ${contentType}`
    };
  }
  
  return { valid: true };
}

/**
 * Compile WASM module from response
 */
async function compileWasm(response: Response): Promise<WebAssembly.Module> {
  // Use compileStreaming if available for better performance
  if (WebAssembly.compileStreaming) {
    return await WebAssembly.compileStreaming(Promise.resolve(response));
  } else {
    // Fallback: fetch bytes and compile
    const bytes = await response.arrayBuffer();
    return await WebAssembly.compile(bytes);
  }
}

/**
 * Fetch and compile WASM module
 */
async function fetchAndCompileWasm(url: string): Promise<{
  module: WebAssembly.Module;
  warnings?: string[];
}> {
  const warnings: string[] = [];
  
  // Fetch the WASM
  const response = await fetch(url);
  
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Fetch failed: status=${response.status} url=${url} bodyPreview=${text.slice(0, 200)}`
    );
  }
  
  // Validate response
  const validation = validateWasmResponse(response);
  if (validation.warning) {
    warnings.push(validation.warning);
  }
  
  // Compile
  const module = await compileWasm(response);
  
  return { module, warnings };
}

// Worker message handler
self.onmessage = async (event: MessageEvent<EmscriptenWorkerRequest>) => {
  const msg = event.data;
  
  if (!msg || !msg.url) {
    const response: EmscriptenWorkerResponse = {
      type: 'ERROR',
      message: 'Invalid request: missing URL'
    };
    self.postMessage(response);
    return;
  }
  
  if (isProcessing) {
    const response: EmscriptenWorkerResponse = {
      type: 'ERROR',
      message: 'Worker is already processing a request'
    };
    self.postMessage(response);
    return;
  }
  
  isProcessing = true;
  const startTime = performance.now();
  
  try {
    const { module, warnings } = await fetchAndCompileWasm(msg.url);
    
    const response: EmscriptenWorkerResponse = {
      type: 'SUCCESS',
      module,
      compileTime: performance.now() - startTime
    };
    
    // Include any warnings
    if (warnings && warnings.length > 0) {
      response.warnings = warnings;
    }
    
    // Note: WebAssembly.Module uses structured clone (not transferable)
    // so we don't use transfer list here
    self.postMessage(response);
    
  } catch (error) {
    const errorMsg = error instanceof Error 
      ? `${error.message}\n${error.stack}` 
      : String(error);
    
    const response: EmscriptenWorkerResponse = {
      type: 'ERROR',
      message: errorMsg
    };
    
    self.postMessage(response);
  } finally {
    isProcessing = false;
  }
};

// Worker ready notification
const readyResponse: EmscriptenWorkerResponse = {
  type: 'SUCCESS',
  message: 'Emscripten WASM compilation worker ready',
  compileTime: 0
};
self.postMessage(readyResponse);

// Export types for consumers
export type { EmscriptenWorkerRequest, EmscriptenWorkerResponse };
