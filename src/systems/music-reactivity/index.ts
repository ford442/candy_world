// src/systems/music-reactivity/index.ts
// Audio-driven visual feedback: beat pulses, per-group bindings,
// foliage/luminous/sky-wave reactivity and the music wave.
//
// `music-reactivity-defaults.ts` is not re-exported: it is the cluster's internal
// tuning constants, and it declares its own `WeatherReactivityBinding`, which
// would collide with the one in `-core`.
//
// Code inside this folder imports its siblings directly, never this file.
// Foliage modules must not import it either: `music-reactivity-foliage.ts`
// imports foliage, so a foliage -> barrel -> foliage edge is a runtime cycle.

export * from './music-reactivity-core.ts';
export * from './music-reactivity-bindings.ts';
export * from './music-reactivity-foliage.ts';
export * from './music-reactivity-luminous.ts';
export * from './music-reactivity-sky-wave.ts';
export * from './music-reactivity.ts';
export * from './music-wave.ts';
