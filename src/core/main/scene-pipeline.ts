import {
    initParticleEmitterDebugIfNeeded,
} from '../../debug/index.ts';
import { StageLoader } from '../../debug/stages.ts';
import { initPostProcessing } from '../../foliage/post-processing.ts';
import { WebGPUUnavailableError } from '../../rendering/gpu-context.ts';
import {
    publishRendererBreadcrumbs,
    installRendererHotSwitch,
} from '../../rendering/renderer-mode.ts';
import { player } from '../../systems/physics/physics-types.ts';
import { markBootFatal } from '../../ui/boot-fatal.ts';
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
    // eslint-disable-next-line no-console
    console.time('Core Scene Setup');

    let sceneInitResult: Awaited<ReturnType<typeof initScene>> | undefined;
    let initError: unknown = null;
    await StageLoader.loadStage('core', async () => {
        try {
            sceneInitResult = await initScene();
        } catch (err) {
            // A failed WebGPU probe already fell back to WebGL2 inside initScene();
            // reaching here means neither backend could start (stage `webgl`), or
            // the probe passed and the WebGPU renderer still failed (stage
            // `renderer`). Show the blocking diagnostics screen and stop boot.
            if (err instanceof WebGPUUnavailableError) {
                showWebGPUFatalScreen(err);
            } else {
                initError = err;
                throw err;
            }
        }
    });

    if (initError || !sceneInitResult) {
        if (markBootFatal()) {
            loadingScreen.showFatalError(`Failed to initialize 3D scene.
${initError instanceof Error ? initError.message : 'Unknown error'}`);
        }
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw initError || new Error('Scene init failed');
    }

    ctx.sceneInitResult = sceneInitResult;
    ctx.mode = sceneInitResult.mode;

    const { mode, requested, fallbackReason } = sceneInitResult;

    const scene = sceneInitResult.scene;
    assignCoreExports(scene, sceneInitResult.camera, sceneInitResult.renderer);
    setCameraRef(sceneInitResult.camera);
    const camera = sceneInitResult.camera;
    void initParticleEmitterDebugIfNeeded(scene, () => player.position, () => camera);

    installRendererHotSwitch();
    publishRendererBreadcrumbs(requested, mode, fallbackReason);
    showRendererBadge(mode, requested, fallbackReason);
    void import('../../rendering/webgl-debug.ts').then((m) => m.initWebGLDebug(scene, mode));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (window as any).game = {
        camera: sceneInitResult.camera,
        scene: sceneInitResult.scene,
        animatedFoliage,
        interactiveObjects,
    };
    installWorldExportTools();

    // Renderer is up — re-resolve capabilities with isFallbackAdapter / WebGL now known
    // so postfx/warmup/deferred gates match the actual backend before the TSL graph builds.
    refreshStartupCapabilities({
        forceWebGL: mode === 'webgl',
    });

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
    // eslint-disable-next-line no-console
    console.log(
        `[PostFX] tier=${_postfxTier} godRays=${areGodRaysEnabled()} dof=${isDofEnabled()} renderer=${mode}` +
            ' (override: ?postfx=off|low|high, ?dof, ?no_dof)'
    );

    // eslint-disable-next-line no-console
    console.timeEnd('Core Scene Setup');
    loadingScreen.updateProgress(100);
    loadingScreen.completePhase('core-scene');
}
