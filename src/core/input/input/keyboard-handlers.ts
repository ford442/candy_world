import { discoverySystem } from '../../../systems/discovery.ts';
import { getPhotoMode, isPhotoModeActive, togglePhotoMode } from '../../../systems/photo-mode/lazy.ts';
import { trapFocusInside } from '../../../utils/interaction-utils.ts';
import { yieldToPaint } from '../../../utils/yield-to-paint.ts';
import { isExploreActive } from '../../camera-modes.ts';
import { handleMuteKey, handleVolumeKey } from '../audio-controls.ts';
import { keyStates } from '../input-types.ts';
import {
    getIsPlaylistOpen,
    togglePlaylist,
    handlePlaylistKeyDown,
    handlePlaylistKeyUp,
} from '../playlist-manager.ts';
import type { ButtonPressHandlers } from './button-press.ts';
import {
    disableExploreMode,
    enableExploreMode,
    isInteractiveTarget,
    setStartButtonResumeLabel,
} from './menu-helpers.ts';
import type { InputSession } from './session.ts';

export interface InputKeyboardHandlers {
    onKeyDown: (event: KeyboardEvent) => void;
    onKeyUp: (event: KeyboardEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onMouseUp: (event: MouseEvent) => void;
}

function isGameFocused(session: InputSession): boolean {
    const activeEl = document.activeElement;
    const canvas = session.canvas ?? document.getElementById('glCanvas');
    return activeEl === document.body || activeEl === canvas;
}

export function createKeyboardHandlers(
    session: InputSession,
    buttons: ButtonPressHandlers
): InputKeyboardHandlers {
    const { triggerButtonPressDown, triggerButtonPressUp } = buttons;

    const onKeyDown = function (event: KeyboardEvent) {
        if (getPhotoMode()?.handleKeyDown(event)) {
            return;
        }

        if (isPhotoModeActive()) {
            if (event.code === 'Escape' || event.code === 'Enter') {
                return;
            }
            if (!event.altKey && event.code !== 'Tab') {
                return;
            }
        }

        if (
            event.code === 'KeyP' &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.metaKey &&
            !getIsPlaylistOpen() &&
            session.instructions &&
            session.instructions.style.display === 'none'
        ) {
            event.preventDefault();
            togglePhotoMode();
            return;
        }

        if (session.isDevBuild && event.ctrlKey && event.shiftKey && event.code === 'KeyO') {
            event.preventDefault();
            if (isExploreActive()) {
                disableExploreMode(session, true);
            } else {
                void enableExploreMode(session, { fromToggle: true });
            }
            return;
        }

        if (event.code === 'Tab') {
            if (isGameFocused(session)) {
                event.preventDefault();
                session.exploreCamera.onTabDown();
            }
            return; // inside modals: don't preventDefault — trapFocusInside handles Tab
        }

        if (isExploreActive()) {
            if (event.code === 'Escape') {
                event.preventDefault();
                disableExploreMode(session, true);
                return;
            }
            if (event.code === 'Enter') {
                event.preventDefault();
                disableExploreMode(session, true);
                return;
            }
            if (session.exploreCamera.isHybrid()) {
                // Hybrid pan handled via movement keys below when explore active
            } else {
                return;
            }
        }

        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }

        const isPlaylistOpen = getIsPlaylistOpen();

        if (event.code === 'Escape') {
            if (isPlaylistOpen) {
                event.preventDefault();
                const closePlaylistBtn = document.getElementById('closePlaylistBtn');
                if (closePlaylistBtn) {
                    closePlaylistBtn.classList.add('keyboard-active');
                    setTimeout(() => closePlaylistBtn.classList.remove('keyboard-active'), 150);
                }
                togglePlaylist();
                return;
            } else if (session.shouldPreventMenuOnUnlock && session.shouldPreventMenuOnUnlock()) {
                if (session.instructions) {
                    session.focus.lastFocusedElement = document.activeElement as HTMLElement;
                    session.instructions.style.display = 'flex';
                    session.instructions.style.opacity = '0';
                    session.instructions.style.backdropFilter = 'blur(0px)';
                    session.instructions.style.transition = 'opacity 0.2s ease, backdrop-filter 0.2s ease';

                    const content = session.instructions.querySelector(
                        '.instructions-content'
                    ) as HTMLElement;
                    if (content) {
                        content.style.transform = 'scale(0.95)';
                        content.style.transition =
                            'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    }

                    void session.instructions.offsetWidth;

                    requestAnimationFrame(() => {
                        if (session.instructions) {
                            session.instructions.style.opacity = '1';
                            session.instructions.style.backdropFilter = 'blur(10px)';
                        }
                        if (content) {
                            content.style.transform = 'scale(1)';
                        }
                    });

                    yieldToPaint(50).then(() => {
                        if (session.instructions && session.instructions.style.display !== 'none') {
                            session.focus.releasePauseMenuFocus = trapFocusInside(session.instructions);
                            if (session.startButton) {
                                session.startButton.focus({ preventScroll: true });
                            }
                        }
                    });
                }
                if (session.startButton) {
                    setStartButtonResumeLabel(session);
                }
                return;
            }

            if (session.instructions && session.instructions.style.display !== 'none') {
                session.controls.lock();
                return;
            }
        }

        if (event.code === 'Enter') {
            if (!isPlaylistOpen && session.instructions && session.instructions.style.display !== 'none') {
                if (
                    session.startButton &&
                    !session.startButton.disabled &&
                    document.activeElement !== session.startButton
                ) {
                    session.startButton.click();
                    event.preventDefault();
                }
            }
        }

        if (!isPlaylistOpen && session.instructions && session.instructions.style.display !== 'none') {
            const keyChar = event.key.toUpperCase();
            const code = event.code;
            const keys = session.instructions.querySelectorAll('kbd.key');

            keys.forEach((k) => {
                const text = (k as HTMLElement).innerText.toUpperCase();
                let match = false;
                if (text === keyChar) match = true;
                if (text === 'SPACE' && code === 'Space') match = true;
                if (text === 'SHIFT' && (code === 'ShiftLeft' || code === 'ShiftRight'))
                    match = true;
                if (text === 'CTRL' && (code === 'ControlLeft' || code === 'ControlRight'))
                    match = true;
                if (text === '+' && (code === 'Equal' || code === 'NumpadAdd')) match = true;
                if (text === '-' && (code === 'Minus' || code === 'NumpadSubtract')) match = true;

                if (match) {
                    k.classList.add('key-highlight');
                }
            });
        }

        if (handlePlaylistKeyDown(event)) {
            return;
        }

        switch (event.code) {
            case 'KeyL':
                if (document.pointerLockElement) {
                    session.controls.unlock();
                }
                discoverySystem.showLog();
                break;
            case 'KeyQ':
                if (getIsPlaylistOpen()) return;
                if (event.repeat) return;
                triggerButtonPressDown('openJukeboxBtn');
                togglePlaylist();
                break;
            case 'KeyW':
                if (isExploreActive() && !session.exploreCamera.isHybrid()) break;
                keyStates.forward = true;
                break;
            case 'KeyA':
                if (isExploreActive() && !session.exploreCamera.isHybrid()) break;
                keyStates.left = true;
                break;
            case 'KeyS':
                if (isExploreActive() && !session.exploreCamera.isHybrid()) break;
                keyStates.backward = true;
                break;
            case 'KeyD':
                if (isExploreActive() && !session.exploreCamera.isHybrid()) break;
                keyStates.right = true;
                break;
            case 'KeyF':
                if (isExploreActive()) break;
                keyStates.action = true;
                if (session.hudMine) session.hudMine.classList.add('keyboard-active');
                break;
            case 'KeyE':
            case 'e':
                if (isExploreActive()) break;
                keyStates.dash = true;
                if (session.hudDash) session.hudDash.classList.add('keyboard-active');
                break;
            case 'KeyX':
            case 'x':
                if (isExploreActive()) break;
                keyStates.dodgeRoll = true;
                break;
            case 'KeyZ':
            case 'z':
                if (isExploreActive()) break;
                keyStates.phase = true;
                if (session.hudPhase) session.hudPhase.classList.add('keyboard-active');
                break;
            case 'KeyC':
            case 'c':
                if (isExploreActive()) break;
                keyStates.clap = true;
                break;
            case 'KeyV':
            case 'v':
                if (isExploreActive()) break;
                keyStates.strike = true;
                break;
            case 'KeyR':
            case 'r':
                if (isExploreActive()) break;
                keyStates.dance = true;
                break;
            case 'Space':
                if (isExploreActive()) break;
                keyStates.jump = true;
                break;
            case 'KeyN':
                if (event.repeat) return;
                triggerButtonPressDown('toggleDayNight');
                if (session.toggleDayNightCallback) session.toggleDayNightCallback();
                break;
            case 'KeyM':
                if (event.repeat) return;
                triggerButtonPressDown('toggleMuteBtn');
                handleMuteKey();
                break;
            case 'KeyU': {
                if (event.repeat) return;
                triggerButtonPressDown('musicUploadBtn');
                const uploadInput = document.getElementById('musicUpload') as HTMLInputElement;
                if (uploadInput) uploadInput.click();
                break;
            }
            case 'Equal':
            case 'NumpadAdd':
                if (event.repeat) return;
                triggerButtonPressDown('volUpBtn');
                handleVolumeKey(0.1);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                if (event.repeat) return;
                triggerButtonPressDown('volDownBtn');
                handleVolumeKey(-0.1);
                break;
            case 'ControlLeft':
            case 'ControlRight':
                if (isExploreActive()) break;
                keyStates.sneak = true;
                event.preventDefault();
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                if (isExploreActive()) break;
                keyStates.sprint = true;
                break;
        }
    };

    const onKeyUp = function (event: KeyboardEvent) {
        if (event.code === 'Tab' && isGameFocused(session)) {
            session.exploreCamera.onTabUp();
            return;
        }

        handlePlaylistKeyUp(event);

        if (isExploreActive()) return;
        if (session.instructions && session.instructions.style.display !== 'none') {
            const keyChar = event.key.toUpperCase();
            const code = event.code;
            const keys = session.instructions.querySelectorAll('kbd.key');

            keys.forEach((k) => {
                const text = (k as HTMLElement).innerText.toUpperCase();
                let match = false;
                if (text === keyChar) match = true;
                if (text === 'SPACE' && code === 'Space') match = true;
                if (text === 'SHIFT' && (code === 'ShiftLeft' || code === 'ShiftRight'))
                    match = true;
                if (text === 'CTRL' && (code === 'ControlLeft' || code === 'ControlRight'))
                    match = true;
                if (text === '+' && (code === 'Equal' || code === 'NumpadAdd')) match = true;
                if (text === '-' && (code === 'Minus' || code === 'NumpadSubtract')) match = true;

                if (match) {
                    k.classList.remove('key-highlight');
                }
            });
        }

        switch (event.code) {
            case 'KeyW':
                keyStates.forward = false;
                break;
            case 'KeyA':
                keyStates.left = false;
                break;
            case 'KeyS':
                keyStates.backward = false;
                break;
            case 'KeyD':
                keyStates.right = false;
                break;
            case 'KeyF':
                keyStates.action = false;
                if (session.hudMine) session.hudMine.classList.remove('keyboard-active');
                break;
            case 'KeyE':
            case 'e':
                keyStates.dash = false;
                if (session.hudDash) session.hudDash.classList.remove('keyboard-active');
                break;
            case 'KeyX':
            case 'x':
                keyStates.dodgeRoll = false;
                break;
            case 'KeyZ':
            case 'z':
                keyStates.phase = false;
                if (session.hudPhase) session.hudPhase.classList.remove('keyboard-active');
                break;
            case 'KeyR':
            case 'r':
                keyStates.dance = false;
                break;
            case 'Space':
                keyStates.jump = false;
                break;
            case 'KeyC':
            case 'c':
                keyStates.clap = false;
                break;
            case 'KeyV':
            case 'v':
                keyStates.strike = false;
                break;
            case 'ControlLeft':
            case 'ControlRight':
                keyStates.sneak = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                keyStates.sprint = false;
                break;
            case 'KeyQ':
                triggerButtonPressUp('openJukeboxBtn');
                break;
            case 'KeyN':
                triggerButtonPressUp('toggleDayNight');
                break;
            case 'KeyM':
                triggerButtonPressUp('toggleMuteBtn');
                break;
            case 'KeyU':
                triggerButtonPressUp('musicUploadBtn');
                break;
            case 'Equal':
            case 'NumpadAdd':
                triggerButtonPressUp('volUpBtn');
                break;
            case 'Minus':
            case 'NumpadSubtract':
                triggerButtonPressUp('volDownBtn');
                break;
        }
    };

    const onMouseDown = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return;
        session.exploreCamera.onHybridMouseDown(event.button);
        if (isExploreActive() && event.button === 0 && !isInteractiveTarget(event.target)) {
            disableExploreMode(session, true);
            return;
        }
        if (event.button === 2) keyStates.forward = true;
    };

    const onMouseUp = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return;
        session.exploreCamera.onHybridMouseUp(event.button);
        if (event.button === 2) keyStates.forward = false;
    };

    return { onKeyDown, onKeyUp, onMouseDown, onMouseUp };
}
