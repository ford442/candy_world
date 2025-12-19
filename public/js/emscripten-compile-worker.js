// src/workers/emscripten.worker.js
// Worker to fetch & compile an Emscripten-generated WASM file off the main thread.

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || !msg.url) return;
  const url = msg.url;

  try {
    // Fetch the WASM
    // Note: we intentionally fetch directly here so we can validate content-type / status
    const response = await fetch(url);
    if (!response.ok) {
      const txt = await response.text().catch(()=>'');
      throw new Error(`Fetch failed: status=${response.status} url=${url} bodyPreview=${txt.slice(0,200)}`);
    }

    const contentType = response.headers.get('content-type') || response.headers.get('Content-Type') || '';
    if (contentType && !contentType.includes('wasm') && !contentType.includes('octet')) {
      const preview = await response.text().catch(()=>'');
      // still try to compile but warn the host
      self.postMessage({ type: 'WARN', message: `Unexpected content-type: ${contentType}; preview: ${preview.slice(0,200)}` });
    }

    let module;
    if (WebAssembly && WebAssembly.compileStreaming) {
      // compileStreaming works directly with the Response
      module = await WebAssembly.compileStreaming(Promise.resolve(response));
    } else {
      const bytes = await response.arrayBuffer();
      module = await WebAssembly.compile(bytes);
    }

    // Post compiled Module back to main thread. WebAssembly.Module is structured-cloneable
    self.postMessage({ type: 'SUCCESS', module }, [module]);
  } catch (err) {
    const errMsg = (err && err.stack) ? `${err.message}\n${err.stack}` : String(err);
    self.postMessage({ type: 'ERROR', message: errMsg });
  }
};
