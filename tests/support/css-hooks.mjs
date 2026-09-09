/**
 * Node module-customization hooks: resolve `.css` (and other asset) imports that
 * Vite handles at build time to an empty module, so `src/**` can be imported
 * directly by Node tests without a bundler.
 */
const ASSET_RE = /\.(css|scss|sass|svg|png|jpe?g|gif|webp|mp3|ogg|wav|wasm)(\?.*)?$/;

export async function resolve(specifier, context, nextResolve) {
    if (ASSET_RE.test(specifier)) {
        return {
            url: 'data:text/javascript,export default {}',
            shortCircuit: true,
            format: 'module',
        };
    }
    return nextResolve(specifier, context);
}
