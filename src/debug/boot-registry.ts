// src/debug/boot-registry.ts
// Ordered boot stage metadata: dependencies, criticality, and preset groupings.

import type { DebugStages } from './stages.ts';

export type BootStageId = keyof DebugStages;

export type BootPresetId = 'sandbox' | 'limited' | 'standard' | 'full';

export interface StageDefinition {
  /** Human-readable label for console summaries */
  label: string;
  /** Lower numbers run first */
  order: number;
  /** If true, failure halts the progressive boot pipeline */
  critical: boolean;
  /** Stages that must succeed before this one runs */
  dependsOn: BootStageId[];
  /** Stages in the same boot group (for preset docs) */
  group: 'render' | 'systems' | 'world' | 'gameplay' | 'compute' | 'deferred';
}

/**
 * Canonical boot order and dependency graph.
 * Used by ProgressiveBootstrap to skip dependents and halt on critical failures.
 */
export const STAGE_REGISTRY: Record<BootStageId, StageDefinition> = {
  core: {
    label: 'Core scene (renderer, camera, lights)',
    order: 0,
    critical: true,
    dependsOn: [],
    group: 'render',
  },
  postProcessing: {
    label: 'Post-processing pipeline',
    order: 10,
    critical: false,
    dependsOn: ['core'],
    group: 'render',
  },
  audio: {
    label: 'Audio system and beat sync',
    order: 20,
    critical: false,
    dependsOn: ['core'],
    group: 'systems',
  },
  weather: {
    label: 'Weather system',
    order: 30,
    critical: false,
    dependsOn: ['core'],
    group: 'systems',
  },
  worldCritical: {
    label: 'Critical world (sky, ground, moon)',
    order: 40,
    critical: true,
    dependsOn: ['core', 'weather'],
    group: 'world',
  },
  musicReactivity: {
    label: 'Music reactivity bindings',
    order: 50,
    critical: false,
    dependsOn: ['audio', 'weather', 'worldCritical'],
    group: 'systems',
  },
  input: {
    label: 'Input and pointer-lock controls',
    order: 60,
    critical: false,
    dependsOn: ['core', 'audio'],
    group: 'gameplay',
  },
  interaction: {
    label: 'Interaction / reticle system',
    order: 70,
    critical: false,
    dependsOn: ['core', 'input'],
    group: 'gameplay',
  },
  gameLoop: {
    label: 'Game loop dependency wiring',
    order: 80,
    critical: true,
    dependsOn: ['core', 'weather', 'audio', 'interaction', 'worldCritical'],
    group: 'gameplay',
  },
  shaderWarmup: {
    label: 'Shader pre-compilation',
    order: 90,
    critical: false,
    dependsOn: ['core', 'postProcessing', 'gameLoop'],
    group: 'render',
  },
  wasm: {
    label: 'Emscripten WASM (optional SIMD)',
    order: 85,
    critical: false,
    dependsOn: ['core'],
    group: 'compute',
  },
  worldGeneration: {
    label: 'World population (CORE / FULL map)',
    order: 100,
    critical: false,
    dependsOn: ['core', 'worldCritical', 'gameLoop'],
    group: 'world',
  },
  deferredVisuals: {
    label: 'Deferred visuals (aurora, celestial)',
    order: 110,
    critical: false,
    dependsOn: ['core', 'worldGeneration'],
    group: 'deferred',
  },
  deferredWorld: {
    label: 'Deferred world content',
    order: 120,
    critical: false,
    dependsOn: ['core', 'worldCritical'],
    group: 'deferred',
  },
};

/** Preset stage toggles — applied when ?boot=<preset> or ?debug=1 without explicit toggles */
export const BOOT_PRESETS: Record<BootPresetId, Partial<DebugStages>> = {
  /**
   * Empty sandbox: renderer + minimal systems only.
   * Matches the recommended debug progression starting point.
   */
  sandbox: {
    core: true,
    postProcessing: false,
    audio: true,
    weather: true,
    worldCritical: true,
    input: true,
    interaction: true,
    musicReactivity: false,
    gameLoop: true,
    shaderWarmup: false,
    wasm: false,
    worldGeneration: false,
    deferredVisuals: false,
    deferredWorld: false,
  },
  /**
   * Limited startup (current DEBUG_STAGES default): playable scene, no heavy world.
   */
  limited: {
    core: true,
    postProcessing: false,
    audio: true,
    weather: true,
    worldCritical: true,
    input: true,
    interaction: true,
    musicReactivity: false,
    gameLoop: true,
    shaderWarmup: false,
    wasm: false,
    worldGeneration: false,
    deferredVisuals: false,
    deferredWorld: false,
  },
  /**
   * Standard: everything through game loop, user triggers world on Enter.
   */
  standard: {
    core: true,
    postProcessing: true,
    audio: true,
    weather: true,
    worldCritical: true,
    input: true,
    interaction: true,
    musicReactivity: true,
    gameLoop: true,
    shaderWarmup: true,
    wasm: true,
    worldGeneration: false,
    deferredVisuals: false,
    deferredWorld: false,
  },
  /** Full progressive load: all stages enabled */
  full: {
    core: true,
    postProcessing: true,
    audio: true,
    weather: true,
    worldCritical: true,
    input: true,
    interaction: true,
    musicReactivity: true,
    gameLoop: true,
    shaderWarmup: true,
    wasm: true,
    worldGeneration: true,
    deferredVisuals: true,
    deferredWorld: true,
  },
};

export function getOrderedStageIds(): BootStageId[] {
  return (Object.keys(STAGE_REGISTRY) as BootStageId[]).sort(
    (a, b) => STAGE_REGISTRY[a].order - STAGE_REGISTRY[b].order
  );
}

export function parseBootPreset(search: string): BootPresetId | null {
  const value = new URLSearchParams(search).get('boot');
  if (!value) return null;
  if (value === 'sandbox' || value === 'limited' || value === 'standard' || value === 'full') {
    return value;
  }
  console.warn(`[Boot] Unknown preset "${value}" — use sandbox|limited|standard|full`);
  return null;
}
