/**
 * Hero clip animation — `AnimationMixer` playback for a *small* number of
 * non-batched meshes (chests, doors, a future fauna hero, cutscene props).
 *
 * Scope, deliberately: this is the **hero** half of the hero/batch split
 * documented in docs/HERO_ANIMATION.md. Instanced content — foliage, the fauna
 * boid swarm — stays on the procedural pose machines and the GPU foliage
 * animator, because a mixer per instance is CPU eval per instance. The cap in
 * `MAX_HERO_RIGS` exists to make that split hard to violate by accident.
 *
 * v1 evaluates keyframed node (TRS) tracks. `SkinnedMesh` rigs work through the
 * exact same path — Three's mixer writes bone TRS and the skinning happens on
 * the GPU — so a skinned hero needs no API change here. What is *not* supported
 * is skinning many instances; that needs a GPU skin path (bone matrices in a
 * storage buffer) and is out of scope for v1.
 *
 * Systems drive this through `playHeroClip` / `stopHeroClip`; the game loop
 * only ever calls `updateHeroAnimations(dt)` once per frame. No system needs to
 * touch loop internals to animate something.
 */

import * as THREE from 'three';

/**
 * Budget guard for the hero/batch split. Eight rigs is roughly the point where
 * per-frame mixer eval stops being free; crossing it is a signal that the
 * content wants the batch path, not a bigger cap.
 */
export const MAX_HERO_RIGS = 8;

/** Default crossfade between clips, in seconds. */
const DEFAULT_FADE = 0.2;

export interface HeroClipOptions {
    /** Loop forever (default) or play once and hold the last frame. */
    loop?: boolean;
    /** Crossfade duration in seconds. 0 = hard cut. */
    fade?: number;
    /** Playback rate multiplier. */
    timeScale?: number;
    /** Restart from frame 0 even if this clip is already the current one. */
    restart?: boolean;
}

export interface HeroRigOptions {
    /** Unique registry key, e.g. `'chest.oak'` or `'fauna.hero'`. */
    name: string;
    /** Scene graph root the clips animate (a glTF scene, or any Object3D). */
    root: THREE.Object3D;
    clips: readonly THREE.AnimationClip[];
    /** Clip to start on registration. */
    defaultClip?: string;
    /** Overrides the module default crossfade for this rig. */
    fadeSeconds?: number;
}

/**
 * One animated hero object: a mixer, its clips, and the cached actions.
 *
 * Actions are created lazily and cached, so a state machine flipping between
 * two clips every few frames allocates nothing after the first play of each.
 */
export class HeroRig {
    readonly name: string;
    readonly root: THREE.Object3D;
    readonly mixer: THREE.AnimationMixer;

    private readonly _clips = new Map<string, THREE.AnimationClip>();
    private readonly _actions = new Map<string, THREE.AnimationAction>();
    private readonly _fade: number;
    private _current: string | null = null;
    private _disposed = false;

    constructor(options: HeroRigOptions) {
        this.name = options.name;
        this.root = options.root;
        this.mixer = new THREE.AnimationMixer(options.root);
        this._fade = options.fadeSeconds ?? DEFAULT_FADE;

        for (const clip of options.clips) {
            this._clips.set(clip.name, clip);
        }

        if (options.defaultClip) this.play(options.defaultClip);
    }

    /** Clip names this rig can play. */
    get clipNames(): string[] {
        return [...this._clips.keys()];
    }

    /** Currently playing clip, or null when stopped. */
    get current(): string | null {
        return this._current;
    }

    get disposed(): boolean {
        return this._disposed;
    }

    /**
     * True when the rig contains a `SkinnedMesh`. Nothing branches on this in
     * v1 — it is the seam a GPU skin path would key off, and a useful assert
     * that a "hero" asset is not accidentally being fed to a batcher.
     */
    get isSkinned(): boolean {
        let skinned = false;
        this.root.traverse((o) => {
            if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
        });
        return skinned;
    }

    hasClip(name: string): boolean {
        return this._clips.has(name);
    }

