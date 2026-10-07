// src/core/main.ts
// Main entry point — delegates startup to the modular bootstrap pipeline.

// Deterministic random seed override must load before any world-generation logic.
import '../utils/seeded-random.ts';

import '../../style.css';

export { scene, camera, renderer, player, addCameraShake } from './main/exports.ts';

import { setupGlobalKeyboardTactileFeedback } from '../utils/interaction-utils.ts';
import { markBootFatal } from '../ui/boot-fatal.ts';
import { setWasmError as showLoadingFatalError } from '../ui/loading-screen.ts';
import { runBootstrap } from './main/bootstrap.ts';

setupGlobalKeyboardTactileFeedback();
// Catch here so a failed boot doesn't reject this module. Every lazy chunk that
// imports it would otherwise re-raise the same unhandled rejection. Chunks that
// load after a failed boot see unset exports; nothing past the start screen runs.
await runBootstrap().catch((err: unknown) => {
    console.error('[Bootstrap] Startup failed:', err);
    if (!markBootFatal()) return;
    const msg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    showLoadingFatalError(`Startup failed: ${msg}\n\nRefresh the page to try again.`);
});
