/**
 * Lazy presence / net loader — keeps Supabase + avatars off the critical path
 * unless FEATURE_FLAGS.presence (?presence=1).
 */
import type * as THREE from 'three';
import { FEATURE_FLAGS } from '../../core/config.ts';
import * as netModule from './index.ts';

type NetModule = typeof netModule;

let _mod: NetModule | null = null;

function ensureNet(): NetModule | null {
    if (!FEATURE_FLAGS.presence) return null;
    if (!_mod) {
        _mod = netModule;
    }
    return _mod;
}

export function initPresenceFromOptIn(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    renderer: THREE.Renderer
): void {
    const m = ensureNet();
    m?.initPresenceFromOptIn(scene, camera, renderer);
}

export function updatePresenceSystem(
    delta: number,
    camera: THREE.PerspectiveCamera,
    playerPosition?: THREE.Vector3
): void {
    const m = ensureNet();
    if (!m) return;
    m.updatePresenceSystem(delta, camera, playerPosition);
}

export function teardownPresence(): void {
    const m = ensureNet();
    if (!m) return;
    m.teardownPresence();
}
