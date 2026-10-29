/**
 * Input initialization orchestrator — wires sub-modules into initInput().
 */

import type * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import type { AudioSystem } from '../../../audio/audio-system';
import { announce } from '../../../ui/announcer.ts';
import { showToast } from '../../../utils/toast.ts';
import { resolveExploreVariant } from '../../camera-modes.ts';
import { bindInputFrame, type LookTarget } from '../actions/frame.ts';
import { input } from '../actions/index.ts';
import { attachKeyboardMouse } from '../actions/keyboard-mouse.ts';
import { initAudioControls } from '../audio-controls.ts';
import type { InitInputResult } from '../input-types.ts';
import {
    getIsPlaylistOpen,
    initPlaylistManager,
    initLegacyMusicUpload,
} from '../playlist-manager.ts';
import { createButtonPressHandlers } from './button-press.ts';
import { setupDragDrop } from './drag-drop.ts';
import { setupExploreToggle } from './explore-toggle.ts';
import { setupHudControls } from './hud-setup.ts';
import { bindGameActions, createKeyboardHandlers } from './keyboard-handlers.ts';
import { initExploreCameraForSession } from './menu-helpers.ts';
import { setupPointerLock } from './pointer-lock.ts';
import { ensureGameReticle, createUpdateReticleState } from './reticle.ts';
import type { InputSession } from './session.ts';

export function initInput(
    camera: THREE.Camera,
    audioSystem: AudioSystem,
    toggleDayNightCallback: (() => void) | null,
    shouldPreventMenuOnUnlock: (() => boolean) | null
): InitInputResult {
    const controls = new PointerLockControls(camera, document.body);

    const session: InputSession = {
        controls,
        camera,
        audioSystem,
        instructions: document.getElementById('instructions'),
        startButton: document.getElementById('startButton') as HTMLButtonElement | null,
        canvas: document.getElementById('glCanvas') as HTMLCanvasElement | null,
        isDevBuild: import.meta.env?.DEV || false,
        hudDash: document.getElementById('ability-dash'),
        hudMine: document.getElementById('ability-mine'),
        hudPhase: document.getElementById('ability-phase'),
        toggleDayNightCallback,
        shouldPreventMenuOnUnlock,
        exploreVariant: resolveExploreVariant(),
        exploreCamera: null!,
        focus: {
            lastFocusedElement: null,
            releasePauseMenuFocus: null,
        },
        activeKeyboardButtons: new Set<string>(),
        toggleDayNightBtn: null,
        dragOverlay: null,
        dragCounter: 0,
    };

    initExploreCameraForSession(session);

    ensureGameReticle();
    const updateReticleState = createUpdateReticleState();

    (window as Window & { __inputSession?: InputSession }).__inputSession = session;

    initPlaylistManager(audioSystem, controls, session.instructions);
    initAudioControls(audioSystem);
    initLegacyMusicUpload(audioSystem);

    const onBodyClick = setupPointerLock(session);

    const buttonHandlers = createButtonPressHandlers(session);
    const keyboardHandlers = createKeyboardHandlers(session, buttonHandlers);
    const unbindGameActions = bindGameActions(session, buttonHandlers);
    const detachKeyboardMouse = attachKeyboardMouse(input);
    const unbindFrame = bindInputFrame({
        look: takeOverMouseLook(controls),
        isMenuOpen: () =>
            getIsPlaylistOpen() ||
            (!!session.instructions && session.instructions.style.display !== 'none'),
        isExploreHybrid: () => session.exploreCamera.isHybrid(),
        hud: {
            forward: document.getElementById('dpad-forward'),
            backward: document.getElementById('dpad-backward'),
            left: document.getElementById('dpad-left'),
            right: document.getElementById('dpad-right'),
            dash: session.hudDash,
            mine: session.hudMine,
            phase: session.hudPhase,
        },
    });

    document.addEventListener('keydown', keyboardHandlers.onKeyDown);
    document.addEventListener('keyup', keyboardHandlers.onKeyUp);
    document.addEventListener('mousedown', keyboardHandlers.onMouseDown);
    document.addEventListener('mouseup', keyboardHandlers.onMouseUp);

    const releaseDpadAll = setupHudControls(session);
    const dragDropHandlers = setupDragDrop(session);
    setupExploreToggle(session);

    return {
        controls,
        updateReticleState,
        cleanup: () => {
            session.exploreCamera.dispose();
            unbindGameActions();
            detachKeyboardMouse();
            unbindFrame();
            document.body.removeEventListener('click', onBodyClick);
            document.removeEventListener('keydown', keyboardHandlers.onKeyDown);
            document.removeEventListener('keyup', keyboardHandlers.onKeyUp);
            document.removeEventListener('mousedown', keyboardHandlers.onMouseDown);
            document.removeEventListener('mouseup', keyboardHandlers.onMouseUp);
            window.removeEventListener('blur', releaseDpadAll);
            releaseDpadAll();

            if (dragDropHandlers) {
                window.removeEventListener('dragenter', dragDropHandlers.onDragEnter);
                window.removeEventListener('dragleave', dragDropHandlers.onDragLeave);
                window.removeEventListener('dragover', dragDropHandlers.onDragOver);
                window.removeEventListener('drop', dragDropHandlers.onDrop);
            }
        },
        updateDayNightButtonState: (isPressed: boolean) => {
            if (session.toggleDayNightBtn) {
                session.toggleDayNightBtn.setAttribute('aria-checked', String(isPressed));
                session.toggleDayNightBtn.title = isPressed ? 'Switch to Day (N)' : 'Switch to Night (N)';
                session.toggleDayNightBtn.innerHTML = isPressed
                    ? '<span aria-hidden="true">☀️</span> Switch to Day <span class="key-badge" aria-hidden="true">N</span>'
                    : '<span aria-hidden="true">🌙</span> Switch to Night <span class="key-badge" aria-hidden="true">N</span>';

                const mode = isPressed ? 'Night Mode Active 🌙' : 'Day Mode Active ☀️';
                showToast(mode, isPressed ? '🌙' : '☀️');
                announce(mode, 'polite');
            }
        },
    };
}

/**
 * Mouse look moves to the action layer's `look` (sensitivity, invert Y, and
 * later sticks and touch-drag): unhook PointerLockControls' own mousemove and
 * let the `input-actions` system turn the camera. If a three upgrade renames
 * the handler, three keeps doing the look and the settings don't apply.
 */
function takeOverMouseLook(controls: PointerLockControls): LookTarget | null {
    const own = (controls as unknown as { _onMouseMove?: EventListener })._onMouseMove;
    if (typeof own !== 'function') {
        console.warn('[input] PointerLockControls changed shape; mouse look stays with three');
        return null;
    }
    controls.domElement?.ownerDocument.removeEventListener('mousemove', own);
    return controls;
}
