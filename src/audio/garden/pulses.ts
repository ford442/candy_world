/**
 * @file src/audio/garden/pulses.ts
 * @brief The planted flora's response when their note is heard: a swell that settles.
 *
 * `hit` is called from the heard-step path (`player.ts`), so the plant moves on the sound, not on
 * the moment the note was queued. A chime tulip's bell swells and tilts; a drum puffball squashes
 * and recovers. Plain scale and rotation on the plant's own `userData.gardenPulse` object (set by
 * `foliage/chime-tulip.ts` / `drum-puffball.ts`); no per-frame allocation.
 *
 * A puffball whose drum came from its id (no `drum` param) is tinted to it the first time it is
 * heard: the foliage file cannot resolve the id without importing the document model.
 */

import type * as THREE from 'three';
import { DRUM_PUFFBALL_TYPE, resolveDrumPuffball } from '../../world/document/garden-flora.ts';

const SWELL = 0.35;
const SQUASH = 0.28;
const SETTLE_PER_SEC = 9;

export class GardenPulses {
    private readonly amounts = new Map<THREE.Object3D, number>();

    /** Plant `obj` was just heard at `velocity` (0..1). */
    hit(obj: THREE.Object3D, velocity: number): void {
        const ud = obj.userData as Record<string, unknown>;
        const target = ud.gardenPulse as THREE.Object3D | undefined;
        if (!target) return;
        this.tintOnce(obj, ud);
        const amount = 0.5 + 0.5 * Math.max(0, Math.min(1, velocity));
        this.amounts.set(obj, Math.max(this.amounts.get(obj) ?? 0, amount));
        this.apply(obj, ud.gardenKind, target, amount);
    }

    private tintOnce(obj: THREE.Object3D, ud: Record<string, unknown>): void {
        if (ud.gardenKind !== DRUM_PUFFBALL_TYPE || ud.gardenTinted === true) return;
        ud.gardenTinted = true;
        const id = ud.mapEntityId;
        const tint = ud.gardenTint;
        if (typeof id !== 'string' || typeof tint !== 'function') return;
        (tint as (drum: string) => void)(resolveDrumPuffball(id, ud.gardenParams).drum);
    }

    private apply(obj: THREE.Object3D, kind: unknown, target: THREE.Object3D, a: number): void {
        if (kind === DRUM_PUFFBALL_TYPE) {
            target.scale.set(1 + SQUASH * 0.7 * a, 1 - SQUASH * a, 1 + SQUASH * 0.7 * a);
        } else {
            target.scale.setScalar(1 + SWELL * a);
            // Alternate the tilt by position so a field of tulips does not nod in unison.
            target.rotation.z = (obj.position.x + obj.position.z > 0 ? 1 : -1) * 0.3 * a;
        }
    }

    /** Ease every swelling plant back to rest. */
    settle(dt: number): void {
        if (this.amounts.size === 0) return;
        const k = Math.exp(-SETTLE_PER_SEC * dt);
        for (const [obj, amount] of this.amounts) {
            const ud = obj.userData as Record<string, unknown>;
            const target = ud.gardenPulse as THREE.Object3D | undefined;
            const next = amount * k;
            if (!target || obj.parent === null || next < 0.01) {
                target?.scale.set(1, 1, 1);
                if (target) target.rotation.z = 0;
                this.amounts.delete(obj);
                continue;
            }
            this.amounts.set(obj, next);
            this.apply(obj, ud.gardenKind, target, next);
        }
    }

    clear(): void {
        for (const obj of this.amounts.keys()) {
            const target = (obj.userData as Record<string, unknown>).gardenPulse as
                THREE.Object3D | undefined;
            target?.scale.set(1, 1, 1);
            if (target) target.rotation.z = 0;
        }
        this.amounts.clear();
    }
}
