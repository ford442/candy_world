import { StageLoader } from '../../debug/index.ts';
import { DeferredLoader, LoadPriority } from '../../systems/deferred-loader.ts';
import { finalizeStartupProfile, startPhase, endPhase } from '../../utils/startup-profiler.ts';
import { initDeferredWorldContent } from '../../world/generation.ts';
import { initDeferredVisuals } from '../deferred-init.ts';
import type { MainContext } from './context.ts';
import { scene } from './exports.ts';

export function scheduleDeferredLoading(ctx: MainContext): void {
    function startDeferredWorldLoading() {
        StageLoader.loadStage('deferredWorld', async () => {
            const { loadParticles } = await import('../../particles/lazy.ts');
            await loadParticles();
            await initDeferredWorldContent(scene, ctx.weatherSystem!, (pct, label) => {
                if (pct % 25 === 0 || pct === 100) {
                    console.log(`[Deferred World] ${pct}%: ${label}`);
                }
            });
        }).catch((err) => {
            console.error('[World] Deferred content failed:', err);
        });
    }

    setTimeout(startDeferredWorldLoading, 150);

    const deferredVisualLoader = new DeferredLoader({
        batchSize: 1,
        useIdleCallback: true,
        idleTimeout: 100,
    });

    deferredVisualLoader.add(LoadPriority.HIGH, 'deferredVisuals', () => {
        console.log('[Deferred] Loading celestial bodies and aurora (via DeferredLoader)...');
        startPhase('Deferred Visuals Init');
        initDeferredVisuals();
        endPhase('Deferred Visuals Init');
    });

    deferredVisualLoader.add(LoadPriority.LOW, 'startupProfile', () => {
        finalizeStartupProfile();
    });

    deferredVisualLoader.on('complete', ({ loaded }) => {
        console.log(`[DeferredLoader] All ${loaded} visual elements loaded`);
    });

    setTimeout(() => {
        deferredVisualLoader.start();
    }, 400);
}
