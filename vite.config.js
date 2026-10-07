// vite.config.js
import { defineConfig } from 'vite';


// Set modern build target so top-level await in dependencies (e.g. three/examples WebGPU helper)
// doesn't get transformed to an unsupported lower target during bundle/transpile.
export default defineConfig({
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
                    // GLTFLoader (three/examples) is only reached through the
                    // hero rig loader's dynamic import, so it must be matched
                    // *before* the node_modules → vendor rule below: otherwise
                    // the default boot downloads a loader it will never use.
                    if (id.includes('three/examples/jsm/loaders/GLTFLoader')) {
                        return 'gltf-loader';
                    }
                    // Vendor chunk - all third-party dependencies
                    if (id.includes('node_modules')) {
                        return 'vendor';
                    }
                    // NOTE: audio + boot UI modules stay in `app` (separate chunks caused
                    // Circular chunk: * ↔ app). The one remaining warning is weather ↔ app:
                    // core/main.ts awaits runBootstrap() at top level, so a lazy chunk that
                    // imports `app` and is awaited during bootstrap deadlocks. `weather` is
                    // therefore a static dependency of `app`. See docs/APP_CHUNK_SPLIT.md.
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
                    // World content decorators: generation-decorators.ts and every
                    // generation-decorators-*.ts populator it re-exports. The populators
                    // are only reachable through it, so they load with this chunk; the
                    // catch-all below used to pin them in `app` (#1827).
                    if (
                        id.includes('/src/world/generation-decorators') ||
                        id.includes('/src/world/decorator-streamer.ts')
                    ) {
                        return 'world-content';
                    }
                    // Experimental soft-body solver: only the (lazy) demo imports
                    // it, so it rides the debug chunk rather than adding dead
                    // weight to `app`. Move it out if a real system adopts it.
                    // Same for the systems telemetry table (debug panel only) and
                    // the hero rig loader (hero animation demo only).
                    if (
                        id.includes('/src/systems/physics/soft-body.ts') ||
                        id.includes('/src/systems/performance-budget/systems-telemetry.ts') ||
                        id.includes('/src/systems/animation/hero-rig-loader.ts')
                    ) {
                        return 'debug';
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
                    // map-loader.ts plus the map-loader-*.ts helpers only it (and the
                    // lazy debug export) imports.
                    if (id.includes('/src/world/map-loader')) {
                        return 'map-loader';
                    }
                    // log.ts is an import-free leaf used by app and profiler alike; in
                    // `app` it made profiler -> app -> profiler a circular chunk.
                    if (id.endsWith('/src/utils/log.ts')) {
                        return 'log';
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
                    // (separate chunks created Rollup circular-chunk graphs; app imports
                    // them statically and they import app back).
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
                    // Pure TSL nodes shared between app and postfx chunks
                    if (
                        id.includes('/src/foliage/chromatic-nodes.ts') ||
                        id.includes('/src/foliage/strobe-nodes.ts')
                    ) {
                        return 'postfx-shared';
                    }
                    // Graphs only. The stub stays in `app` and must not live in this
                    // chunk: postfx → app TLA + app awaiting postfx deadlocks boot.
                    if (
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

                    // Weather + particles + compute — separate from `app` (size), statically
                    // imported by it (see the top-level-await note above).
                    if (
                        id.includes('/src/systems/weather/') ||
                        id.includes('/src/systems/weather-utils.ts') ||
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
    // es2022 (like build and esbuild above) so top-level await in dependencies is preserved.
    optimizeDeps: {
        // Force dependency scanning to the app's root index -- don't scan test HTML files
        // inside emsdk or other bundles which can include non-app modules such as loader.mjs.
        entries: ['./index.html'],
        esbuildOptions: {
            target: 'es2022',
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
    },
});
