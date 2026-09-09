// tests/hero-animation.test.mjs
// Behaviour checks for the hero clip player (src/systems/animation/clip-player.ts)
// and the fauna state → clip binding (src/systems/fauna/fauna-clips.ts).
//
// Two things are under test: that the registry/mixer wrapper actually drives a
// node's TRS over time (play, crossfade, stop, dispose), and that the shipped
// test asset in public/models/ is a valid glTF with the clips the demo expects.
//
// Run with tsx (the modules are TypeScript): npm run test:heroanim

// Three's FileLoader constructs a ProgressEvent when resolving the asset's
// embedded data: URI; node has no DOM, so stub the one field it touches.
globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, init = {}) {
        Object.assign(this, init);
        this.type = type;
    }
};

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
    MAX_HERO_RIGS,
    disposeHeroAnimations,
    getHeroRig,
    heroRigCount,
    playHeroClip,
    registerHeroRig,
    stopHeroClip,
    unregisterHeroRig,
    updateHeroAnimations,
} from '../src/systems/animation/clip-player.ts';
import {
    FAUNA_STATE_CLIPS,
    getFaunaHeroClipState,
    resetFaunaHeroClips,
    syncFaunaHeroClip,
} from '../src/systems/fauna/fauna-clips.ts';
import { FaunaState } from '../src/systems/fauna/types.ts';

const DT = 1 / 60;

let failures = 0;
function check(condition, message) {
    if (!condition) {
        failures++;
        console.error(`  ✗ ${message}`);
    } else {
        console.log(`  ✓ ${message}`);
    }
}

/** A node with two clips: 'walk' lifts it on Y, 'idle' pushes it on X. */
function makeRig(name = 'test.rig', clipNames = ['walk', 'idle']) {
    const root = new THREE.Object3D();
    root.name = 'Root';
    const axis = { walk: 1, idle: 0, flee: 2 };
    const clips = clipNames.map((clip) => {
        const values = [0, 0, 0, 0, 0, 0];
        values[3 + (axis[clip] ?? 0)] = 1;
        return new THREE.AnimationClip(clip, 1, [
            new THREE.VectorKeyframeTrack('Root.position', [0, 1], values),
        ]);
    });
    return { root, rig: registerHeroRig({ name, root, clips }) };
}

function advance(seconds) {
    const frames = Math.round(seconds / DT);
    for (let f = 0; f < frames; f++) updateHeroAnimations(DT);
}

// --- 1. A played clip actually moves the node -------------------------------
console.log('\nPlaying a clip drives the node TRS');
{
    disposeHeroAnimations();
    const { root, rig } = makeRig();
    check(rig.clipNames.length === 2, 'both clips registered');
    check(rig.current === null, 'nothing plays until asked');

    playHeroClip('test.rig', 'walk', { loop: true, fade: 0 });
    check(rig.current === 'walk', 'current clip is "walk"');
    advance(0.5);
    check(
        root.position.y > 0.4 && root.position.y < 0.6,
        `y advanced to ${root.position.y.toFixed(3)} at the halfway mark`
    );
}

// --- 2. Looping wraps, one-shot clamps --------------------------------------
console.log('\nLoop wraps; loop:false clamps at the last frame');
{
    disposeHeroAnimations();
    const { root } = makeRig('loop.rig');
    playHeroClip('loop.rig', 'walk', { loop: true, fade: 0 });
    advance(2.5); // 2.5 clips in — a looping clip is back near the halfway pose
    check(root.position.y > 0.4 && root.position.y < 0.6, 'looping clip wrapped around');

    disposeHeroAnimations();
    const once = makeRig('once.rig');
    playHeroClip('once.rig', 'walk', { loop: false, fade: 0 });
    advance(2.5);
    check(
        once.root.position.y > 0.99,
        `one-shot clamped at the last frame (y=${once.root.position.y.toFixed(3)})`
    );
}

