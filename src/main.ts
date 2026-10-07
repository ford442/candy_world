// src/main.ts — the Vite entry (index.html). Boot lives in core/main.ts.
// game-loop.ts is imported first only to keep the module evaluation order boot
// has always had. Nothing is re-exported from here: the scene/camera/renderer
// singletons live in core/main/exports.ts (#1827).
import './core/game-loop.ts';
import './core/main.ts';
