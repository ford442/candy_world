import { StageLoader } from '../../debug/index.ts';
import { fluidSystem } from '../../systems/fluid_system.ts';
import { recordWASMInit } from '../../utils/startup-profiler.ts';
import { initWasm } from '../../utils/wasm-loader.ts';
import type { MainContext } from './context.ts';

export async function runWasmPipeline(ctx: MainContext): Promise<void> {
    const { loadingScreen } = ctx;

    loadingScreen.startPhase('wasm-init');
    await StageLoader.loadStage('wasm', async () => {
        try {
            const wasmOk = await initWasm();
            if (wasmOk) {
                console.log('[WASM] Emscripten loaded successfully');
                recordWASMInit(performance.now(), true, true);
            } else {
                console.warn('[WASM] Emscripten unavailable - JS fallbacks active');
                recordWASMInit(performance.now(), false, false);
            }
        } catch (err) {
            console.warn('[WASM] Emscripten failed, using JS fallbacks:', err);
            recordWASMInit(performance.now(), false, false);
        }
        fluidSystem.init();
    });
    loadingScreen.completePhase('wasm-init');
}
