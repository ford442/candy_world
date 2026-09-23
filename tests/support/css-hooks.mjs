/**
 * Node module-customization hooks: resolve `.css` (and other asset) imports that
 * Vite handles at build time to an empty module, so `src/**` can be imported
 * directly by Node tests without a bundler.
 */
const ASSET_RE = /\.(css|scss|sass|svg|png|jpe?g|gif|webp|mp3|ogg|wav|wasm)(\?.*)?$/;

// A real file URL, not a `data:` URI. Loaders further down the chain (tsx)
// re-attach the original specifier's query string to the URL we return, and
// `data:text/javascript;base64,...?init` is rejected by Node 24's ESM loader
// with ERR_INVALID_URL, while `file:///...?init` parses fine.
const EMPTY_MODULE_URL = new URL('./empty-module.mjs', import.meta.url).href;

/**
 * Node ESM resolve hook: redirect asset imports to the empty-module stub.
 *
 * @param {string} specifier Import specifier being resolved.
 * @param {object} context Resolution context supplied by Node.
 * @param {Function} nextResolve Next hook in the chain, for non-asset imports.
 * @returns {Promise<object>} A resolution result; short-circuited for assets.
 */
export async function resolve(specifier, context, nextResolve) {
    if (ASSET_RE.test(specifier)) {
        return {
            url: 'data:text/javascript;base64,ZXhwb3J0IGRlZmF1bHQge307', // "export default {};"
            shortCircuit: true,
            format: 'module',
        };
    }
    return nextResolve(specifier, context);
}
