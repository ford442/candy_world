import { resolvePostfxQuality, areGodRaysEnabled, isDofEnabled } from '../config.ts';
import { initScene } from '../init.ts';
import { setCameraRef } from '../camera-ref.ts';
import { initPostProcessing } from '../../foliage/post-processing.ts';
import {
    publishRendererBreadcrumbs,
    installRendererHotSwitch,
} from '../../rendering/renderer-mode.ts';
import { initWebGLDebug } from '../../rendering/webgl-debug.ts';
import { animatedFoliage, interactiveObjects } from '../../world/state.ts';
import { installWorldExportTools } from '../../world/map-exporter.ts';
import { showRendererBadge } from '../../ui/mode-badge.ts';
import { StageLoader } from '../../debug/index.ts';
import { assignCoreExports } from './exports.ts';
import { POST_PROCESSING_PROGRESS } from './constants.ts';
import type { MainContext } from './context.ts';

export async function runScenePipeline(ctx: MainContext): Promise<void> {
    const { loadingScreen } = ctx;

    loadingScreen.startPhase('core-scene');
    console.time('Core Scene Setup');

    let sceneInitResult: Awaited<ReturnType<typeof initScene>> | undefined;
    await StageLoader.loadStage('core', async () => {
        sceneInitResult = await initScene();
    });

    if (!sceneInitResult) {
        const msg = 'Core scene initialization was skipped or failed';
        console.error('[Startup] Core Scene Setup failed');
        loadingScreen.showFatalError(`Failed to initialize 3D scene.\n${msg}`);
        throw new Error(msg);
    }

    ctx.sceneInitResult = sceneInitResult;
    ctx.mode = sceneInitResult.mode;

    const {
        mode,
        requested,
        fallbackReason,
    } = sceneInitResult;

    assignCoreExports(sceneInitResult.scene, sceneInitResult.camera, sceneInitResult.renderer);
    setCameraRef(sceneInitResult.camera);

    installRendererHotSwitch();
    publishRendererBreadcrumbs(requested, mode, fallbackReason);
    showRendererBadge(mode, requested, fallbackReason);
    initWebGLDebug(sceneInitResult.scene, mode);

    (window as any).game = {
        camera: sceneInitResult.camera,
        scene: sceneInitResult.scene,
        animatedFoliage,
        interactiveObjects,
    };
    installWorldExportTools();

    if (mode === 'webgl') {
        console.warn('[Startup] WebGL fallback mode active. Some visual features may be limited.');
        loadingScreen.updateProgress(POST_PROCESSING_PROGRESS, 'Switching to WebGL mode...');
    } else {
        loadingScreen.updateProgress(POST_PROCESSING_PROGRESS, 'Initializing post-processing...');
    }

    await StageLoader.loadStage('postProcessing', () => {
        ctx.postProcessing = initPostProcessing(
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
