/**
 * glTF → `HeroRig` loading for the hero clip player.
 *
 * `GLTFLoader` lives in three/examples and pulls in its own dependency tail, so
 * it is behind a dynamic `import()`: nothing that merely *calls* the clip API
 * drags the loader into the boot path. Only code that actually loads a rig
 * pays for it, and only when it does.
 */

import type * as THREE from 'three';
import { registerHeroRig, type HeroRig } from './clip-player.ts';

/** The tiny hand-authored test asset (scripts/gen-hero-clip-asset.mjs). */
export const HERO_TEST_ASSET = 'models/hero-clip-test.gltf';

type GLTFLoaderCtor = typeof import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;

let _loaderCtor: Promise<GLTFLoaderCtor> | null = null;

function loaderCtor(): Promise<GLTFLoaderCtor> {
    if (!_loaderCtor) {
        _loaderCtor = import('three/examples/jsm/loaders/GLTFLoader.js').then((m) => m.GLTFLoader);
    }
    return _loaderCtor;
}

export interface LoadHeroRigOptions {
    /** Registry key for the rig. */
    name: string;
    /** URL relative to the site root, e.g. `'models/hero-clip-test.gltf'`. */
    url: string;
    /** Clip to start on load. */
    defaultClip?: string;
    fadeSeconds?: number;
    /** Called with the loaded scene root before the rig is registered. */
    prepare?: (root: THREE.Object3D) => void;
}

/**
 * Load a glTF and register its scene + clips as a hero rig.
 *
 * Rejects if the asset carries no animation clips — a rig with nothing to play
 * is always a content mistake, and a silent no-op is much harder to debug than
 * a rejected promise at the call site.
 */
export async function loadHeroRig(options: LoadHeroRigOptions): Promise<HeroRig> {
    const Loader = await loaderCtor();
    const loader = new Loader();

    const gltf = await loader.loadAsync(options.url);

    if (!gltf.animations || gltf.animations.length === 0) {
        throw new Error(`[hero-anim] "${options.url}" contains no animation clips`);
    }

    const root = gltf.scene;
    options.prepare?.(root);

    return registerHeroRig({
        name: options.name,
        root,
        clips: gltf.animations,
        defaultClip: options.defaultClip,
        fadeSeconds: options.fadeSeconds,
    });
}
