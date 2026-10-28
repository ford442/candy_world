import { toggleBuildMode } from '../../../systems/build-mode-lazy.ts';
import { discoverySystem } from '../../../systems/discovery-optimized.ts';
import {
    getPhotoMode,
    isPhotoModeActive,
    togglePhotoMode,
} from '../../../systems/photo-mode/lazy.ts';
import { trapFocusInside } from '../../../utils/focus-trap.ts';
import { yieldToPaint } from '../../../utils/yield-to-paint.ts';
import { isExploreActive } from '../../camera-modes.ts';
import { sceneRef } from '../../game-loop-core.ts';
import { input } from '../actions/index.ts';
import type { ActionId } from '../actions/index.ts';
import { handleMuteKey, handleVolumeKey } from '../audio-controls.ts';
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

export function createKeyboardHandlers(session: InputSession): InputKeyboardHandlers {
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

        const isPlaylistOpen = getIsPlaylistOpen();

        // The open build gizmo takes Escape as "done" (an action), not as "pause".
        if (event.code === 'Escape' && !input.isContextActive('gizmo')) {
            if (isPlaylistOpen) {
                event.preventDefault();
                const closePlaylistBtn = document.getElementById('closePlaylistBtn');
                if (closePlaylistBtn) {
                    closePlaylistBtn.classList.add('keyboard-active');
                    // ♿ Aria: Removed setTimeout; state cleared on keyup to accurately mirror tactile hold
                }
                togglePlaylist();
                return;
            } else if (session.shouldPreventMenuOnUnlock && session.shouldPreventMenuOnUnlock()) {
                if (session.instructions) {
                    session.instructions.style.display = 'flex';
                    session.instructions.style.opacity = '0';
                    session.instructions.style.backdropFilter = 'blur(0px)';
                    session.instructions.style.transition =
                        'opacity 0.2s ease, backdrop-filter 0.2s ease';

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

                    void yieldToPaint(50).then(() => {
                        if (session.instructions && session.instructions.style.display !== 'none') {
                            session.focus.releasePauseMenuFocus = trapFocusInside(
                                session.instructions,
                                { skipAutoFocus: true, onEscape: () => session.controls.lock() }
                            );
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
            if (
                !isPlaylistOpen &&
                session.instructions &&
                session.instructions.style.display !== 'none'
            ) {
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

        if (
            !isPlaylistOpen &&
            session.instructions &&
            session.instructions.style.display !== 'none'
        ) {
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

        handlePlaylistKeyDown(event);
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
    };

    const onMouseDown = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return;
        session.exploreCamera.onHybridMouseDown(event.button);
        if (isExploreActive() && event.button === 0 && !isInteractiveTarget(event.target)) {
            disableExploreMode(session, true);
            return;
        }
    };

    const onMouseUp = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return;
        session.exploreCamera.onHybridMouseUp(event.button);
    };

    return { onKeyDown, onKeyUp, onMouseDown, onMouseUp };
}

/**
 * World and HUD toggles, as actions (#2027). Each mirrors the old keydown:
 * the HUD button lights while held, and the toggle runs once per press.
 * Returns the unsubscribe function.
 */
export function bindGameActions(session: InputSession, buttons: ButtonPressHandlers): () => void {
    const { triggerButtonPressDown, triggerButtonPressUp } = buttons;
    // Dev explore orbit pauses play (hybrid explore still pans with WASD).
    const paused = () => isExploreActive() && !session.exploreCamera.isHybrid();
    const offs: (() => void)[] = [];

    /** Press runs `fn` with `buttonId` lit until release. */
    const hudButton = (action: ActionId, buttonId: string, fn: () => void) =>
        offs.push(
            input.onAction(action, (s) => {
                if (s.justReleased) triggerButtonPressUp(buttonId);
                else if (s.justPressed && !paused()) {
                    triggerButtonPressDown(buttonId);
                    fn();
                }
            })
        );

    hudButton('jukebox', 'openJukeboxBtn', () => {
        if (!getIsPlaylistOpen()) togglePlaylist();
    });
    hudButton('daynight', 'toggleDayNight', () => session.toggleDayNightCallback?.());
    hudButton('mute', 'toggleMuteBtn', handleMuteKey);
    hudButton('music.upload', 'musicUploadBtn', () => {
        (document.getElementById('musicUpload') as HTMLInputElement | null)?.click();
    });
    hudButton('volume.up', 'volUpBtn', () => handleVolumeKey(0.1));
    hudButton('volume.down', 'volDownBtn', () => handleVolumeKey(-0.1));
    hudButton('photo.toggle', 'openPhotoBtn', togglePhotoMode);

    const photoBtn = document.getElementById('openPhotoBtn');
    const onPhotoClick = (e: Event) => {
        e.stopPropagation();
        if (!paused()) togglePhotoMode();
    };
    photoBtn?.addEventListener('click', onPhotoClick);
    offs.push(() => photoBtn?.removeEventListener('click', onPhotoClick));

    offs.push(
        input.onPress('build.toggle', () => {
            if (!paused() && sceneRef) toggleBuildMode(sceneRef);
        }),
        input.onPress('log', () => {
            if (paused()) return;
            if (document.pointerLockElement) session.controls.unlock();
            discoverySystem.showLog();
        })
    );

    return () => offs.forEach((off) => off());
}
