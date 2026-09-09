import { StageLoader } from '../../debug/index.ts';
import { initPostProcessing } from '../../foliage/post-processing.ts';
import { WebGPUUnavailableError } from '../../rendering/gpu-context.ts';
import {
    publishRendererBreadcrumbs,
    installRendererHotSwitch,
} from '../../rendering/renderer-mode.ts';
import { showRendererBadge } from '../../ui/mode-badge-lazy.ts';
import { showWebGPUFatalScreen } from '../../ui/webgpu-fatal.ts';
import { installWorldExportTools } from '../../world/map-exporter.ts';
import { animatedFoliage, interactiveObjects } from '../../world/state.ts';
import { setCameraRef } from '../camera-ref.ts';
import { resolvePostfxQuality, areGodRaysEnabled, isDofEnabled } from '../config.ts';
import { initScene } from '../init.ts';
import { refreshStartupCapabilities } from '../startup/capabilities.ts';
import { POST_PROCESSING_PROGRESS } from './constants.ts';
import type { MainContext } from './context.ts';
import { assignCoreExports } from './exports.ts';

export async function runScenePipeline(ctx: MainContext): Promise<void> {
    const { loadingScreen } = ctx;

    loadingScreen.startPhase('core-scene');
    console.time('Core Scene Setup');

    let sceneInitResult: Awaited<ReturnType<typeof initScene>> | undefined;
    try {
        await StageLoader.loadStage('core', async () => {
            sceneInitResult = await initScene();
        });
    } catch (err) {
        // WebGPU is required to enter the world this phase. A failed probe gets
        // the blocking diagnostics screen and boot stops here — we deliberately
        // do not start a WebGL renderer to keep the page looking alive.
        if (err instanceof WebGPUUnavailableError) {
            showWebGPUFatalScreen(err);
        }
        throw err;
    }

    if (!sceneInitResult) {
        const msg = 'Core scene initialization was skipped or failed';
        console.error('[Startup] Core Scene Setup failed');
        loadingScreen.showFatalError(`Failed to initialize 3D scene.\n${msg}`);
        throw new Error(msg);
    }

    ctx.sceneInitResult = sceneInitResult;
    ctx.mode = sceneInitResult.mode;

    const { mode, requested, fallbackReason } = sceneInitResult;

    const scene = sceneInitResult.scene;
    assignCoreExports(scene, sceneInitResult.camera, sceneInitResult.renderer);
    setCameraRef(sceneInitResult.camera);

    installRendererHotSwitch();
    publishRendererBreadcrumbs(requested, mode, fallbackReason);
    showRendererBadge(mode, requested, fallbackReason);
    void import('../../rendering/webgl-debug.ts').then((m) => m.initWebGLDebug(scene, mode));

    (window as any).game = {
        camera: sceneInitResult.camera,
        scene: sceneInitResult.scene,
        animatedFoliage,
        interactiveObjects,
    };
    installWorldExportTools();

    // GPU is armed — re-resolve capabilities with isFallbackAdapter / WebGL now known
    // so postfx/warmup/deferred gates match the actual adapter before the TSL graph builds.
    refreshStartupCapabilities({
        forceWebGL: mode === 'webgl',
    });

    // `mode` is always 'webgpu' this phase — createRenderer() hard-fails instead
    // of falling back. The branch stays for the WebGL restore wave (#1597 era).
    loadingScreen.updateProgress(POST_PROCESSING_PROGRESS, 'Initializing post-processing...');

    await StageLoader.loadStage('postProcessing', async () => {
        ctx.postProcessing = await initPostProcessing(
            sceneInitResult!.renderer,
            sceneInitResult!.scene,
            sceneInitResult!.camera,
            mode
        );
    });

    const _postfxTier = resolvePostfxQuality();
    console.log(
        `[PostFX] tier=${_postfxTier} godRays=${areGodRaysEnabled()} dof=${isDofEnabled()} renderer=${mode}` +
            ' (override: ?postfx=off|low|high, ?dof, ?no_dof)'
    );

    console.timeEnd('Core Scene Setup');
    loadingScreen.updateProgress(100);
    loadingScreen.completePhase('core-scene');
}
