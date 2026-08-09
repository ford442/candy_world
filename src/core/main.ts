// src/core/main.ts
// Main entry point — delegates startup to the modular bootstrap pipeline.

// Deterministic random seed override must load before any world-generation logic.
import '../utils/seeded-random.ts';

import '../../style.css';

export { scene, camera, renderer, player, addCameraShake } from './main/exports.ts';

import { runBootstrap } from './main/bootstrap.ts';

await runBootstrap();
