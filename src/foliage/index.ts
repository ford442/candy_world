// src/foliage/index.ts
// Export all foliage sub-modules
export * from './common.ts';
export * from './berries.ts';
export * from './grass.ts';
export * from './mushrooms.ts';
export * from './flowers.ts';
export * from './trees.ts';
export * from './clouds.ts';
export * from './waterfalls.ts';
export * from './cave.ts';
export * from './environment.js';
export * from './fireflies.ts';
export * from './animation.ts';
export * from './water.ts';
export * from './lake_features.js';
export * from './glitch.js';
export * from './chromatic.js';

// Export lantern flower explicitly if not covered by flowers.ts (it is, but let's be safe)
export { createLanternFlower } from './flowers.ts';

// Export moved modules
export * from './sky.ts';
export * from './stars.ts';
export * from './moon.ts';
export * from './celestial-bodies.ts';
export * from './rainbow.ts'; // Added Rainbow
export * from './aurora.js';
export * from './panning-pads.js';
export * from './silence-spirits.js';
export * from './instrument.js';
export * from './ribbons.js';
export * from './mirrors.ts';
export * from './sparkle-trail.js';
export * from './impacts.js';
export * from './lotus.js';

// Export Music Reactivity System (New)
export { musicReactivitySystem } from '../systems/music-reactivity.ts';

// Musical flora
export * from './musical_flora.js';
export * from './arpeggio-batcher.ts';
export * from './portamento-batcher.ts';

// Batchers
export * from './mushroom-batcher.ts';
export * from './cloud-batcher.ts';
export * from './dandelion-batcher.ts';
export * from './lantern-batcher.ts';
