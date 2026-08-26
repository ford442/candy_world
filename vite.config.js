// vite.config.js
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// Set modern build target so top-level await in dependencies (e.g. three/examples WebGPU helper)
// doesn't get transformed to an unsupported lower target during bundle/transpile.
export default defineConfig({
    plugins: [wasm(), topLevelAwait()],
    base: './',
    build: {
        sourcemap: true,
        minify: true,
        target: 'es2022',
        // Ensures assets don't get lost in complex folder structures
        assetsDir: './',
        // Restrict rollup input to only the app's root index.html so Vite doesn't try to
        // analyze unrelated HTML files (like those under emsdk/tests) which can import
        // non-app modules such as loader.mjs.
        rollupOptions: {
            input: {
                main: './index.html',
            },
            output: {
                manualChunks(id) {
                    // Vendor chunk - all third-party dependencies
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                    // NOTE: audio + boot UI modules stay in `app` (separate chunks caused
                    // Circular chunk: * ↔ app). weather/particles/compute stay in `weather`
                    // — folding weather into `app` breaks init (TDZ); splitting particles
                    // out of `weather` deadlocks boot. One benign weather ↔ app warning remains.
                    // Workers
                    if (id.includes('/src/workers/')) {
                        return 'workers';
                    }

                    // --- Lazy chunks (#1361): only reached via dynamic import() ---
                    // Thin *lazy.ts stubs stay in `app` (statically imported); the heavy
                    // modules below are loaded via import() from those stubs.
                    // Gameplay abilities (blaster, mines, chord, harpoon, glitch grenade)
                    if (
                        (id.includes('/src/gameplay/') && !id.endsWith('/gameplay/lazy.ts')) ||
                        id.includes('/src/systems/glitch-grenade.ts')
                    ) {
                        return 'gameplay';
                    }
                    // Save menu UI + save-system core (exclude thin lazy stubs)
                    if (
                        (id.includes('/src/ui/save-menu/') && !id.endsWith('/save-menu/lazy.ts')) ||
                        id.includes('/src/systems/save-system/')
                    ) {
                        return 'save-ui';
                    }
                    // Accessibility settings DOM (lazy-loaded menu)
                    if (
                        id.includes('/src/ui/accessibility-menu') &&
                        !id.endsWith('/accessibility-menu-lazy.ts')
                    ) {
                        return 'accessibility-ui';
                    }
                    // Dev cloud placement tool (lazy stub stays in app)
                    if (id.includes('/src/world/cloud-placer.ts')) {
                        return 'cloud-placer';
                    }
                    // Save integration hooks (lazy stub stays in app)
                    if (id.includes('/src/systems/save-integration.ts')) {
                        return 'save-ui';
                    }
                    // Analytics debug overlay (?debug=1 / /stats) — not the *-lazy stub
                    if (
                        id.includes('/src/ui/analytics-debug.ts') ||
                        id.includes('/src/ui/analytics-debug-ui.ts') ||
                        id.includes('/src/ui/analytics-debug-handlers.ts')
                    ) {
                        return 'analytics-debug';
                    }
                    // World content decorators (procedural extras, gem canopy, mycelium)
                    if (
                        id.includes('/src/world/generation-decorators.ts') ||
                        id.includes('/src/world/decorator-streamer.ts')
                    ) {
                        return 'world-content';
                    }
                    // Debug tools (panel, gizmos, ground/placement/circadian/fauna overlays)
                    if (
                        id.includes('/src/debug/') &&
                        !id.endsWith('/debug/stages.ts') &&
                        !id.endsWith('/debug/index.ts') &&
                        !id.endsWith('/debug/lazy.ts') &&
                        !id.endsWith('/debug/tools-stub.ts')
                    ) {
                        return 'debug';
                    }
                    // Presence (Supabase + avatars + start-screen panel). Stubs stay in app.
                    if (
                        (id.includes('/src/systems/net/') &&
                            !id.endsWith('/net/lazy.ts') &&
                            !id.endsWith('/net/biome-at-position.ts')) ||
                        id.includes('/src/ui/presence-panel.ts')
                    ) {
                        return 'presence';
                    }
                    // Photo mode (except thin lazy stub)
                    if (
                        id.includes('/src/systems/photo-mode/') &&
                        !id.endsWith('/photo-mode/lazy.ts')
                    ) {
                        return 'photo-mode';
                    }
                    if (id.includes('/src/rendering/webgl-debug.ts')) {
                        return 'webgl-debug';
                    }
                    if (id.includes('/src/world/map-loader.ts')) {
                        return 'map-loader';
                    }
                    if (id.includes('/src/core/input/playlist-manager.ts')) {
                        return 'playlist-ui';
                    }
                    if (id.includes('/src/utils/startup-profiler')) {
                        return 'profiler';
                    }
                    // Analytics core only used by debug overlay + awakened persistence
                    if (id.includes('/src/systems/analytics')) {
                        return 'analytics-debug';
                    }
                    // Accessibility engine — menu is already lazy; keep off boot path
                    if (id.endsWith('/systems/accessibility.ts')) {
                        return 'accessibility-ui';
                    }
                    // camera-modes, hud-ui, interaction, playlist-ui stay in `app`
                    // (separate chunks created Rollup circular-chunk graphs).
                    if (id.includes('/src/systems/loading-manager.ts')) {
                        return 'loading-ui';
                    }
                    if (id.includes('/src/world/world-health.ts')) {
                        return 'world-health';
                    }
                    if (id.includes('/src/ui/mode-badge.ts')) {
                        return 'mode-badge';
                    }
                    if (id.includes('/src/foliage/batcher-telemetry.ts')) {
                        return 'telemetry';
                    }
                    // Loaded via dynamic import() from scene-pipeline (not a static app edge).
                    if (
                        id.includes('/src/foliage/post-processing.ts') ||
                        id.includes('/src/foliage/post-processing-webgpu.ts') ||
                        id.includes('/src/foliage/post-processing-webgl.ts')
                    ) {
                        return 'postfx-webgpu';
                    }
                    // Shader warmup (loading-screen phase — not first-paint brain)
                    if (id.includes('/src/rendering/shader-warmup.ts')) {
                        return 'shader-warmup';
                    }
                    // CPU cluster bin (no app imports — peeling avoids a clustered ↔ app cycle)
                    if (id.includes('/src/rendering/clustered-bin.ts')) {
                        return 'clustered-lights';
                    }
                    // Awakened flora persistence (feature-flagged ?awakened)
                    if (id.includes('/src/systems/awakened-persistence.ts')) {
                        return 'awakened';
                    }
                    // Generative soundtrack engine (not music-mode.ts resolver)
                    if (
                        id.includes('/src/audio/generative/') &&
                        !id.endsWith('/generative/music-mode.ts')
                    ) {
                        return 'generative-music';
                    }

                    // Weather + particles + compute — separate from `app`. Folding weather
                    // into `app` breaks init order (TDZ). particles/compute must stay with
                    // weather (not app) or dynamic weather load deadlocks at boot.
                    if (
                        id.includes('/src/systems/weather/') ||
                        id.includes('/src/particles/') ||
                        id.includes('/src/compute/') ||
                        id.includes('/src/foliage/berries.ts')
                    ) {
                        return 'weather';
                    }

                    // Remaining app code with intertwined imports stays in one chunk to
                    // avoid circular *chunk* dependencies (foliage ↔ systems core, etc.).
                    if (
                        id.includes('/src/core/') ||
                        id.includes('/src/audio/') ||
                        id.includes('/src/foliage/') ||
                        id.includes('/src/rendering/') ||
                        id.includes('/src/systems/') ||
                        id.includes('/src/ui/') ||
                        id.includes('/src/utils/') ||
                        id.includes('/src/world/')
                    ) {
                        return 'app';
                    }
                    // Remaining modules stay in main
                },
                chunkFileNames: (chunkInfo) => {
                    const prefix = chunkInfo.name === 'vendor' ? 'chunks/vendor' : 'chunks/[name]';
                    return `${prefix}-[hash].js`;
                },
                assetFileNames: (assetInfo) => {
                    const info = assetInfo;
                    if (info.name?.endsWith('.wasm')) {
                        return 'wasm/[name]-[hash][extname]';
                    }
                    if (/\.(png|jpg|svg|gif|webp)$/.test(info.name || '')) {
                        return 'images/[name]-[hash][extname]';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
        // Optimize chunk size warnings
        chunkSizeWarningLimit: 500,
    },
    esbuild: {
        // ensure esbuild treats code as modern so top-level await is preserved
        target: 'es2022',
        legalComments: 'none',
    },
    // Ensure optimizeDeps only scans the app root entry (index.html) and targets
    // modern JS (esnext) so top-level await in dependencies is preserved.
    optimizeDeps: {
        // Force dependency scanning to the app's root index -- don't scan test HTML files
        // inside emsdk or other bundles which can include non-app modules such as loader.mjs.
        entries: ['./index.html'],
        esbuildOptions: {
            target: 'esnext',
        },
    },
    server: {
        headers: {
            // These headers are REQUIRED for SharedArrayBuffer (Pthreads)
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
        // Keep Vite from serving files outside the repository root by default.
        fs: {
            strict: true,
        },
        // Ignore the emsdk test folder (these are unrelated test HTML files that can
        // confuse Vite's dependency scanner and cause unresolved import errors).
        watch: {
            ignored: ['**/emsdk/**'],
        },
    },
    // Ensure the worker file is treated correctly if using Vite's worker import (optional but safe)
    worker: {
        format: 'es',
        plugins: () => [wasm(), topLevelAwait()],
    },
});
