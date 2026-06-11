// src/core/progressive-startup.ts
// Progressive pre-loop boot pipeline — ordered subsystem loading with halt-on-failure.

import * as THREE from 'three';
import { validateNodeGeometries } from '../foliage/index.ts';
import { InteractionSystem } from '../systems/interaction.ts';
import { musicReactivitySystem } from '../systems/music-reactivity.ts';
import { fluidSystem } from '../systems/fluid_system.ts';
import { AudioSystem } from '../audio/audio-system.ts';
import { BeatSync } from '../audio/beat-sync.ts';
import { WeatherSystem } from '../systems/weather.ts';
import { initWasm } from '../utils/wasm-loader.ts';
import { recordWASMInit } from '../utils/startup-profiler.ts';
import { CONFIG } from './config.ts';
import { initScene } from './init.ts';
import { initInput } from './input/index.ts';
import { initPostProcessing } from '../foliage/post-processing.ts';
import { initWorldCritical } from '../world/generation.ts';
import { initGameLoopDependencies } from './game-loop.ts';
import { initDeferredVisualsDependencies } from './deferred-init.ts';
import { setInputSystem, toggleDayNight } from './hud.ts';
import { player } from '../systems/physics/index.ts';
import {
  getBootPipelineState,
  initProgressiveBoot,
  printBootSummary,
  runBootStage,
  installBootDebugHooks,
} from '../debug/progressive-bootstrap.ts';
import type { LoadingScreen } from '../ui/loading-screen-ui.ts';

const POST_PROCESSING_PROGRESS = 70;

export interface PreLoopBootResult {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGPURenderer | THREE.WebGLRenderer;
  mode: string;
  postProcessing: unknown;
  audioSystem?: AudioSystem;
  beatSync?: BeatSync;
  weatherSystem?: WeatherSystem;
  moon: unknown;
  inputSystem: ReturnType<typeof initInput> | DummyInputSystem;
  controls: unknown;
  interactionSystem: InteractionSystem | DummyInteractionSystem;
  ambientLight: THREE.Light;
  sunLight: THREE.Light;
  sunGlow: unknown;
  sunCorona: unknown;
  lightShaftGroup: unknown;
  sunGlowMat: unknown;
  coronaMat: unknown;
  uShaftOpacity: unknown;
  halted: boolean;
}

interface DummyInputSystem {
  controls: null;
  updateReticleState: () => void;
  setPlaylistMode: () => void;
  getPlaylistIndex: () => number;
}

interface DummyInteractionSystem {
  triggerClick: () => boolean;
  update: () => void;
  dispose: () => void;
}

const DUMMY_INPUT: DummyInputSystem = {
  controls: null,
  updateReticleState: () => {},
  setPlaylistMode: () => {},
  getPlaylistIndex: () => -1,
};

const DUMMY_INTERACTION: DummyInteractionSystem = {
  triggerClick: () => false,
  update: () => {},
  dispose: () => {},
};

/**
 * Run the ordered pre-loop boot pipeline (core → game loop → wasm).
 * Halts with console + overlay when a critical stage fails in debug/halt mode.
 */
