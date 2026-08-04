import type { InteractionSystem } from '../../systems/interaction.ts';
import { runLoadingBootstrap } from './loading-bootstrap.ts';
import { runScenePipeline } from './scene-pipeline.ts';
import { runAudioWorldPipeline } from './audio-world-pipeline.ts';
import { runInputPipeline } from './input-pipeline.ts';
import { runWasmPipeline } from './wasm-pipeline.ts';
import { runShaderWarmup } from './shader-warmup.ts';
import { setupStartScreen } from './start-screen.ts';
import { scheduleDeferredLoading } from './deferred-loading.ts';
import type { MainContext } from './context.ts';

function createInitialContext(
    loadingScreen: MainContext['loadingScreen'],
    waitForFullPopulation: boolean
): MainContext {
    return {
        loadingScreen,
        waitForFullPopulation,
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
    const { loadingScreen, waitForFullPopulation } = runLoadingBootstrap();
    const ctx = createInitialContext(loadingScreen, waitForFullPopulation);

    await runScenePipeline(ctx);
    await runAudioWorldPipeline(ctx);
    await runInputPipeline(ctx);
    await runWasmPipeline(ctx);
    runShaderWarmup(ctx);
    setupStartScreen(ctx);
    scheduleDeferredLoading(ctx);
}
