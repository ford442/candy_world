/**
 * Cinematic Explore / Wander camera mode.
 * Promotes the dev orbit prototype into a player-facing orbit controller with
 * smooth FP ↔ orbit transitions and ground-snapped exit.
 */

import * as THREE from 'three';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { getGroundHeight as getAuthoritativeGroundHeight } from '../systems/ground-system.ts';
import { player } from '../systems/physics/index.ts';
import { CONFIG } from './config.ts';
import { announcePolite } from '../ui/announcer.ts';

export const EXPLORE_STORAGE_KEY = 'candy.exploreMode';

const TRANSITION_DURATION = 0.5; // seconds for orbit → first-person transition

export type ExploreVariant = 'off' | 'orbit' | 'hybrid';

const _scratchPanMove = new THREE.Vector3();
const _scratchPanForward = new THREE.Vector3();
const _scratchPanRight = new THREE.Vector3();
const _scratchPanEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export function resolveExploreVariant(search: string = window.location.search): ExploreVariant {
    const params = new URLSearchParams(search);
    const explicit = params.get('explore')?.toLowerCase();
    if (explicit === 'hybrid') return 'hybrid';
    if (explicit === '1' || explicit === 'true' || params.has('explore')) return 'orbit';

    try {
        const stored = window.localStorage.getItem(EXPLORE_STORAGE_KEY);
        if (stored === 'hybrid') return 'hybrid';
        if (stored === '1' || stored === 'true') return 'orbit';
    } catch {
        // ignore
    }
    return 'off';
}

export function persistExploreVariant(variant: ExploreVariant): void {
    try {
        if (variant === 'off') {
            window.localStorage.removeItem(EXPLORE_STORAGE_KEY);
        } else {
            window.localStorage.setItem(EXPLORE_STORAGE_KEY, variant === 'hybrid' ? 'hybrid' : '1');
        }
    } catch {
        // ignore
    }
}

export function setExploreOrbitFlag(active: boolean): void {
    const target = window as Window & { __devOrbitActive?: boolean; __exploreActive?: boolean };
    target.__devOrbitActive = active;
    target.__exploreActive = active;
}

export function isExploreActive(): boolean {
    return Boolean((window as Window & { __exploreActive?: boolean }).__exploreActive);
}

export function snapCameraToGround(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const groundY = getAuthoritativeGroundHeight(camera.position.x, camera.position.z);
    const eyeY = groundY + CONFIG.player.eyeHeight;
    player.position.set(camera.position.x, eyeY, camera.position.z);
    player.velocity.set(0, 0, 0);
    camera.position.set(camera.position.x, eyeY, camera.position.z);
    return player.position.clone();
}

export interface ExploreCameraOptions {
    camera: THREE.PerspectiveCamera;
    canvas: HTMLCanvasElement;
    controls: PointerLockControls;
    variant?: ExploreVariant;
    onResetInput?: () => void;
    onHidePauseMenu?: () => void;
}

export class ExploreCameraController {
    private readonly camera: THREE.PerspectiveCamera;
    private readonly canvas: HTMLCanvasElement;
    private readonly controls: PointerLockControls;
    private variant: ExploreVariant;
    private readonly onResetInput?: () => void;
    private readonly onHidePauseMenu?: () => void;

    private orbitControls: OrbitControls | null = null;
    private orbitPromise: Promise<void> | null = null;
    private active = false;
    private tabHeld = false;
    private toggled = false;
    private hybridOrbitHeld = false;
    private transitioning = false;
    private transitionElapsed = 0;
    private transitionFrom = new THREE.Vector3();
    private transitionTo = new THREE.Vector3();
    private hintEl: HTMLElement | null = null;
    private pendingRelock = false;

    constructor(options: ExploreCameraOptions) {
        this.camera = options.camera;
        this.canvas = options.canvas;
        this.controls = options.controls;
        this.variant = options.variant ?? resolveExploreVariant();
        this.onResetInput = options.onResetInput;
        this.onHidePauseMenu = options.onHidePauseMenu;
        this.ensureHintElement();
    }

    getVariant(): ExploreVariant {
        return this.variant;
    }

    setVariant(variant: ExploreVariant): void {
        this.variant = variant;
        persistExploreVariant(variant);
    }

    isActive(): boolean {
        return this.active || this.transitioning;
    }

    isHybrid(): boolean {
        return this.variant === 'hybrid';
    }

    private ensureHintElement(): void {
        if (this.hintEl) return;
        let el = document.getElementById('explore-hint');
        if (!el) {
            el = document.createElement('div');
            el.id = 'explore-hint';
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        this.hintEl = el;
    }

    private setHintVisible(visible: boolean, hybrid = false): void {
        if (!this.hintEl) return;
        if (!visible) {
            this.hintEl.classList.remove('visible');
            return;
        }
        this.hintEl.textContent = hybrid
            ? 'Hybrid explore — hold right mouse to orbit, WASD pans, Enter returns to first-person'
            : 'Explore mode — drag to orbit, scroll to zoom, Enter or click to return to first-person';
        this.hintEl.classList.add('visible');
    }

    private setReticleVisible(visible: boolean): void {
        const reticle = document.getElementById('game-reticle');
        if (reticle) reticle.style.opacity = visible ? '1' : '0';
    }

    private async ensureOrbitControls(): Promise<OrbitControls | null> {
        if (this.orbitControls) return this.orbitControls;
        if (!this.orbitPromise) {
            this.orbitPromise = import('three/examples/jsm/controls/OrbitControls.js').then(() => undefined);
        }
        await this.orbitPromise;
        if (this.orbitControls) return this.orbitControls;

        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const orbit = new OrbitControls(this.camera, this.canvas);
        orbit.enableDamping = true;
        orbit.dampingFactor = 0.08;
        orbit.enablePan = true;
        orbit.maxPolarAngle = Math.PI * 0.49;
        orbit.minDistance = 3;
        orbit.maxDistance = 280;
        orbit.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
        };
        this.orbitControls = orbit;
        return orbit;
    }

