// src/systems/physics/player-interpolation.ts
// Render-side view of the fixed-step player (#1973).
//
// Player physics steps at a fixed 1/60 s, 0..5 times per frame, and writes both
// `player.position` and the camera. Rendered as-is, a 144 Hz display would see
// the camera move on some frames and hold on others. This blends the camera
// between the last two fixed states by the scheduler's `fixedAlpha`, and puts
// the sim's own camera back before the next step so the blend never feeds
// into the simulation. Pure Three.js math: no DOM, no renderer.

import * as THREE from 'three';

/** Moving farther than this in one fixed step is a teleport: snap, don't blend. */
const TELEPORT_DIST_SQ = 4 * 4;

interface Positioned {
    readonly position: THREE.Vector3;
}

export class PlayerInterpolator {
    /** Camera / player before and after the last fixed step. */
    private readonly prevCam = new THREE.Vector3();
    private readonly simCam = new THREE.Vector3();
    private readonly prevPlayer = new THREE.Vector3();
    private readonly simPlayer = new THREE.Vector3();
    /** The blended camera position last written by `present()`. */
    private readonly written = new THREE.Vector3();
    /** `camera.position` holds a blend (`written`), not the sim's value. */
    private wrote = false;
    /** prev/sim describe a real step taken since the last reset. */
    private valid = false;

    /** Player position to draw with this frame. Updated by `present()`. */
    readonly renderPlayer = new THREE.Vector3();

    /** Call before every fixed step. */
    beginStep(camera: Positioned, player: Positioned): void {
        if (this.wrote) {
            // First step of the frame: hand the sim back the camera it left.
            // If something else moved the camera since (spawn, teleport, the
            // explore camera's exit), the sim continues from there instead.
            if (camera.position.equals(this.written)) camera.position.copy(this.simCam);
            this.wrote = false;
        }
        this.prevCam.copy(camera.position);
        this.prevPlayer.copy(player.position);
    }

    /** Call after every fixed step. */
    endStep(camera: Positioned, player: Positioned): void {
        this.simCam.copy(camera.position);
        this.simPlayer.copy(player.position);
        this.valid = true;
    }

    /**
     * Once per frame, after the fixed phase. Writes the blended camera and
     * returns the blended player position (`renderPlayer`). `active` false
     * (explore camera owns the view) leaves the camera alone and resets.
     */
    present(camera: Positioned, player: Positioned, alpha: number, active: boolean): THREE.Vector3 {
        if (active && this.wrote && !camera.position.equals(this.written)) {
            // Moved externally on a frame with no step: adopt it.
            this.valid = false;
        }
        if (!active || !this.valid) {
            this.valid = false;
            this.wrote = false;
            return this.renderPlayer.copy(player.position);
        }
        if (!player.position.equals(this.simPlayer)) {
            // Moved outside a step (terrain-edge clamp, teleport): draw it where
            // it is; the next step re-bases the blend.
            return this.renderPlayer.copy(player.position);
        }

        const a = this.prevCam.distanceToSquared(this.simCam) > TELEPORT_DIST_SQ ? 1 : alpha;
        camera.position.lerpVectors(this.prevCam, this.simCam, a);
        this.written.copy(camera.position);
        this.wrote = true;

        const b = this.prevPlayer.distanceToSquared(this.simPlayer) > TELEPORT_DIST_SQ ? 1 : alpha;
        return this.renderPlayer.lerpVectors(this.prevPlayer, this.simPlayer, b);
    }

    /** Forget both states; the next step starts a fresh blend. */
    reset(): void {
        this.valid = false;
        this.wrote = false;
    }
}
