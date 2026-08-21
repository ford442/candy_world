/**
 * Lazy presence / net loader — keeps Supabase + avatars off the parse path
 * unless FEATURE_FLAGS.presence (?presence=1 / localStorage opt-in).
 *
 * Heavy modules live in the `presence` Rollup chunk (see vite.config.js).
 */
import type * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';
import { spawnImpact } from '../../foliage/impacts.ts';
import type { PresenceInitHooks } from './presence.ts';

type NetModule = typeof import('./presence.ts');

let _mod: NetModule | null = null;
let _load: Promise<NetModule | null> | null = null;
let _pendingInit: {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.Renderer;
} | null = null;
let _tornDown = false;

const presenceHooks: any = { spawnImpact };

function ensureNet(): Promise<NetModule | null> {
    if (!FEATURE_FLAGS.presence) return Promise.resolve(null);
    if (_mod) return Promise.resolve(_mod);
    if (!_load) {
        _load = import('./presence.ts').then((m) => {
            _mod = m;
            if (_pendingInit && !_tornDown) {
                m.initPresenceFromOptIn(
                    _pendingInit.scene,
                    _pendingInit.camera,
                    _pendingInit.renderer,
                    presenceHooks
                );
                _pendingInit = null;
            }
            return m;
        });
    }
    return _load;
}

export function initPresenceFromOptIn(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.Renderer
): void {
    if (!FEATURE_FLAGS.presence) return;
    _tornDown = false;
    _pendingInit = { scene, camera, renderer };
    if (_mod) {
        _mod.initPresenceFromOptIn(scene, camera, renderer, presenceHooks);
        _pendingInit = null;
        return;
    }
    void ensureNet();
}

export function updatePresenceSystem(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition?: THREE.Vector3
): void {
    if (!_mod) {
        if (FEATURE_FLAGS.presence) void ensureNet();
        return;
    }
    _mod.updatePresenceSystem(delta, camera, playerPosition);
}

export function teardownPresence(): void {
    _tornDown = true;
    _pendingInit = null;
    _mod?.teardownPresence();
}
