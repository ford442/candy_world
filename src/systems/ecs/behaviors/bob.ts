/**
 * `bob` — vertical bob + optional roll for a NON-BATCHED prop.
 *
 * Use this only for one-off Object3Ds the game loop would otherwise animate
 * through `userData.animationType`. Anything drawn by a batcher should stay in
 * its batcher/wind uniforms instead — see docs/BEHAVIORS.md.
 *
 * Zero-alloc: writes scalars onto the cached transform, allocates nothing per
 * frame, and restores the prop's original pose in `onDisable`.
 */

import type * as THREE from 'three';
import type { Entity } from '../types.ts';
import type { Behavior, BehaviorOptions } from '../behavior.ts';

export interface BobOptions extends BehaviorOptions {
    object: THREE.Object3D;
    /** Peak vertical offset in world units. Default 0.15. */
    amplitude?: number;
    /** Cycles per second. Default 0.5. */
    speed?: number;
    /** Phase offset in radians — randomise per prop to desynchronise. */
    phase?: number;
    /** Peak roll in radians applied on Z, 90° behind the bob. Default 0 (off). */
    roll?: number;
}

class BobBehavior implements Behavior {
    private readonly object: THREE.Object3D;
    private readonly amplitude: number;
    private readonly speed: number;
    private readonly phase: number;
    private readonly roll: number;

    private baseY = 0;
    private baseRollZ = 0;

    constructor(options: BobOptions) {
        this.object = options.object;
        this.amplitude = options.amplitude ?? 0.15;
        this.speed = options.speed ?? 0.5;
        this.phase = options.phase ?? 0;
        this.roll = options.roll ?? 0;
    }

    onEnable(): void {
        this.baseY = this.object.position.y;
        this.baseRollZ = this.object.rotation.z;
    }

    tick(_dt: number, time: number): void {
        const t = time * this.speed * Math.PI * 2 + this.phase;
        this.object.position.y = this.baseY + Math.sin(t) * this.amplitude;
        if (this.roll !== 0) {
            this.object.rotation.z = this.baseRollZ + Math.cos(t) * this.roll;
        }
    }

    onDisable(): void {
        this.object.position.y = this.baseY;
        this.object.rotation.z = this.baseRollZ;
    }
}

export function createBobBehavior(_entity: Entity, options: BehaviorOptions): Behavior {
    return new BobBehavior(options as BobOptions);
}