// --- 3. Crossfade hands over between clips ----------------------------------
console.log('\nCrossfade moves from one clip to the next');
{
    disposeHeroAnimations();
    const { root, rig } = makeRig('fade.rig');
    playHeroClip('fade.rig', 'walk', { loop: true, fade: 0 });
    advance(0.5);
    const yBefore = root.position.y;

    playHeroClip('fade.rig', 'idle', { loop: true, fade: 0.25 });
    check(rig.current === 'idle', 'current clip switched to "idle"');
    advance(0.12); // mid-fade: both clips still contribute
    check(root.position.y < yBefore && root.position.y > 0, 'walk still contributes mid-fade');
    advance(0.4); // fade complete
    check(root.position.y < 0.02, `walk fully faded out (y=${root.position.y.toFixed(4)})`);
    check(root.position.x > 0, 'idle is now driving the node');
}

// --- 4. Replaying the current clip keeps its playhead unless asked ----------
console.log('\nRe-play keeps the playhead; restart rewinds it');
{
    disposeHeroAnimations();
    const { root } = makeRig('replay.rig');
    playHeroClip('replay.rig', 'walk', { loop: true, fade: 0 });
    advance(0.5);
    playHeroClip('replay.rig', 'walk', { loop: true });
    updateHeroAnimations(0);
    check(root.position.y > 0.4, 'playhead preserved on a redundant play');

    playHeroClip('replay.rig', 'walk', { loop: true, restart: true, fade: 0 });
    updateHeroAnimations(0);
    check(root.position.y < 0.02, `restart rewound to frame 0 (y=${root.position.y.toFixed(4)})`);
}

// --- 5. Stop, unregister, dispose -------------------------------------------
console.log('\nStop and teardown');
{
    disposeHeroAnimations();
    const { rig } = makeRig('stop.rig');
    playHeroClip('stop.rig', 'walk', { loop: true, fade: 0 });
    advance(0.3);
    stopHeroClip('stop.rig', 0);
    check(rig.current === null, 'stop clears the current clip');

    check(heroRigCount() === 1, 'rig still registered after stop');
    unregisterHeroRig('stop.rig');
    check(heroRigCount() === 0, 'unregister removes it');
    check(getHeroRig('stop.rig') === null, 'lookup returns null once gone');
    check(rig.disposed, 'the rig disposed its mixer');

    // The whole point of the null-returning API: state-driven callers must not
    // have to guard every call site while an asset is still streaming in.
    check(playHeroClip('stop.rig', 'walk') === false, 'play on a missing rig is a safe false');
    stopHeroClip('stop.rig');
    updateHeroAnimations(DT);
    check(true, 'update with no rigs registered is a no-op');
}

// --- 6. Unknown clips are refused, not thrown -------------------------------
console.log('\nUnknown clip names are refused');
{
    disposeHeroAnimations();
    makeRig('warn.rig');
    const original = console.warn;
    let warned = 0;
    console.warn = () => warned++;
    const ok = playHeroClip('warn.rig', 'nope');
    console.warn = original;
    check(ok === false, 'play returns false for an unknown clip');
    check(warned === 1, 'and warns once');
    check(getHeroRig('warn.rig').current === null, 'nothing started');
}

// --- 7. Re-registering a name replaces the old rig --------------------------
console.log('\nRe-registering a name disposes the previous rig');
{
    disposeHeroAnimations();
    const first = makeRig('dup.rig').rig;
    const second = makeRig('dup.rig').rig;
    check(first.disposed, 'the old rig was disposed');
    check(second.disposed === false, 'the new one is live');
    check(heroRigCount() === 1, 'the registry holds one entry, not two');
}

// --- 8. The hero/batch cap warns rather than silently scaling ---------------
console.log('\nHero rig cap warns past MAX_HERO_RIGS');
{
    disposeHeroAnimations();
    const original = console.warn;
    let warned = 0;
    console.warn = () => warned++;
    for (let i = 0; i < MAX_HERO_RIGS; i++) makeRig(`cap.${i}`);
    const quiet = warned;
    makeRig(`cap.${MAX_HERO_RIGS}`);
    console.warn = original;
    check(quiet === 0, `no warning up to the cap (${MAX_HERO_RIGS})`);
    check(warned === 1, 'one warning on the rig past it');
    check(heroRigCount() === MAX_HERO_RIGS + 1, 'but the rig is still registered (not fatal)');
}

