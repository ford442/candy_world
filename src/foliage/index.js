// Export all foliage sub-modules
export * from './common.js';
export * from './berries.js';
export * from './grass.js';
export * from './mushrooms.js';
export * from './flowers.js';
export * from './trees.ts';
export * from './clouds.js';
export * from './waterfalls.js';
export * from './environment.js';
export * from './fireflies.js';
export * from './animation.ts';

// Export lantern flower explicitly if not covered by flowers.js (it is, but let's be safe)
export { createLanternFlower } from './flowers.js';

// Export moved modules
export * from './sky.js';
export * from './stars.js';
export * from './moon.js';
export * from './aurora.js'; // Added Aurora

// Musical flora
export * from './musical_flora.js';
