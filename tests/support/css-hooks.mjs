/**
 * Node module-customization hooks: resolve `.css` (and other asset) imports that
 * Vite handles at build time to an empty module, so `src/**` can be imported
 * directly by Node tests without a bundler.
 *
 * Uses a synthetic `asset-stub:` URL scheme resolved via our own `load` hook,
 * rather than a `data:` URL returned straight from `resolve`. tsx registers its
 * own loader ahead of this one on the `load` chain; when a `data:` URL reached
 * tsx's `load` hook, it mishandled the URL and corrupted the stubbed source
 * (observed as a literal `?init` suffix appended to the module body, breaking
 * `.wasm?init` imports under `wasm-loader-core.ts`). Short-circuiting our own
 * `load` hook for the synthetic scheme keeps tsx from ever seeing it.
 */
const ASSET_RE = /\.(css|scss|sass|svg|png|jpe?g|gif|webp|mp3|ogg|wav|wasm)(\?.*)?$/;
const STUB_SCHEME = 'asset-stub:';

export async function resolve(specifier, context, nextResolve) {
    if (ASSET_RE.test(specifier)) {
        return {
            url: STUB_SCHEME + encodeURIComponent(specifier),
            shortCircuit: true,
        };
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith(STUB_SCHEME)) {
        return {
            format: 'module',
            source: 'export default {};',
            shortCircuit: true,
        };
    }
    return nextLoad(url, context);
}
