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
export * from './environment.ts';
export * from './fireflies.ts';
export * from './animation.ts';
export * from './water.ts';
export * from './lake_features.js';
export * from './glitch.ts';
export * from './chromatic.ts';

// Export lantern flower explicitly if not covered by flowers.ts (it is, but let's be safe)
export { createLanternFlower } from './flowers.ts';

// Export moved modules
export * from './sky.ts';
export * from './stars.ts';
export * from './moon.ts';
export * from './celestial-bodies.ts';
export * from './rainbow.ts'; // Added Rainbow
export * from './aurora.ts'; // .js -> .ts
export * from './panning-pads.ts';
export * from './silence-spirits.ts';
export * from './instrument.ts';
export * from './ribbons.ts'; // .js -> .ts
export * from './mirrors.ts';
export * from './sparkle-trail.ts'; // .js -> .ts
export * from './impacts.ts';
export * from './lotus.ts'; // .js -> .ts
export * from './pollen.ts'; // Added Pollen
export * from './shield.ts'; // Added Shield

// Export Music Reactivity System (New)
export { musicReactivitySystem } from '../systems/music-reactivity.ts';

// Musical flora
export * from './musical_flora.ts';
export * from './arpeggio-batcher.ts';
export * from './portamento-batcher.ts';

// Batchers
export * from './mushroom-batcher.ts';
export * from './cloud-batcher.ts';
export * from './dandelion-batcher.ts';
export * from './lantern-batcher.ts';
export * from './simple-flower-batcher.ts';
export * from './glowing-flower-batcher.ts';
export * from './waterfall-batcher.ts';
