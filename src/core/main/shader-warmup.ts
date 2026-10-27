import { printBootSummary, runBootStage } from '../../debug/index.ts';
import { preloadGameplay } from '../../gameplay/lazy.ts';
import { CONFIG } from '../config.ts';
import { animate } from '../game-loop.ts';
import { isAutomation, isLoopFreezeRequested } from '../platform/run-mode.ts';
import type { MainContext } from './context.ts';
import { renderer } from './exports.ts';

export function runShaderWarmup(ctx: MainContext): void {
    void (async function warmupAndStartLoop() {
        const { loadingScreen, worldGenerationActive } = ctx;

        await runBootStage('shaderWarmup', async () => {
            if (CONFIG.safeMode || isAutomation()) {
                console.warn('[Startup] safeMode / automation — skipping shader warmup');
                return;
            }
            loadingScreen.startPhase('shader-warmup');
            loadingScreen.updateProgress(5, 'Pre-compiling shaders...');

            try {
                // Real scene, real camera, real target: the pipelines stay
                // cached for the first frame (see rendering/shader-warmup.ts).
                // World generation has not run yet; runDeferredWarmup() covers
                // the generated world once it exists.
                const { compileSceneProgressively } =
                    await import('../../rendering/shader-warmup.ts');
                const { scene, camera } = ctx.sceneInitResult!;
                const stats = await compileSceneProgressively(renderer, scene, camera, {
                    target: ctx.postProcessing?.compileTarget ?? null,
                    onProgress: (done, total) => {
                        const pct = 5 + Math.round((done / Math.max(1, total)) * 85);
                        loadingScreen.updateProgress(pct, `Warming shaders (${done}/${total})...`);
                    },
                });
                console.log(
                    `[Startup] Shaders pre-compiled: ${stats.objects} objects in ${stats.chunks} chunk(s), ` +
                        `max ${stats.maxChunkMs.toFixed(0)} ms/chunk`
                );
            } catch (err) {
                console.warn('[Warmup] Shader compilation error (non-fatal):', err);
            }

            loadingScreen.updateProgress(90, 'Finalizing scene...');
            loadingScreen.updateProgress(100, 'Scene ready!');
            loadingScreen.completePhase('shader-warmup');
        });
        // Last stage on the critical boot path; a no-op unless ?halt/?debug/?boot is set.
        printBootSummary();

        try {
            (window as any).__sceneReady = true;
            console.warn('[Startup] __sceneReady set, starting loop');
        } catch (e) {
            console.warn('[Startup] Error setting __sceneReady', e);
        }
        // The only setAnimationLoop call in src/. Players always get it; a harness
        // that needs a still frame asks with ?freezeLoop=1 (#1972: a UA check here
        // left every Mac without frames).
        if (isLoopFreezeRequested()) {
            console.warn('[Startup] ?freezeLoop=1 — not starting the animation loop');
        } else {
            try {
                renderer.setAnimationLoop(animate);
            } catch (e) {
                console.warn('[Startup] setAnimationLoop threw', e);
            }
        }
        void preloadGameplay();

        if (!worldGenerationActive) {
            loadingScreen.hide();
        }
    })();
}
