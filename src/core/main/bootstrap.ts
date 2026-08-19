import type { InteractionSystem } from '../../systems/interaction.ts';
import { runAudioWorldPipeline } from './audio-world-pipeline.ts';
import type { MainContext } from './context.ts';
import { scheduleDeferredLoading } from './deferred-loading.ts';
import { runInputPipeline } from './input-pipeline.ts';
import { runLoadingBootstrap } from './loading-bootstrap.ts';
import { runScenePipeline } from './scene-pipeline.ts';
import { runShaderWarmup } from './shader-warmup.ts';
import { setupStartScreen } from './start-screen.ts';
import { runWasmPipeline } from './wasm-pipeline.ts';

function createInitialContext(
    loadingScreen: MainContext['loadingScreen'],
    ): MainContext {
    return {
        loadingScreen,
                worldGenerationActive: false,
        mode: 'webgpu',
        postProcessing: null,
        timeOffset: { value: 0 },
        inputSystem: null,
        controls: null,
        interactionSystem: {
            triggerClick: () => false,
            update: () => {},
            dispose: () => {},
        } as any as InteractionSystem,
    };
}

export async function runBootstrap(): Promise<void> {
    const { loadingScreen } = runLoadingBootstrap();
    const ctx = createInitialContext(loadingScreen);

    await runScenePipeline(ctx);
    await runAudioWorldPipeline(ctx);
    await runInputPipeline(ctx);
    await runWasmPipeline(ctx);
    runShaderWarmup(ctx);
    setupStartScreen(ctx);
    scheduleDeferredLoading(ctx);
}
