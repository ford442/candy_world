// Worker (module) to compile Emscripten WASM off the main thread
self.addEventListener('message', async (ev) => {
  const msg = ev.data;
  if (!msg || msg.cmd !== 'compile' || !msg.url) return;
  const url = msg.url;

  try {
    // Fetch once to inspect response and prefer streaming compile when available
    const response = await fetch(url);
    if (!response.ok) {
      const txt = await response.text().catch(()=>'');
      throw new Error(`Fetch failed: status=${response.status} url=${url} bodyPreview=${txt.slice(0,200)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/wasm') && !(contentType.includes('octet-stream') || contentType === '')) {
      // If server returned HTML (common), capture a piece for debugging
      const preview = await response.text().catch(()=>'');
      throw new Error(`Unexpected content-type: ${contentType}; response preview: ${preview.slice(0,200)}`);
    }

    let module;
    if (WebAssembly && WebAssembly.compileStreaming) {
      // compileStreaming accepts a Response; we already have one so pass it
      module = await WebAssembly.compileStreaming(Promise.resolve(response));
    } else {
      const bytes = await response.arrayBuffer();
      module = await WebAssembly.compile(bytes);
    }

    // Transfer the compiled Module back to main thread (structured clone supports WebAssembly.Module)
    self.postMessage({ cmd: 'compiled', module }, [module]);
  } catch (err) {
    const errMsg = (err && err.stack) ? `${err.message}\n${err.stack}` : String(err);
    self.postMessage({ cmd: 'error', error: errMsg });
  }
});
