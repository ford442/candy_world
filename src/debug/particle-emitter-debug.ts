/**
 * Particle emitter API console surface — `?debug=1`.
 *
 * Exposes `window.__particles` so the emitter API can be exercised from the
 * console without copying shader files or wiring a system by hand:
 *
 *   __particles.burst('spark_burst', 64)   // burst in front of the player
 *   __particles.burst('candy_puff')
 *   __particles.attract(8, 6)              // pull live particles toward the player
 *   __particles.music()                    // bind treble → emit rate on the shared pool
 *   __particles.list()                     // registered emitters + which tier they run on
 *   __particles.clear()                    // dispose everything the debug hook made
 *
 * and `window.__debris` for the opaque candy-shard batcher:
 *
 *   __debris.burst(32, 0xff66cc)           // shard burst in front of the player
 *   __debris.stats()                       // live instances / capacity / shadows
 *   __debris.shadows(true)                 // LOD0 shard shadows on
 *
 * Nothing here loads in a normal boot: `initParticleEmitterDebug()` is only called
 * from the `?debug=1` path.
 */

import * as THREE from 'three';
import {
    burstCandyDebris,
    getCandyDebrisStats,
    setCandyDebrisShadows,
} from '../foliage/candy-debris-batcher.ts';
import {
    burstAt,
    disposeAllEmitters,
    getEmitters,
    setEmitterParent,
    type AttractorHandle,
    type EmitterPreset,
} from '../particles/emitter-api.ts';

const _spawnPoint = new THREE.Vector3();
const _forward = new THREE.Vector3();

/** Attractor handles created from the console, so `clear()` can release them. */
const debugAttractors: AttractorHandle[] = [];

/**
 * Install `window.__particles`. `scene` becomes the default parent for pools the
 * hook creates on demand; `getPlayerPosition`/`getCamera` locate bursts in front of
 * the player.
 */
export function initParticleEmitterDebug(
    scene: THREE.Scene,
    getPlayerPosition: () => THREE.Vector3,
    getCamera: () => THREE.Camera | null
): void {
    setEmitterParent(scene);

    const spawnPointInFront = (distance = 3): THREE.Vector3 => {
        _spawnPoint.copy(getPlayerPosition());
        const camera = getCamera();
        if (camera) {
            camera.getWorldDirection(_forward);
            _forward.y = 0;
            if (_forward.lengthSq() > 1e-6) {
                _spawnPoint.addScaledVector(_forward.normalize(), distance);
            }
        }
        _spawnPoint.y += 1.0;
        return _spawnPoint;
    };

    (window as any).__particles = {
        /** Fire a one-shot burst of `count` particles in front of the player. */
        burst(preset: EmitterPreset = 'spark_burst', count = 48, distance = 3) {
            const emitter = burstAt(preset, spawnPointInFront(distance), count);
            console.log(
                `[particles] burst ${count}× ${preset} (${emitter.isGPU ? 'GPU compute' : 'CPU fallback'})`
            );
            return emitter.id;
        },

        /** Attach an attractor at the player that pulls the shared pool inward. */
        attract(strength = 8, radius = 6, preset: EmitterPreset = 'spark_burst') {
            const emitter = burstAt(preset, spawnPointInFront(), 0);
            const handle = emitter.addAttractor({
                position: getPlayerPosition(),
                strength,
                radius,
            });
            if (!handle) {
                console.warn('[particles] no free attractor slot on', emitter.id);
                return null;
            }
            debugAttractors.push(handle);
            console.log(`[particles] attractor ${handle.index} on ${emitter.id}`);
            return handle;
        },

        /** Bind treble energy to the shared pool's emit rate. */
        music(preset: EmitterPreset = 'candy_puff', max = 120) {
            const emitter = burstAt(preset, spawnPointInFront(), 0);
            emitter.bindMusic({ source: 'high', target: 'rate', min: 0, max });
            console.log(`[particles] bound audio.high → emit rate (0..${max}/s) on ${emitter.id}`);
            return emitter.id;
        },

        /** Registered emitters and the tier each one is running on. */
        list() {
            const rows: Array<Record<string, unknown>> = [];
            for (const [id, emitter] of getEmitters()) {
                rows.push({ id, preset: emitter.preset, tier: emitter.isGPU ? 'gpu' : 'cpu' });
            }
            console.table(rows);
            return rows;
        },

        /** Dispose every emitter, releasing GPU buffers (never the shared device). */
        clear() {
            for (const handle of debugAttractors) handle.remove();
            debugAttractors.length = 0;
            disposeAllEmitters();
            console.log('[particles] all emitters disposed');
        },
    };

    (window as any).__debris = {
        /** Fire a candy-shard burst in front of the player. */
        burst(count = 24, color: number = 0xffb7e5, speed = 7, distance = 3) {
            const spawned = burstCandyDebris({
                origin: spawnPointInFront(distance),
                count,
                color,
                speed,
            });
            console.log(`[debris] spawned ${spawned}/${count} shards`);
            return spawned;
        },

        /** Live instance count, capacity and shadow state. */
        stats() {
            const stats = getCandyDebrisStats();
            console.table([stats]);
            return stats;
        },

        /** Toggle LOD0 shard shadows (auto-disabled above the caster limit). */
        shadows(enabled = true) {
            setCandyDebrisShadows(enabled);
            console.log(`[debris] shadows ${enabled ? 'enabled' : 'disabled'}`);
        },
    };

    console.log('[particles] debug hook ready — try __particles.burst() / __debris.burst()');
}
