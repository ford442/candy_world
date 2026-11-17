// src/systems/discovery/index.ts
// Discovery system. `discovery-optimized.ts` owns the one registry
// (`discoverySystem`); `discovery-log.ts` is the log UI.
//
// Code inside this folder imports its siblings directly, never this file.

export * from './discovery-map.ts';
export * from './discovery-persistence.ts';
export * from './discovery-log.ts';
export * from './discovery-optimized.ts';
