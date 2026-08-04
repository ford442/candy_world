import { isCIorHeadless, CONFIG } from '../config.ts';
import { ShaderWarmup } from '../../rendering/shader-warmup.ts';
import { preloadGameplay } from '../../gameplay/lazy.ts';
import { animate } from '../game-loop.ts';
import { StageLoader } from '../../debug/index.ts';
import { renderer } from './exports.ts';
import type { MainContext } from './context.ts';

export function runShaderWarmup(ctx: MainContext): void {
    void (async function warmupAndStartLoop() {
        const { loadingScreen, worldGenerationActive } = ctx;

        await StageLoader.loadStage('shaderWarmup', async () => {
            if (CONFIG.safeMode || isCIorHeadless()) {
                console.warn('[Startup] safeMode active — skipping shader warmup and compileAsync');
                return;
            }
            loadingScreen.startPhase('shader-warmup');
            loadingScreen.updateProgress(5, 'Pre-compiling shaders...');

            const BATCH_SIZE = 10;
            const BUDGET_MS = 100;
            let batchCount = 0;

            try {
                if (CONFIG.safeMode || isCIorHeadless()) {
                    console.warn('[Startup] safeMode active — skipping shader warmup');
                    return;
                }
                const warmup = new ShaderWarmup();
                const targets = warmup.getTargets();

                for (let i = 0; i < targets.length; i += BATCH_SIZE) {
                    const batchStart = performance.now();
                    const batch = targets.slice(i, i + BATCH_SIZE);

                    for (const target of batch) {
                        const mat = target.create();
                        try {
                            await warmup.warmupSingle(mat, renderer, target.name);
                        } catch (_e) {
                            /* skip non-critical failures */
                        }
                    }

                    batchCount++;
                    const batchMs = performance.now() - batchStart;
                    const pct = 5 + Math.round((i / targets.length) * 85);
                    loadingScreen.updateProgress(
                        pct,
                        `Warming shaders (${i + batch.length}/${targets.length})...`
                    );

                    if (batchMs > BUDGET_MS || i + batch.length < targets.length) {
                        await new Promise<void>((resolve) => setTimeout(resolve, 0));
                    }
                }
                warmup.dispose();
                console.log(`[Startup] Shaders pre-compiled in ${batchCount} batch(es)`);
            } catch (err) {
                console.warn('[Warmup] Shader compilation error (non-fatal):', err);
            }

            loadingScreen.updateProgress(90, 'Finalizing scene...');
            console.log('[Startup] Shaders pre-compiled');
            loadingScreen.updateProgress(100, 'Scene ready!');
            loadingScreen.completePhase('shader-warmup');
        });

        renderer.setAnimationLoop(animate);
        try {
            (window as any).__sceneReady = true;
        } catch (e) {}
        void preloadGameplay();

        if (!worldGenerationActive) {
            loadingScreen.hide();
        }
    })();
}
