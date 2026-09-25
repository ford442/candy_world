/**
 * Stub target for asset imports (`.css`, `.wasm?init`, images, audio) that Vite
 * resolves at build time. `css-hooks.mjs` redirects those specifiers here so
 * `src/**` can be imported directly by Node tests without a bundler.
 *
 * This is a real file on disk rather than a `data:` URI on purpose: loaders in
 * the chain (tsx) re-attach the original specifier's query string to whatever
 * URL the resolve hook returns, and `data:...?init` is not a valid URL under
 * Node 24's ESM loader, while `file:///...?init` is.
 */
export default {};
