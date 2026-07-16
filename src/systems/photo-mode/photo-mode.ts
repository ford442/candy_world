import * as THREE from 'three';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { CYCLE_DURATION } from '../../core/config.ts';
import { initExploreCamera, getExploreCamera, setExploreOrbitFlag } from '../../core/camera-modes.ts';
import {
    uBloomStrength,
    uColorSaturation,
    uColorContrast,
    uVignetteStrength,
    uDofFocus,
    uDofMix,
    uDofAperture,
    uShaftScatterBoost,
} from '../../foliage/post-processing.ts';
import { capturePhotoPng } from './photo-capture.ts';
import { PhotoControlsOverlay, type PhotoControlValues } from './photo-controls.ts';
import { defaultPhotoSettings } from './photo-presets.ts';
import { announcePolite } from '../../ui/announcer.ts';
import { getWorldSeed } from '../../world/world-seed.ts';

export interface PhotoModeInitOptions {
    camera: THREE.PerspectiveCamera;
    canvas: HTMLCanvasElement;
    controls: PointerLockControls;
    timeOffset: { value: number };
    renderer: THREE.WebGLRenderer | { domElement: HTMLCanvasElement; getSize: (t: THREE.Vector2) => THREE.Vector2; setSize: (w: number, h: number, u?: boolean) => void; getPixelRatio: () => number; setPixelRatio: (v: number) => void };
    renderFrame: () => void;
    getGameTime?: () => number;
}

const HUD_SELECTORS = [
    '#ability-hud',
    '#tracker-status',
    '#nowPlayingContainer',
    '#game-reticle',
    '#explore-hint',
    '#openJukeboxBtn',
];

function prefersReducedMotion(): boolean {
    return (
        document.body.classList.contains('a11y-motion-reduced') ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

export class PhotoModeManager {
    private active = false;
    private values: PhotoControlValues;
    private overlay: PhotoControlsOverlay | null = null;
    private savedTimeOffset = 0;
    private readonly opts: PhotoModeInitOptions;
    private reducedMotion = false;

    constructor(opts: PhotoModeInitOptions) {
        this.opts = opts;
        const defaults = defaultPhotoSettings();
        this.values = {
            ...defaults,
            cycleTime: 0,
            hideHud: true,
            captureScale: 2,
            watermark: true,
            activePresetId: 'dreamy',
        };
    }

    isActive(): boolean {
        return this.active;
    }

    /** Simulation delta — 0 while photo mode freezes the world. */
    getSimulationDelta(_rawDelta: number): number {
        return this.active ? 0 : _rawDelta;
    }

    /** Manual god-ray opacity multiplier for game-loop shaft pass. */
    getGodRayStrength(): number {
        return this.active ? this.values.godRayStrength : -1;
    }

    /** Apply scrubbed time-of-day to timeOffset each frame (world time frozen in photo mode). */
    syncTimeOfDay(gameTime: number): void {
        if (!this.active) return;
        this.opts.timeOffset.value = this.values.cycleTime - gameTime;
    }

    applyPostFx(): void {
        if (!this.active) return;
        uDofFocus.value = this.values.focusDistance;
        uDofMix.value = this.values.dofMix;
        uDofAperture.value = this.values.aperture;
        uBloomStrength.value = this.values.bloomStrength;
        uColorSaturation.value = this.values.saturation;
        uColorContrast.value = this.values.contrast;
        uVignetteStrength.value = this.values.vignette;
        uShaftScatterBoost.value = CONFIG_SHAFT_SCATTER * this.values.godRayStrength;
    }

    async enter(): Promise<void> {
        if (this.active) return;
        this.active = true;
        this.reducedMotion = prefersReducedMotion();
        (window as Window & { __photoModeActive?: boolean }).__photoModeActive = true;

        this.savedTimeOffset = this.opts.timeOffset.value;
        const gameTime = this.opts.getGameTime?.() ?? 0;
        this.values.cycleTime = (gameTime + this.opts.timeOffset.value) % CYCLE_DURATION;

        this.opts.controls.unlock();

        let explore = getExploreCamera();
        if (!explore) {
            explore = initExploreCamera({
                camera: this.opts.camera,
                canvas: this.opts.canvas,
                controls: this.opts.controls,
                variant: 'orbit',
            });
        }

        if (explore) {
            await explore.enter({ fromToggle: true });
        } else {
            setExploreOrbitFlag(true);
        }

        document.body.classList.add('photo-mode-active');
        this.setHudVisible(!this.values.hideHud);

        this.overlay = new PhotoControlsOverlay({
            initial: this.values,
            reducedMotion: this.reducedMotion,
            onChange: (v, field) => {
                this.values = v;
                if (field === 'hideHud') this.setHudVisible(!v.hideHud);
                if (field === 'cycleTime') this.syncTimeOfDay(this.opts.getGameTime?.() ?? 0);
                this.applyPostFx();
            },
            onCapture: () => void this.capture(),
            onExit: () => void this.exit(),
        });
        this.overlay.show();
        this.applyPostFx();
        announcePolite('Photo mode — simulation paused. Use sliders to compose, Enter to capture.');
    }

    async exit(): Promise<void> {
        if (!this.active) return;
        this.active = false;
        (window as Window & { __photoModeActive?: boolean }).__photoModeActive = false;

        this.overlay?.dispose();
        this.overlay = null;

        getExploreCamera()?.exitToFirstPerson(true);
        setExploreOrbitFlag(false);

        document.body.classList.remove('photo-mode-active');
        this.setHudVisible(true);

        this.opts.timeOffset.value = this.savedTimeOffset;
        announcePolite('Photo mode closed');
    }

    update(delta: number): void {
        if (!this.active) return;
        getExploreCamera()?.update(this.reducedMotion ? 0 : delta);
        this.syncTimeOfDay(this.opts.getGameTime?.() ?? 0);
        this.applyPostFx();
    }

    handleKeyDown(event: KeyboardEvent): boolean {
        if (!this.active) return false;
        if (this.overlay?.handleKeyDown(event)) return true;
        return false;
    }

    toggle(): void {
        if (this.active) void this.exit();
        else void this.enter();
    }

    async capture(): Promise<void> {
        if (!this.active) return;
        const pos = this.opts.camera.position;
        try {
            await capturePhotoPng({
                renderer: this.opts.renderer,
                renderFrame: this.opts.renderFrame,
                scale: this.values.captureScale,
                watermark: this.values.watermark,
                stamp: {
                    seed: getWorldSeed(),
                    x: pos.x,
                    y: pos.y,
                    z: pos.z,
                    preset: this.values.activePresetId ?? undefined,
                },
            });
            announcePolite('Photo saved');
        } catch (err) {
            console.error('[PhotoMode] Capture failed', err);
            announcePolite('Photo capture failed');
        }
    }

    private setHudVisible(visible: boolean): void {
        for (const sel of HUD_SELECTORS) {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) el.style.visibility = visible ? '' : 'hidden';
        }
    }
}

const CONFIG_SHAFT_SCATTER = 0.45;

let manager: PhotoModeManager | null = null;

export function initPhotoMode(options: PhotoModeInitOptions): PhotoModeManager {
    if (manager) return manager;
    manager = new PhotoModeManager(options);
    return manager;
}

export function getPhotoMode(): PhotoModeManager | null {
    return manager;
}

export function isPhotoModeActive(): boolean {
    return manager?.isActive() ?? false;
}