// --- 9. Fauna state → clip binding ------------------------------------------
console.log('\nFauna state drives the clip without touching the loop');
{
    disposeHeroAnimations();
    resetFaunaHeroClips();

    // No rig yet: the caller must not need to know the asset is still loading.
    check(
        syncFaunaHeroClip('fauna.hero', FaunaState.Wander) === false,
        'sync on a missing rig is a safe false'
    );
    check(getFaunaHeroClipState('fauna.hero') === null, 'and records no state');

    makeRig('fauna.hero', ['walk', 'idle', 'flee']);
    check(syncFaunaHeroClip('fauna.hero', FaunaState.Wander), 'wander applied');
    check(
        getHeroRig('fauna.hero').current === FAUNA_STATE_CLIPS[FaunaState.Wander],
        'plays the wander clip'
    );

    check(syncFaunaHeroClip('fauna.hero', FaunaState.Flee), 'flee applied');
    check(getHeroRig('fauna.hero').current === 'flee', 'plays the flee clip');
    check(getFaunaHeroClipState('fauna.hero') === FaunaState.Flee, 'state recorded');

    // Steady state must not restage the action every frame.
    let restaged = 0;
    const rig = getHeroRig('fauna.hero');
    const realPlay = rig.play.bind(rig);
    rig.play = (...args) => {
        restaged++;
        return realPlay(...args);
    };
    for (let i = 0; i < 120; i++) syncFaunaHeroClip('fauna.hero', FaunaState.Flee);
    check(restaged === 0, 'an unchanged state never touches the mixer');
    rig.play = realPlay;
}

// --- 10. Missing clips fall back to idle ------------------------------------
console.log('\nA rig without the state clip falls back to idle');
{
    disposeHeroAnimations();
    resetFaunaHeroClips();
    makeRig('sparse.hero', ['idle']); // no 'flee'
    check(syncFaunaHeroClip('sparse.hero', FaunaState.Flee), 'sync succeeded');
    check(getHeroRig('sparse.hero').current === 'idle', 'fell back to idle');
}

// --- 11. The shipped test asset is a valid, animated glTF -------------------
console.log('\npublic/models/hero-clip-test.gltf loads with its two clips');
{
    const json = readFileSync(
        new URL('../public/models/hero-clip-test.gltf', import.meta.url),
        'utf8'
    );
    const gltf = await new Promise((resolve, reject) => {
        new GLTFLoader().parse(json, '', resolve, reject);
    });

    const names = gltf.animations.map((c) => c.name).sort();
    check(names.join(',') === 'bounce,spin', `clips are ${names.join(', ')}`);
    check(
        gltf.animations.every((c) => c.duration > 0),
        'both clips have a non-zero duration'
    );

    let meshes = 0;
    gltf.scene.traverse((o) => {
        if (o.isMesh) meshes++;
    });
    check(meshes === 1, 'one mesh in the scene');

    // The demo asks for 'bounce' by name — verify it exists and animates.
    disposeHeroAnimations();
    const rig = registerHeroRig({
        name: 'asset.rig',
        root: gltf.scene,
        clips: gltf.animations,
        defaultClip: 'bounce',
    });
    check(rig.current === 'bounce', 'defaultClip started on registration');
    check(rig.isSkinned === false, 'v1 asset is node-animated, not skinned');

    const node = gltf.scene.getObjectByName('HeroCube');
    advance(0.6); // the peak of the bounce
    check(node.position.y > 0.5, `the cube rose to y=${node.position.y.toFixed(3)}`);

    playHeroClip('asset.rig', 'spin', { loop: true, fade: 0 });
    advance(1.0); // half of the 2 s turn
    check(Math.abs(node.quaternion.y) > 0.9, 'the spin clip turned the cube ~180°');

    disposeHeroAnimations();
}

console.log('');
if (failures > 0) {
    console.error(`Hero animation: ${failures} check(s) failed`);
    process.exit(1);
}
console.log('Hero animation: all checks passed');
