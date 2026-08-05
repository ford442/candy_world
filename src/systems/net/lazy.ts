/**
 * Lazy presence / net loader — keeps Supabase + avatars off the critical path
 * unless FEATURE_FLAGS.presence (?presence=1).
 */
import type * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';

type NetModule = typeof import('./index.ts');

let _mod: NetModule | null = null;
let _load: Promise<NetModule | null> | null = null;

function ensureNet(): Promise<NetModule | null> {
    if (!FEATURE_FLAGS.presence) return Promise.resolve(null);
    if (_mod) return Promise.resolve(_mod);
    if (!_load) {
        _load = import('./index.ts').then((m) => {
            _mod = m;
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
    void ensureNet().then((m) => m?.initPresenceFromOptIn(scene, camera, renderer));
}

export function updatePresenceSystem(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition?: THREE.Vector3
): void {
    if (!_mod) return;
    _mod.updatePresenceSystem(delta, camera, playerPosition);
}

export function teardownPresence(): void {
    if (!_mod) return;
    _mod.teardownPresence();
}
