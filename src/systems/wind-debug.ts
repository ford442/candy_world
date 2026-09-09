/**
 * `?debug=1` wind vector — one arrow, drawn from the unified wind state.
 *
 * The arrow's heading is `WindUniforms.direction` and its length is
 * `speed × gust`, i.e. exactly the number the foliage TSL sway, the GPU
 * foliage animator and the particle systems scale by. If foliage and pollen
 * ever disagree again, this arrow is the ground truth to compare against.
 */

import * as THREE from 'three';
import { getWindState, getWindStrength } from './wind-uniforms.ts';

let _arrow: THREE.ArrowHelper | null = null;
let _enabled = false;
let _camera: THREE.Camera | null = null;

const _dir = new THREE.Vector3(1, 0, 0);
const _origin = new THREE.Vector3();

function isWindDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1' || params.get('debug') === 'true' || params.has('wind');
}

/** Init the wind debug arrow. Call once after the scene and camera exist. */
export function initWindDebug(scene: THREE.Scene, camera: THREE.Camera): void {
    _enabled = isWindDebugEnabled();
    if (!_enabled) return;

    _camera = camera;
    _arrow = new THREE.ArrowHelper(_dir, _origin, 1, 0xff5fa2, 0.5, 0.3);
    _arrow.name = 'wind-debug-vector';
    _arrow.frustumCulled = false;
    scene.add(_arrow);

    (window as any).__wind = getWindState;
    console.log('[Wind] debug vector enabled (?debug=1)');
}

/**
 * Refresh the arrow from the shared wind. Allocation-free; a no-op unless the
 * debug flag is set. Called once per frame from the visuals phase.
 */
export function updateWindDebug(): void {
    if (!_enabled || !_arrow) return;

    const s = getWindState();
    _dir.set(s.directionX, s.directionY, s.directionZ);
    if (_dir.lengthSq() < 1e-6) return;
    _dir.normalize();
    _arrow.setDirection(_dir);
    _arrow.setLength(Math.max(0.5, getWindStrength() * 1.5), 0.5, 0.3);

    // Park it just in front of the camera so it stays readable while walking.
    if (_camera) {
        _camera.getWorldPosition(_origin);
        _origin.y += 2;
        _arrow.position.copy(_origin);
    }
}

/** Remove the arrow (scene teardown / hot reload). */
export function disposeWindDebug(scene: THREE.Scene): void {
    if (!_arrow) return;
    scene.remove(_arrow);
    _arrow.dispose();
    _arrow = null;
    _enabled = false;
}
