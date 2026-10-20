/**
 * Node module-customization hooks: give `*.wasm?init` imports Vite's real
 * semantics (default export instantiates the binary and resolves the
 * Instance), so the production loader can run against the built AS module in
 * Node tests. Other assets fall through to css-hooks.mjs.
 *
 * Also stands in for Vite's `import.meta.env` in src/ modules (log.ts reads
 * import.meta.env.DEV, which is undefined outside Vite).
 *
 * Register with: --import ./tests/support/register-wasm-hooks.mjs
 */
import { fileURLToPath } from 'node:url';

const WASM_INIT_RE = /\.wasm\?init$/;

export async function resolve(specifier, context, nextResolve) {
    if (WASM_INIT_RE.test(specifier)) {
        const wasmUrl = new URL(specifier.replace(/\?init$/, ''), context.parentURL);

        const wasmPath = fileURLToPath(wasmUrl);
        const source = `
            import { readFileSync } from 'node:fs';
            const bytes = readFileSync(${JSON.stringify(wasmPath)});
            export default async function initCandyPhysics(imports) {
                const result = await WebAssembly.instantiate(bytes, imports);
                return result.instance || result;
            };
        `;
        return { url: `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`, shortCircuit: true, format: 'module' };

    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {

    const result = await nextLoad(url, context);
    if (url.includes('/src/') && result.source != null) {
        const text = String(result.source);
        if (text.includes('import.meta.env')) {
            return {
                ...result,
                source: text.replaceAll(
                    'import.meta.env',
                    '({ DEV: false, PROD: true, MODE: "test" })'
                ),
            };
        }
    }
    return result;
}
