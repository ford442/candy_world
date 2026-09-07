import re

let = open('src/core/main/shader-warmup.ts').read()

let = let.replace("""        await StageLoader.loadStage('shaderWarmup', async () => {
            if (CONFIG.safeMode || isCIorHeadless()) {
                console.warn('[Startup] safeMode active — skipping shader warmup');
                return;
            }""", """        await StageLoader.loadStage('shaderWarmup', async () => {
            if (CONFIG.safeMode || isCIorHeadless()) {
                console.warn('[Startup] safeMode active — skipping shader warmup');
                // Even if skipped, we MUST mark the scene as ready, so tests unblock!
                try {
                    (window as any).__sceneReady = true;
                } catch (e) {
                    void e;
                }
                return;
            }""")

open('src/core/main/shader-warmup.ts', 'w').write(let)
