// src/core/game-loop-systems.ts
// The frame, as registered systems (#1973). Phase and order live here; the
// scheduler runs them, and tests/scheduler-order.test.ts pins the result.
// See docs/ARCHITECTURE.md before moving a system between phases.

import { tickComputeOrchestrator } from '../compute/compute-orchestrator.ts';
import { ensureHeroAnimationDemo, isHeroAnimationDemoEnabled } from '../debug/tools-stub.ts';
import { updateDandelionSeeds } from '../foliage/dandelion-seeds.ts';
import { setFireflyMeshesVisible } from '../foliage/firefly-registry.ts';
import { updateImpacts } from '../foliage/impacts.ts';
import { updateHeroAnimations } from '../systems/animation/clip-player.ts';
import { updateBehaviorSystem } from '../systems/ecs/behaviors/index.ts';
import { updateFaunaSystem } from '../systems/fauna/index.ts';
import { initLivingScore, updateLivingScore } from '../systems/living-score.ts';
import { updatePresenceSystem } from '../systems/net/lazy.ts';
import { SYSTEM_BUDGETS } from '../systems/performance-budget/systems-budget.ts';
import { profiler } from '../utils/profiler.ts';
import { updateSugarCavesTraversal } from '../world/sugar-caves-traversal.ts';
import {
    audioClockSource,
    updateBeatPulse,
    updateGenerativeAudioContext,
} from './game-loop-audio.ts';
import { updateComputePhase } from './game-loop-compute.ts';
import {
    audioSystemRef,
    getBeatFlashIntensity,
    rendererRef,
    sceneRef,
    timeOffsetRef,
} from './game-loop-core.ts';
import { updateFoliagePhase } from './game-loop-foliage.ts';
import { updateGameplayPhase } from './game-loop-gameplay.ts';
import { updateExploreCameraPhase, updateInteractionPhase } from './game-loop-input.ts';
import { updateParticlesPhase } from './game-loop-particles.ts';
import {
    stepPlayerPhysics,
    updatePlayerViewPhase,
    updateRigidBodyPhase,
} from './game-loop-physics.ts';
import { renderPostProcessing, updatePostFX } from './game-loop-postfx.ts';
import { updateStreamingPhase } from './game-loop-streaming.ts';
import { updateVisualsPhase } from './game-loop-visuals.ts';
import { updateInputActions } from './input/actions/frame.ts';
import type { FrameContext, FrameSource, System, SystemScheduler } from './scheduler/index.ts';

type VisualsState = ReturnType<typeof updateVisualsPhase>;

/** Written by `sky-weather-lighting`, read by the animate/audio systems after it. */
let _visuals: VisualsState | null = null;
const hasVisuals = () => _visuals !== null;

// initLivingScore() is async, so calling it every frame allocates a Promise
// per frame even after its own once-guard returns. Call it once.
let _livingScoreBooted = false;

/** Sky/cycle time: BPM-scaled game time plus the time-of-day scrub offset. */
const skyTime = (ctx: FrameContext) => ctx.time + timeOffsetRef.value;

/** Samples audio and advances game time before the first phase. */
export const FRAME_SOURCE: FrameSource = audioClockSource;

