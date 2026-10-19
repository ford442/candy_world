/**
 * @file native-instantiate.ts
 * @brief Settle-or-fail wrapper around an Emscripten MODULARIZE factory.
 *
 * With a custom `instantiateWasm` hook, Emscripten waits for the hook's
 * success callback and never learns about a failure: an exception inside the
 * hook leaves the factory promise pending forever, so boot hangs and the
 * single-threaded / JS fallbacks never run. createNativeModule rejects on a
 * hook failure, a factory failure, or a timeout instead.
 */

/** Upper bound for one variant (MT or ST) to finish instantiating. */
export const NATIVE_INIT_TIMEOUT_MS = 15000;

export interface NativeInstantiateResult {
    instance: WebAssembly.Instance;
    module: WebAssembly.Module;
}

type SuccessCallback = (instance: WebAssembly.Instance, module: WebAssembly.Module) => void;

export function createNativeModule<M>(
    factory: (config: Record<string, unknown>) => Promise<M>,
    config: Record<string, unknown>,
    instantiate: (imports: WebAssembly.Imports) => Promise<NativeInstantiateResult>,
    timeoutMs: number = NATIVE_INIT_TIMEOUT_MS
): Promise<M> {
    return new Promise<M>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            fail(new Error(`native module did not initialize within ${timeoutMs} ms`));
        }, timeoutMs);
        function ok(module: M) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(module);
        }
        function fail(err: unknown) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err instanceof Error ? err : new Error(String(err)));
        }

        const hooked: Record<string, unknown> = {
            ...config,
            instantiateWasm: (imports: WebAssembly.Imports, successCallback: SuccessCallback) => {
                instantiate(imports)
                    // successCallback runs the runtime init; a throw there is a failure too.
                    .then(({ instance, module }) => successCallback(instance, module))
                    .catch(fail);
                return {}; // async: Emscripten waits for successCallback
            },
        };

        try {
            factory(hooked).then(ok, fail);
        } catch (e) {
            fail(e);
        }
    });
}

/**
 * Try each loader in order and return the first that succeeds, or null when
 * all fail (the caller then stays on its JS fallbacks).
 */
export async function firstNativeModule<M>(
    loaders: ReadonlyArray<{ label: string; load: () => Promise<M | null> }>,
    onFailure: (label: string, err: unknown) => void = () => {}
): Promise<M | null> {
    for (const { label, load } of loaders) {
        try {
            const module = await load();
            if (module) return module;
            onFailure(label, null);
        } catch (e) {
            onFailure(label, e);
        }
    }
    return null;
}
