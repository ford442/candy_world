// src/core/main.ts
// Main entry point — delegates startup to the modular bootstrap pipeline.

// Deterministic random seed override must load before any world-generation logic.
import '../utils/seeded-random.ts';

import '../../style.css';

export { scene, camera, renderer, player, addCameraShake } from './main/exports.ts';

import { setupGlobalKeyboardTactileFeedback } from '../utils/interaction-utils.ts';
import { runBootstrap } from './main/bootstrap.ts';

setupGlobalKeyboardTactileFeedback();
// Not a top-level await: this module is bundled into the `app` chunk, which
// sits in a static import cycle with `weather`. While a TLA here is pending the
// whole cycle stays "evaluating", so the boot's own `import('weather.ts')`
// waits on itself forever. A rejection still reaches the bootstrap's
// `unhandledrejection` handler, which shows the startup error.
void runBootstrap();