    private aimOrbitTarget(): void {
        if (!this.orbitControls) return;
        this.camera.getWorldDirection(_scratchPanForward);
        _scratchPanMove.copy(this.camera.position).addScaledVector(_scratchPanForward, 12);
        this.orbitControls.target.copy(_scratchPanMove);
        this.orbitControls.update();
    }

    async enter(options: { temporary?: boolean; fromToggle?: boolean } = {}): Promise<void> {
        if (this.active || this.transitioning) return;

        this.onResetInput?.();
        this.onHidePauseMenu?.();
        this.controls.unlock();

        const orbit = await this.ensureOrbitControls();
        if (!orbit) return;

        this.aimOrbitTarget();
        this.active = true;
        this.tabHeld = options.temporary === true;
        this.toggled = options.fromToggle === true;
        setExploreOrbitFlag(true);
        this.setHintVisible(true, this.variant === 'hybrid');
        this.setReticleVisible(false);
        announcePolite('Explore mode');
    }

    exitToFirstPerson(relock = true): void {
        if (!this.active && !this.transitioning) return;

        this.onResetInput?.();
        this.pendingRelock = relock;
        this.transitionFrom.copy(this.camera.position);
        snapCameraToGround(this.camera);
        this.transitionTo.copy(this.camera.position);
        this.camera.position.copy(this.transitionFrom);

        if (this.orbitControls) {
            this.orbitControls.enabled = false;
        }

        this.transitionElapsed = 0;
        this.transitioning = true;
        this.active = false;
        this.tabHeld = false;
        this.toggled = false;
        this.hybridOrbitHeld = false;
        this.setHintVisible(false);
        announcePolite('First-person mode');
    }

    togglePersistent(): void {
        if (this.active || this.transitioning) {
            this.exitToFirstPerson(true);
            this.setVariant('off');
            return;
        }
        this.setVariant(this.variant === 'hybrid' ? 'hybrid' : 'orbit');
        void this.enter({ fromToggle: true });
    }

    onTabDown(): void {
        if (this.active && this.toggled) return;
        void this.enter({ temporary: true });
    }

    onTabUp(): void {
        if (this.tabHeld) {
            this.exitToFirstPerson(true);
        }
    }

    onHybridMouseDown(button: number): void {
        if (this.variant !== 'hybrid' || this.active || this.transitioning) return;
        if (button !== 2) return;
        this.hybridOrbitHeld = true;
        void this.enter({ temporary: true });
    }

    onHybridMouseUp(button: number): void {
        if (button !== 2 || !this.hybridOrbitHeld) return;
        this.hybridOrbitHeld = false;
        if (this.tabHeld || this.toggled) return;
        this.exitToFirstPerson(true);
    }

    update(delta: number): void {
        if (this.transitioning) {
            this.transitionElapsed += delta;
            const t = Math.min(1, this.transitionElapsed / TRANSITION_DURATION);
            const eased = t * t * (3 - 2 * t);
            this.camera.position.lerpVectors(this.transitionFrom, this.transitionTo, eased);
            player.position.copy(this.camera.position);

            if (t >= 1) {
                this.transitioning = false;
                setExploreOrbitFlag(false);
                this.setReticleVisible(true);
                if (this.orbitControls) {
                    this.orbitControls.dispose();
                    this.orbitControls = null;
                }
                if (this.pendingRelock) {
                    this.controls.lock();
                }
            }
            return;
        }

        if (!this.active || !this.orbitControls) return;
        this.orbitControls.update();

        if (this.variant === 'hybrid') {
            // Hybrid pan: nudge orbit target on XZ using movement keys via external state
            // (applied from input.ts through panTargetXZ).
        }
    }

    panTargetXZ(forward: number, strafe: number, delta: number): void {
        if (!this.orbitControls || !this.active || this.variant !== 'hybrid') return;
        if (forward === 0 && strafe === 0) return;

        _scratchPanEuler.set(0, this.camera.rotation.y, 0);
        _scratchPanForward.set(0, 0, -1).applyEuler(_scratchPanEuler);
        _scratchPanRight.set(1, 0, 0).applyEuler(_scratchPanEuler);
        _scratchPanMove
            .copy(_scratchPanForward).multiplyScalar(forward)
            .addScaledVector(_scratchPanRight, strafe)
            .normalize()
            .multiplyScalar(28 * delta);

        this.orbitControls.target.add(_scratchPanMove);
        this.camera.position.add(_scratchPanMove);
    }

    dispose(): void {
        this.active = false;
        this.transitioning = false;
        setExploreOrbitFlag(false);
        if (this.orbitControls) {
            this.orbitControls.dispose();
            this.orbitControls = null;
        }
        this.setHintVisible(false);
        this.setReticleVisible(true);
    }
}

let exploreController: ExploreCameraController | null = null;

export function initExploreCamera(options: ExploreCameraOptions): ExploreCameraController {
    if (exploreController) {
        exploreController.dispose();
    }
    exploreController = new ExploreCameraController(options);
    return exploreController;
}

export function getExploreCamera(): ExploreCameraController | null {
    return exploreController;
}

export function updateExploreCamera(delta: number): void {
    exploreController?.update(delta);
}

export async function bootstrapExploreFromPreference(): Promise<void> {
    const variant = resolveExploreVariant();
    if (variant === 'off' || !exploreController) return;
    exploreController.setVariant(variant);
    await exploreController.enter({ fromToggle: true });
}
