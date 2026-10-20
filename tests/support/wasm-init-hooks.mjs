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
 *
 * The `?init` decision is made in `load`, not `resolve`. Under tsx on Node 24,
 * tsx's hooks are in-thread (`module.registerHooks`) and always run before this
 * async chain: tsx strips the query, resolves the bare `.wasm` path through
 * us, then re-attaches `?init` to the URL we return. So `resolve` may see
 * `x.wasm` or `x.wasm?init`, while `load` always sees the real query.
 */
import { fileURLToPath } from 'node:url';

const WASM_SPECIFIER_RE = /\.wasm(\?init)?$/;

export async function resolve(specifier, context, nextResolve) {
    if (WASM_SPECIFIER_RE.test(specifier)) {
        // Keep the real `.wasm` path and whatever query reached us; under tsx
        // the query is re-attached after this returns.
        return {
            url: new URL(specifier, context.parentURL).href,
            shortCircuit: true,
            format: 'module',
        };
    }
    return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
    const parsed = url.startsWith('file:') ? new URL(url) : null;
    if (parsed && parsed.pathname.endsWith('.wasm')) {
        if (!parsed.searchParams.has('init')) {
            // Bare `.wasm` import: no Vite semantics to emulate; stub it as
            // css-hooks.mjs always did.
            return { format: 'module', source: 'export default {};', shortCircuit: true };
        }
        const wasmPath = fileURLToPath(new URL(parsed.pathname, parsed));
        // Read on call, not on import, as Vite's `?init` fetches on call: a
        // missing binary (suites that run before build:wasm) rejects the init
        // promise and the loader falls back to JS instead of the import crashing.
        const source = `
            import { readFileSync } from 'node:fs';
            export default async (imports) => {
                const bytes = readFileSync(${JSON.stringify(wasmPath)});
                const result = await WebAssembly.instantiate(bytes, imports);
                return result.instance || result;
            };
        `;
        return { format: 'module', source, shortCircuit: true };
    }
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
