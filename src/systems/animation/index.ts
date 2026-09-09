/**
 * Hero clip animation — mixer-driven playback for a small number of
 * non-batched meshes. See docs/HERO_ANIMATION.md for the hero/batch split.
 */

export {
    HeroRig,
    MAX_HERO_RIGS,
    registerHeroRig,
    unregisterHeroRig,
    getHeroRig,
    heroRigCount,
    heroRigNames,
    playHeroClip,
    stopHeroClip,
    updateHeroAnimations,
    disposeHeroAnimations,
} from './clip-player.ts';
export type { HeroClipOptions, HeroRigOptions } from './clip-player.ts';

export { loadHeroRig, HERO_TEST_ASSET } from './hero-rig-loader.ts';
export type { LoadHeroRigOptions } from './hero-rig-loader.ts';
