/**
 * `interact` — emissive highlight while the player is gazing at / near a prop.
 *
 * Replaces the ad-hoc "stash the original emissive on userData and lerp it in
 * the game loop" pattern. The behavior owns the hover state, the cached
 * materials and the restore, so detaching always leaves the prop untouched.
 *
 * It chains onto the existing `interaction.ts` userData hooks
 * (`onGazeEnter`/`onGazeLeave`, `onProximityEnter`/`onProximityLeave`) rather
 * than introducing a second picking path.
 *
 * Zero-alloc: material list and the original-emissive scratch buffers are built
 * in `onEnable`; `tick` only writes numbers into them.
 */

import type * as THREE from 'three';
import type { Entity } from '../types.ts';
import type { Behavior, BehaviorOptions } from '../behavior.ts';

type HighlightTrigger = 'gaze' | 'proximity' | 'both';

export interface InteractHighlightOptions extends BehaviorOptions {
    object: THREE.Object3D;
    /** Highlight tint. Default warm candy white (0xfff0d0). */
    color?: number;
    /** Peak emissive intensity added on top of the material's own. Default 0.8. */
    intensity?: number;
    /** Seconds to reach full highlight (and to fall back off). Default 0.15. */
    attack?: number;
    /** What turns the highlight on. Default 'gaze'. */
    trigger?: HighlightTrigger;
}

interface EmissiveMaterial extends THREE.Material {
    emissive?: THREE.Color;
    emissiveIntensity?: number;
}

class InteractHighlightBehavior implements Behavior {
    private readonly object: THREE.Object3D;
    private readonly tintR: number;
    private readonly tintG: number;
    private readonly tintB: number;
    private readonly intensity: number;
    private readonly rate: number;
    private readonly trigger: HighlightTrigger;

    private materials: EmissiveMaterial[] = [];
    /** Original emissive RGB, 3 floats per material. */
    private baseColor = new Float32Array(0);
    /** Original emissiveIntensity, 1 float per material. */
    private baseIntensity = new Float32Array(0);

    private hovered = false;
    private level = 0;
    /** True until the settled level has been written once — avoids a stuck frame. */
    private dirty = true;

    // Previous hook values, restored on disable (never re-created per frame).
    private prevGazeEnter?: () => void;
    private prevGazeLeave?: () => void;
    private prevProxEnter?: (distanceSq: number) => void;
    private prevProxLeave?: () => void;

    private readonly onEnter = () => {
        this.hovered = true;
    };
    private readonly onLeave = () => {
        this.hovered = false;
    };

    constructor(options: InteractHighlightOptions) {
        this.object = options.object;
        const color = options.color ?? 0xfff0d0;
        this.tintR = ((color >> 16) & 0xff) / 255;
        this.tintG = ((color >> 8) & 0xff) / 255;
        this.tintB = (color & 0xff) / 255;
        this.intensity = options.intensity ?? 0.8;
        this.rate = 1 / Math.max(0.001, options.attack ?? 0.15);
        this.trigger = options.trigger ?? 'gaze';
    }

    onEnable(): void {
        this.collectMaterials();
        this.installHooks();
        this.hovered = false;
        this.level = 0;
        this.dirty = true;
    }

    tick(dt: number, _time: number): void {
        const target = this.hovered ? 1 : 0;
        if (this.level !== target) {
            const step = this.rate * dt;
            if (target > this.level) {
                this.level = this.level + step >= target ? target : this.level + step;
            } else {
                this.level = this.level - step <= target ? target : this.level - step;
            }
            this.dirty = true;
        } else if (!this.dirty) {
            return;
        }

        const level = this.level;
        for (let i = 0; i < this.materials.length; i++) {
            const mat = this.materials[i];
            const emissive = mat.emissive;
            if (!emissive) continue;
            const o = i * 3;
            emissive.setRGB(
                this.baseColor[o] + (this.tintR - this.baseColor[o]) * level,
                this.baseColor[o + 1] + (this.tintG - this.baseColor[o + 1]) * level,
                this.baseColor[o + 2] + (this.tintB - this.baseColor[o + 2]) * level
            );
            mat.emissiveIntensity = this.baseIntensity[i] + this.intensity * level;
        }

        // Settled — stop writing until the hover state changes again.
        if (level === target) this.dirty = false;
    }