export const FRAME_SYSTEMS: readonly System[] = [
    // --- input -------------------------------------------------------------
    {
        // Devices → actions → keyStates and mouse look (#2027, docs/INPUT.md).
        // First: everything after it reads this frame's input.
        id: 'input-actions',
        phase: 'input',
        maxConsecutiveErrors: Infinity,
        update: (ctx) => updateInputActions(ctx.exploreActive),
    },
    {
        id: 'interaction',
        phase: 'input',
        update: (ctx) => updateInteractionPhase(ctx.dt),
    },
    {
        // Chunk load/evict + terrain-edge clamp of the player (#1546/#1548).
        // No-op unless the "play" boot path is active.
        id: 'chunk-streaming',
        phase: 'input',
        update: (ctx) => updateStreamingPhase(ctx.player.position),
    },

    // --- fixed -------------------------------------------------------------
    {
        // Character controller at fixedDt; writes player and the camera.
        // player-view blends the camera for the render afterwards.
        id: 'player-physics',
        phase: 'fixed',
        maxConsecutiveErrors: Infinity,
        update: (ctx) => stepPlayerPhysics(ctx.fixedDt, ctx.exploreActive, ctx.audio),
    },

    // --- simulate ----------------------------------------------------------
    {
        // Camera + player-following visuals at the position blended between
        // the last two fixed steps. First in simulate: everything after it
        // reads the camera the frame will render with.
        id: 'player-view',
        phase: 'simulate',
        update: (ctx) => updatePlayerViewPhase(ctx.fixedAlpha, ctx.exploreActive),
    },
    {
        // Dynamic props, the physics sandbox and the cloth demo.
        id: 'rigid-bodies',
        phase: 'simulate',
        budgetMs: SYSTEM_BUDGETS.rigidBodies.frameMs,
        update: (ctx) => updateRigidBodyPhase(ctx.dt),
    },
    {
        id: 'fauna',
        phase: 'simulate',
        budgetMs: SYSTEM_BUDGETS.fauna.frameMs,
        update: (ctx) => updateFaunaSystem(ctx.dt, skyTime(ctx)),
    },
    {
        // Bob/interact highlight — after fauna so a behavior can read this
        // frame's entity transforms.
        id: 'entity-behaviors',
        phase: 'simulate',
        after: ['fauna'],
        update: (ctx) => updateBehaviorSystem(ctx.dt, skyTime(ctx)),
    },
    {
        id: 'sugar-caves-traversal',
        phase: 'simulate',
        update: ({ player: { position: p } }) => updateSugarCavesTraversal(p.x, p.y, p.z),
    },
    {
        id: 'presence',
        phase: 'simulate',
        update: (ctx) => updatePresenceSystem(ctx.dt, ctx.camera, ctx.player.position),
    },
    {
        // Abilities, berries, HUD. Reads the player as physics left it.
        id: 'gameplay',
        phase: 'simulate',
        after: ['player-view'],
        update: (ctx) => updateGameplayPhase(ctx.dt, skyTime(ctx), ctx.exploreActive, ctx.audio),
    },

    // --- animate -----------------------------------------------------------
    {
        id: 'beat-pulse',
        phase: 'animate',
        update: (ctx) => updateBeatPulse(ctx.audio, ctx.camera),
    },
    {
        // Weather, lighting, shadows, day/night, sky, TSL uniforms.
        id: 'sky-weather-lighting',
        phase: 'animate',
        after: ['beat-pulse'],
        update: (ctx) => {
            _visuals = updateVisualsPhase(
                ctx.dt,
                skyTime(ctx),
                ctx.time,
                ctx.audio,
                getBeatFlashIntensity(),
                ctx.exploreActive,
                ctx.player.position
            );
        },
    },
    {
        // Materials + batcher LOD, after sky/fog uniforms settle.
        id: 'foliage',
        phase: 'animate',
        after: ['sky-weather-lighting'],
        enabled: hasVisuals,
        update: (ctx) => {
            const v = _visuals!;
            updateFoliagePhase(
                ctx.dt,
                ctx.audio,
                v.isNightNow,
                v.weatherStateStr,
                v.weatherIntensity,
                v.dayNightBias
            );
        },
    },
    {
        // Music reactivity, emitters, ribbons, fluid fog.
        id: 'particles',
        phase: 'animate',
        after: ['sky-weather-lighting'],
        budgetMs: SYSTEM_BUDGETS.particles.frameMs,
        enabled: hasVisuals,
        update: (ctx) =>
            updateParticlesPhase(
                ctx.dt,
                skyTime(ctx),
                ctx.audio,
                _visuals!.isNightNow,
                _visuals!.isDeepNight
            ),
    },
    {
        id: 'firefly-visibility',
        phase: 'animate',
        enabled: hasVisuals,
        update: () => setFireflyMeshesVisible(_visuals!.isNightNow),
    },
    {
        id: 'impacts',
        phase: 'animate',
        update: (ctx) => updateImpacts(rendererRef, skyTime(ctx)),
    },
    {
        id: 'dandelion-seeds',
        phase: 'animate',
        update: () => updateDandelionSeeds(rendererRef),
    },
    {
        // One mixer tick for every registered rig. Runs after the simulate
        // systems that call playHeroClip/stopHeroClip.
        id: 'hero-animation',
        phase: 'animate',
        update: (ctx) => {
            updateHeroAnimations(ctx.dt);
            if (isHeroAnimationDemoEnabled() && sceneRef) {
                ensureHeroAnimationDemo(sceneRef, ctx.player.position);
            }
        },
    },

    // --- audio -------------------------------------------------------------
    {
        id: 'generative-audio-context',
        phase: 'audio',
        enabled: hasVisuals,
        update: (ctx) => updateGenerativeAudioContext(ctx.player.position, _visuals!.dayNightBias),
    },
    {
        id: 'living-score',
        phase: 'audio',
        enabled: () => audioSystemRef !== null && _visuals !== null,
        update: (ctx) => {
            if (!_livingScoreBooted) {
                _livingScoreBooted = true;
                void initLivingScore();
            }
            updateLivingScore(audioSystemRef!, _visuals!.dayNightBias, ctx.dt);
        },
    },

    // --- render-prep -------------------------------------------------------
    {
        id: 'postfx-uniforms',
        phase: 'render-prep',
        update: (ctx) => profiler.measure('PostFX', () => updatePostFX(ctx.dt)),
    },
    {
        // Orbit/hybrid dev camera. Player physics is paused while it is active.
        id: 'explore-camera',
        phase: 'render-prep',
        after: ['postfx-uniforms'],
        update: (ctx) => updateExploreCameraPhase(ctx.dt, ctx.exploreActive),
    },
    {
        id: 'gpu-compute',
        phase: 'render-prep',
        update: () => {
            updateComputePhase();
            tickComputeOrchestrator();
        },
    },

    // --- postfx ------------------------------------------------------------
    {
        id: 'render',
        phase: 'postfx',
        maxConsecutiveErrors: Infinity,
        update: () => renderPostProcessing(),
    },
];

export function registerFrameSystems(scheduler: SystemScheduler): void {
    scheduler.setFrameSource(FRAME_SOURCE);
    for (const s of FRAME_SYSTEMS) scheduler.register(s);
}
