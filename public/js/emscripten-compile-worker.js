// Worker (module) to compile Emscripten WASM off the main thread
self.addEventListener('message', async (ev) => {
  const msg = ev.data;
  if (!msg || msg.cmd !== 'compile' || !msg.url) return;
  const url = msg.url;

  try {
    // Prefer compileStreaming to avoid buffering fully
    let module;
    if (WebAssembly && WebAssembly.compileStreaming) {
      // Note: fetch inside worker to allow streaming compile
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed: ' + response.status);
      module = await WebAssembly.compileStreaming(fetch(url));
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Fetch failed: ' + resp.status);
      const bytes = await resp.arrayBuffer();
      module = await WebAssembly.compile(bytes);
    }

    // Transfer the compiled Module back to main thread
    // Module objects are transferable via structured clone
    self.postMessage({ cmd: 'compiled', module }, [module]);
  } catch (err) {
    self.postMessage({ cmd: 'error', error: String(err) });
  }
});