    onDisable(): void {
        this.restoreHooks();
        for (let i = 0; i < this.materials.length; i++) {
            const mat = this.materials[i];
            const o = i * 3;
            mat.emissive?.setRGB(this.baseColor[o], this.baseColor[o + 1], this.baseColor[o + 2]);
            mat.emissiveIntensity = this.baseIntensity[i];
        }
        this.materials.length = 0;
        this.hovered = false;
        this.level = 0;
    }

    // -- private ------------------------------------------------------------

    private collectMaterials(): void {
        this.materials.length = 0;
        this.object.traverse((child) => {
            const mat = (child as THREE.Mesh).material;
            if (!mat) return;
            if (Array.isArray(mat)) {
                for (const m of mat) this.pushMaterial(m as EmissiveMaterial);
            } else {
                this.pushMaterial(mat as EmissiveMaterial);
            }
        });

        const count = this.materials.length;
        if (this.baseColor.length < count * 3) this.baseColor = new Float32Array(count * 3);
        if (this.baseIntensity.length < count) this.baseIntensity = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const mat = this.materials[i];
            const o = i * 3;
            this.baseColor[o] = mat.emissive?.r ?? 0;
            this.baseColor[o + 1] = mat.emissive?.g ?? 0;
            this.baseColor[o + 2] = mat.emissive?.b ?? 0;
            this.baseIntensity[i] = mat.emissiveIntensity ?? 1;
        }
    }

    /**
     * Only per-prop, JS-driven emissives can be highlighted:
     *  - a shared/cached material would light up every prop of that species;
     *  - a TSL `emissiveNode` overrides `.emissive`, so writing it does nothing.
     * Those props belong in their batcher/TSL uniforms instead — see
     * docs/BEHAVIORS.md.
     */
    private pushMaterial(mat: EmissiveMaterial): void {
        if (!mat?.emissive) return;
        if (mat.userData?.shared === true) return;
        if ((mat as any).emissiveNode) return;
        if (this.materials.indexOf(mat) === -1) this.materials.push(mat);
    }

    private installHooks(): void {
        const ud = this.object.userData as Record<string, any>;
        if (this.trigger === 'gaze' || this.trigger === 'both') {
            this.prevGazeEnter = ud.onGazeEnter;
            this.prevGazeLeave = ud.onGazeLeave;
            ud.onGazeEnter = this.prevGazeEnter
                ? () => {
                      this.prevGazeEnter!();
                      this.onEnter();
                  }
                : this.onEnter;
            ud.onGazeLeave = this.prevGazeLeave
                ? () => {
                      this.prevGazeLeave!();
                      this.onLeave();
                  }
                : this.onLeave;
        }
        if (this.trigger === 'proximity' || this.trigger === 'both') {
            this.prevProxEnter = ud.onProximityEnter;
            this.prevProxLeave = ud.onProximityLeave;
            ud.onProximityEnter = this.prevProxEnter
                ? (d: number) => {
                      this.prevProxEnter!(d);
                      this.onEnter();
                  }
                : this.onEnter;
            ud.onProximityLeave = this.prevProxLeave
                ? () => {
                      this.prevProxLeave!();
                      this.onLeave();
                  }
                : this.onLeave;
        }
    }

    private restoreHooks(): void {
        const ud = this.object.userData as Record<string, any>;
        if (this.trigger === 'gaze' || this.trigger === 'both') {
            ud.onGazeEnter = this.prevGazeEnter;
            ud.onGazeLeave = this.prevGazeLeave;
        }
        if (this.trigger === 'proximity' || this.trigger === 'both') {
            ud.onProximityEnter = this.prevProxEnter;
            ud.onProximityLeave = this.prevProxLeave;
        }
        this.prevGazeEnter = this.prevGazeLeave = undefined;
        this.prevProxEnter = this.prevProxLeave = undefined;
    }
}

export function createInteractHighlightBehavior(
    _entity: Entity,
    options: BehaviorOptions
): Behavior {
    return new InteractHighlightBehavior(options as InteractHighlightOptions);
}
