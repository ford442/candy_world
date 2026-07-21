/**
 * Gameplay barrel — intended for dynamic `import()` after scene ready / first ability use.
 * Do not statically import this from the critical boot path (#1361).
 */
export { fireRainbow, updateBlaster } from './rainbow-blaster.ts';
export { jitterMineSystem } from './jitter-mines.ts';
export { chordStrikeSystem } from './chord-strike.ts';
export { createHarpoonLine, updateHarpoonLine } from './harpoon-line.ts';
export { glitchGrenadeSystem } from '../systems/glitch-grenade.ts';
