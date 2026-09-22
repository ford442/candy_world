/**
 * Node module-customization hooks: resolve `.css` (and other asset) imports that
 * Vite handles at build time to an empty module, so `src/**` can be imported
 * directly by Node tests without a bundler.
 */
const ASSET_RE = /\.(css|scss|sass|svg|png|jpe?g|gif|webp|mp3|ogg|wav|wasm)(\?.*)?$/;

export async function resolve(specifier, context, nextResolve) {
    if (ASSET_RE.test(specifier)) {
        return {
            url: `mock-asset:${specifier}`,
            shortCircuit: true,
            format: 'module',
        };
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    if (url.startsWith('mock-asset:')) {
        return {
            format: 'module',
            source: 'export default {};',
            shortCircuit: true,
        };
    }
    return nextLoad(url, context);
}
