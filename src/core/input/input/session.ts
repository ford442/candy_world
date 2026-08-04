import type * as THREE from 'three';
import type { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { AudioSystem } from '../../../audio/audio-system';
import type { ExploreCameraController, ExploreVariant } from '../../camera-modes.ts';

/** Mutable DOM/runtime bindings for input setup modules. */
export interface InputSession {
    controls: PointerLockControls;
    camera: THREE.Camera;
    audioSystem: AudioSystem;
    instructions: HTMLElement | null;
    startButton: HTMLButtonElement | null;
    canvas: HTMLCanvasElement | null;
    isDevBuild: boolean;
    hudDash: HTMLElement | null;
    hudMine: HTMLElement | null;
    hudPhase: HTMLElement | null;
    toggleDayNightCallback: (() => void) | null;
    shouldPreventMenuOnUnlock: (() => boolean) | null;
    exploreVariant: ExploreVariant;
    exploreCamera: ExploreCameraController;
    focus: {
        lastFocusedElement: HTMLElement | null;
        releasePauseMenuFocus: (() => void) | null;
    };
    activeKeyboardButtons: Set<string>;
    toggleDayNightBtn: HTMLElement | null;
    dragOverlay: HTMLElement | null;
    dragCounter: number;
}