export async function runPreLoopBootstrap(
  loadingScreen: LoadingScreen,
  timeOffset: { value: number }
): Promise<PreLoopBootResult | null> {
  initProgressiveBoot();
  installBootDebugHooks();

  // --- Phase 1: Core scene ---
  loadingScreen.startPhase('core-scene');
  console.time('Core Scene Setup');

  let sceneInitResult: ReturnType<typeof initScene> | undefined;
  await runBootStage('core', () => {
    sceneInitResult = initScene();
  });

  if (!sceneInitResult || getBootPipelineState().halted) {
    const msg = getBootPipelineState().haltError ?? 'Core scene initialization was skipped or failed';
    console.error('[Startup] Core Scene Setup failed');
    loadingScreen.showFatalError(`Failed to initialize 3D scene.\n${msg}`);
    printBootSummary(true);
    return null;
  }

  const {
    mode,
    ambientLight,
    sunLight,
    sunGlow,
    sunCorona,
    lightShaftGroup,
    sunGlowMat,
    coronaMat,
    uShaftOpacity,
  } = sceneInitResult;
  const scene = sceneInitResult.scene;
  const camera = sceneInitResult.camera;
  const renderer = sceneInitResult.renderer;

  if (mode === 'webgl') {
    console.warn('[Startup] WebGL fallback mode active. Some visual features may be limited.');
    loadingScreen.updateProgress(POST_PROCESSING_PROGRESS, 'Switching to WebGL mode...');
  } else {
    loadingScreen.updateProgress(POST_PROCESSING_PROGRESS, 'Initializing post-processing...');
  }

  let postProcessing: unknown;
  await runBootStage('postProcessing', () => {
    postProcessing = initPostProcessing(renderer, scene, camera, mode);
  });

  console.timeEnd('Core Scene Setup');
  loadingScreen.updateProgress(100);
  loadingScreen.completePhase('core-scene');

  if (getBootPipelineState().halted) {
    printBootSummary(true);
    return null;
  }

  // --- Phase 2: Audio & weather ---
  loadingScreen.startPhase('audio-init');
  console.time('Audio & Systems Init');

  let audioSystem: AudioSystem | undefined;
  let beatSync: BeatSync | undefined;
  await runBootStage('audio', () => {
    audioSystem = new AudioSystem(CONFIG.audio.useScriptProcessorNode);
    (window as any).AudioSystem = audioSystem;
    loadingScreen.updateProgress(40, 'Creating audio system...');
    beatSync = new BeatSync(audioSystem);
  });

  let weatherSystem: WeatherSystem | undefined;
  await runBootStage('weather', () => {
    loadingScreen.updateProgress(70, 'Initializing weather system...');
    weatherSystem = new WeatherSystem(scene);
    weatherSystem.setRenderer(renderer);
  });

  console.timeEnd('Audio & Systems Init');
  loadingScreen.updateProgress(100);
  loadingScreen.completePhase('audio-init');

  if (getBootPipelineState().halted) {
    printBootSummary(true);
    return null;
  }

  // --- Phase 3: Critical world ---
  loadingScreen.startPhase('world-generation');
  console.time('World Generation');
  loadingScreen.updateProgress(10, 'Loading critical world...');

  let moon: unknown;
  await runBootStage('worldCritical', async () => {
    loadingScreen.updateProgress(20, 'Generating terrain...');
    const result = await initWorldCritical(scene, weatherSystem!);
    moon = result.moon;
    loadingScreen.updateProgress(90, 'World objects ready...');
  });

  console.timeEnd('World Generation');
  loadingScreen.updateProgress(100, 'Base world ready');
  loadingScreen.completePhase('world-generation');

  if (getBootPipelineState().halted) {
    printBootSummary(true);
    return null;
  }

  // --- Music reactivity ---
  await runBootStage('musicReactivity', () => {
    musicReactivitySystem.init(scene, weatherSystem!, beatSync);
    if (moon) {
      musicReactivitySystem.registerMoon(moon);
    }
    if (audioSystem) {
      if (audioSystem.onNote) {
        audioSystem.onNote((note: string, velocity: number, channel: number) => {
          musicReactivitySystem.handleNoteOn(note, velocity, channel);
        });
      } else if (audioSystem.setNoteCallback) {
        audioSystem.setNoteCallback((note: string, velocity: number, channel: number) => {
          musicReactivitySystem.handleNoteOn(note, velocity, channel);
        });
      }
    }
  });

  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => validateNodeGeometries(scene), { timeout: 3000 });
  } else {
    setTimeout(() => validateNodeGeometries(scene), 100);
  }

  // --- Input & interaction ---
  let inputSystem: ReturnType<typeof initInput> | DummyInputSystem = DUMMY_INPUT;
  let controls: unknown = null;
  await runBootStage('input', () => {
    inputSystem = initInput(
      camera,
      audioSystem!,
      () => toggleDayNight(timeOffset),
      () => (player as any).isDancing
    );
    setInputSystem(inputSystem as ReturnType<typeof initInput>);
    controls = (inputSystem as ReturnType<typeof initInput>).controls;
  });

  let interactionSystem: InteractionSystem | DummyInteractionSystem = DUMMY_INTERACTION;
  await runBootStage('interaction', () => {
    interactionSystem = new InteractionSystem(
      camera,
      (inputSystem as ReturnType<typeof initInput>).updateReticleState
    );
  });

  initDeferredVisualsDependencies(scene, camera, renderer);

  await runBootStage('gameLoop', () => {
    if (!interactionSystem || interactionSystem === DUMMY_INTERACTION) {
      console.warn('[gameLoop] InteractionSystem not initialized, using dummy');
      interactionSystem = { ...DUMMY_INTERACTION };
    }
    initGameLoopDependencies({
      scene,
      camera,
      renderer,
      postProcessing,
      weatherSystem: weatherSystem!,
      audioSystem: audioSystem!,
      beatSync: beatSync!,
      interactionSystem: interactionSystem as InteractionSystem,
      moon,
      fireflies: null,
      controls,
      sunLight,
      ambientLight,
      sunGlow,
      sunCorona,
      lightShaftGroup,
      sunGlowMat,
      coronaMat,
      uShaftOpacity,
      timeOffset,
    });
  });

  if (getBootPipelineState().halted) {
    printBootSummary(true);
    return null;
  }

  // --- WASM (optional Emscripten) ---
  loadingScreen.startPhase('wasm-init');
  await runBootStage('wasm', async () => {
    try {
      const wasmOk = await initWasm();
      if (wasmOk) {
        console.log('[WASM] Emscripten loaded successfully');
        recordWASMInit(performance.now(), true, true);
      } else {
        console.warn('[WASM] Emscripten unavailable - JS fallbacks active');
        recordWASMInit(performance.now(), false, false);
      }
    } catch (err) {
      console.warn('[WASM] Emscripten failed, using JS fallbacks:', err);
      recordWASMInit(performance.now(), false, false);
    }
    fluidSystem.init();
  });
  loadingScreen.completePhase('wasm-init');

  printBootSummary();

  return {
    scene,
    camera,
    renderer,
    mode,
    postProcessing,
    audioSystem,
    beatSync,
    weatherSystem,
    moon,
    inputSystem,
    controls,
    interactionSystem: interactionSystem as InteractionSystem,
    ambientLight,
    sunLight,
    sunGlow,
    sunCorona,
    lightShaftGroup,
    sunGlowMat,
    coronaMat,
    uShaftOpacity,
    halted: getBootPipelineState().halted,
  };
}
