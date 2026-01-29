// src/foliage/index.js
// Export all foliage sub-modules
export * from './common.ts';
export * from './berries.js';
export * from './grass.ts';
export * from './mushrooms.js';
export * from './flowers.ts';
export * from './trees.ts';
export * from './clouds.js';
export * from './waterfalls.js';
export * from './environment.js';
export * from './fireflies.ts';
export * from './animation.ts';
export * from './water.ts'; // Added Waveform Water
export * from './glitch.js'; // Added Glitch Shader
export * from './chromatic.js'; // Added Chromatic Aberration

// Export lantern flower explicitly if not covered by flowers.ts (it is, but let's be safe)
export { createLanternFlower } from './flowers.ts';

// Export moved modules
export * from './sky.ts';
export * from './stars.js';
export * from './moon.js';
export * from './aurora.js'; // Added Aurora
export * from './panning-pads.js';
export * from './silence-spirits.js';
export * from './instrument.js';
export * from './ribbons.js'; // Added Melody Ribbons
export * from './mirrors.ts'; // Added Melody Mirrors
export * from './sparkle-trail.js'; // Added Sparkle Trail
export * from './impacts.js'; // Added Impact Particles
export * from './lotus.js'; // Added Subwoofer Lotus

// Export Music Reactivity System (New)
export { musicReactivitySystem } from '../systems/music-reactivity.ts';

// Musical flora
export * from './musical_flora.js';
export * from './arpeggio-batcher.ts';
export * from './portamento-batcher.ts';
