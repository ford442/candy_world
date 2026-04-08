// src/main.ts
// Application entry point - re-exports from core modules
// This file is kept as the entry point for backward compatibility

import { addCameraShake } from './core/game-loop.ts';

// Re-export for other modules that import from main.ts
export { addCameraShake };
export { scene, camera, renderer, player } from './core/main.ts';

// Import core main to trigger initialization
import './core/main.ts';