    /**
     * Start `name`, crossfading out whatever was playing.
     * Returns false for an unknown clip — callers driven by game state should
     * not have to guard every call site against a missing asset.
     */
    play(name: string, options: HeroClipOptions = {}): boolean {
        if (this._disposed) return false;

        const clip = this._clips.get(name);
        if (!clip) {
            console.warn(`[hero-anim] "${this.name}" has no clip "${name}"`);
            return false;
        }

        const fade = options.fade ?? this._fade;
        const action = this._action(name, clip);

        action.loop = options.loop === false ? THREE.LoopOnce : THREE.LoopRepeat;
        action.clampWhenFinished = options.loop === false;
        action.timeScale = options.timeScale ?? 1;

        if (this._current === name && !options.restart) {
            // Already the active clip: keep its playhead, just make sure a
            // previous fade-out did not leave it at zero weight.
            action.enabled = true;
            action.setEffectiveWeight(1);
            if (!action.isRunning()) action.play();
            return true;
        }

        const previous = this._current ? this._actions.get(this._current) : undefined;

        action.enabled = true;
        action.setEffectiveWeight(1);
        if (options.restart || this._current !== name) action.reset();
        action.play();

        if (previous && previous !== action) {
            if (fade > 0) previous.crossFadeTo(action, fade, false);
            else previous.stop();
        }

        this._current = name;
        return true;
    }

    /** Fade the current clip out. `fade = 0` stops on the spot. */
    stop(fade = this._fade): void {
        if (this._disposed || !this._current) return;
        const action = this._actions.get(this._current);
        if (action) {
            if (fade > 0) action.fadeOut(fade);
            else action.stop();
        }
        this._current = null;
    }

    /** Advance this rig alone. Normally driven by `updateHeroAnimations`. */
    update(dt: number): void {
        if (this._disposed) return;
        this.mixer.update(dt);
    }

    /** Release the mixer's actions and cached clip bindings. */
    dispose(): void {
        if (this._disposed) return;
        this.mixer.stopAllAction();
        this.mixer.uncacheRoot(this.root);
        this._actions.clear();
        this._clips.clear();
        this._current = null;
        this._disposed = true;
    }

    private _action(name: string, clip: THREE.AnimationClip): THREE.AnimationAction {
        let action = this._actions.get(name);
        if (!action) {
            action = this.mixer.clipAction(clip);
            this._actions.set(name, action);
        }
        return action;
    }
}

// --- Registry ---------------------------------------------------------------
// Module-level so any system can reach a rig by name without threading a
// reference through init order (the fauna system, interaction, save restore).

const _rigs = new Map<string, HeroRig>();

/**
 * Register a rig under `options.name`. Re-registering a name disposes the old
 * rig first, so hot-reload and re-spawn paths stay leak-free.
 */
export function registerHeroRig(options: HeroRigOptions): HeroRig {
    const existing = _rigs.get(options.name);
    if (existing) existing.dispose();

    if (!existing && _rigs.size >= MAX_HERO_RIGS) {
        // Not fatal — a demo scene may legitimately exceed it — but loud, since
        // the usual cause is instanced content taking the hero path.
        console.warn(
            `[hero-anim] ${_rigs.size} rigs registered (cap ${MAX_HERO_RIGS}). ` +
                `Instanced content belongs on the batch/pose path, not a mixer per instance.`
        );
    }

    const rig = new HeroRig(options);
    _rigs.set(options.name, rig);
    return rig;
}

export function getHeroRig(name: string): HeroRig | null {
    return _rigs.get(name) ?? null;
}

export function heroRigCount(): number {
    return _rigs.size;
}

export function heroRigNames(): string[] {
    return [..._rigs.keys()];
}

/**
 * Play a clip on a registered rig. A no-op returning false when the rig does
 * not exist (yet) — a system reacting to state should not need to know whether
 * the asset has finished streaming in.
 */
export function playHeroClip(rig: string, clip: string, options?: HeroClipOptions): boolean {
    return _rigs.get(rig)?.play(clip, options) ?? false;
}

export function stopHeroClip(rig: string, fade?: number): void {
    _rigs.get(rig)?.stop(fade);
}

export function unregisterHeroRig(name: string): void {
    const rig = _rigs.get(name);
    if (!rig) return;
    rig.dispose();
    _rigs.delete(name);
}

/**
 * Advance every registered rig. One call per frame from the game loop; this is
 * the *only* animation hook the loop needs to know about.
 */
export function updateHeroAnimations(dt: number): void {
    if (_rigs.size === 0) return;
    for (const rig of _rigs.values()) rig.update(dt);
}

/** Tear down every rig — scene teardown / test isolation. */
export function disposeHeroAnimations(): void {
    for (const rig of _rigs.values()) rig.dispose();
    _rigs.clear();
}
