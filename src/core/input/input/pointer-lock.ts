import { closeAccessibilityMenu } from '../../../ui/accessibility-menu-lazy.ts';
import { trapFocusInside } from '../../../utils/interaction-utils.ts';
import { yieldToPaint } from '../../../utils/yield-to-paint.ts';
import { isExploreActive } from '../../camera-modes.ts';
import {
    getIsPlaylistOpen,
    setIsPlaylistOpen,
    getReleaseJukeboxFocus,
    setReleaseJukeboxFocus,
} from '../playlist-manager.ts';
import {
    disableExploreMode,
    isInteractiveTarget,
    setPausedTitle,
    setStartButtonEnterLabel,
    setStartButtonResumeLabel,
} from './menu-helpers.ts';
import type { InputSession } from './session.ts';

export function setupPointerLock(session: InputSession): (event: MouseEvent) => void {
    if (session.startButton) {
        session.startButton.addEventListener('click', () => {
            session.controls.lock();
        });
    }

    if (session.instructions) {
        session.instructions.addEventListener('click', (event: MouseEvent) => {
            if (event.target === session.instructions) {
                session.controls.lock();
            }
        });

        if (session.startButton) {
            // ♿ Aria: Keyboard tactile feedback for start button
            session.startButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (e.repeat) return;
                    session.startButton!.classList.add('keyboard-active');
                }
            });

            const cleanupStartBtn = () => session.startButton!.classList.remove('keyboard-active');

            session.startButton.addEventListener('keyup', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    cleanupStartBtn();
                }
            });
            session.startButton.addEventListener('blur', cleanupStartBtn);
        }
    }

    session.controls.addEventListener('lock', () => {
        if (isExploreActive()) {
            disableExploreMode(session, false);
        }
        // UX: If generating the world, keep the "Generating..." message visible
        // The main.js logic will hide it when done.
        const currentStartButton = document.getElementById(
            'startButton'
        ) as HTMLButtonElement | null;
        if (currentStartButton && currentStartButton.disabled) {
            return;
        }

        if (session.focus.releasePauseMenuFocus) {
            session.focus.releasePauseMenuFocus();
            session.focus.releasePauseMenuFocus = null;
        }

        if (session.instructions) {
            session.instructions.style.opacity = '0';
            session.instructions.style.backdropFilter = 'blur(0px)';
            const content = session.instructions.querySelector('.instructions-content') as HTMLElement;
            if (content) {
                content.style.transform = 'scale(0.95)';
            }
            setTimeout(() => {
                if (session.instructions) session.instructions.style.display = 'none';
                if (session.focus.lastFocusedElement && typeof session.focus.lastFocusedElement.focus === 'function') {
                    session.focus.lastFocusedElement.focus({ preventScroll: true });
                    session.focus.lastFocusedElement = null;
                }
                setPausedTitle(session, false);
                setStartButtonEnterLabel(session);
            }, 200);
        } else {
            if (session.focus.lastFocusedElement && typeof session.focus.lastFocusedElement.focus === 'function') {
                session.focus.lastFocusedElement.focus({ preventScroll: true });
                session.focus.lastFocusedElement = null;
            }
        }

        // If we locked, force playlist closed just in case
        setIsPlaylistOpen(false);
        const playlistOverlay = document.getElementById('playlist-overlay');
        const playlistBackdrop = document.getElementById('playlist-backdrop');
        const openJukeboxBtn = document.getElementById('openJukeboxBtn');
        if (playlistOverlay) playlistOverlay.style.display = 'none';
        if (playlistBackdrop) playlistBackdrop.style.display = 'none';
        if (openJukeboxBtn) openJukeboxBtn.setAttribute('aria-expanded', 'false');

        const releaseJukebox = getReleaseJukeboxFocus();
        if (releaseJukebox) {
            releaseJukebox();
            setReleaseJukeboxFocus(null);
        }

        closeAccessibilityMenu();
    });

    session.controls.addEventListener('unlock', () => {
        if (isExploreActive()) return;
        // CRITICAL: Only show Main Menu if Playlist ISN'T open.
        // If Playlist is open, we *want* to be unlocked, but seeing the Playlist, not the start screen.
        if (!getIsPlaylistOpen()) {
            // Check if external condition (like dancing) prevents showing the menu
            if (session.shouldPreventMenuOnUnlock && session.shouldPreventMenuOnUnlock()) {
                return;
            }

            if (session.instructions) {
                session.focus.lastFocusedElement = document.activeElement as HTMLElement;
                session.instructions.style.display = 'flex';
                session.instructions.style.opacity = '0';
                session.instructions.style.backdropFilter = 'blur(0px)';
                session.instructions.style.transition = 'opacity 0.2s ease, backdrop-filter 0.2s ease';

                const content = session.instructions.querySelector('.instructions-content') as HTMLElement;
                if (content) {
                    content.style.transform = 'scale(0.95)';
                    content.style.transition =
                        'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                }

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

            // UX: Update Title to "Paused" to give context
            setPausedTitle(session, true);
            setStartButtonResumeLabel(session);
        }
    });

    // Click to Resume behavior when menu is hidden but controls are unlocked (e.g. after dancing)
    const onBodyClick = (event: MouseEvent) => {
        const target = event.target;
        if (
            !session.controls.isLocked &&
            !isExploreActive() &&
            !getIsPlaylistOpen() &&
            session.instructions &&
            session.instructions.style.display === 'none' &&
            !isInteractiveTarget(target) &&
            (target === session.canvas || target === document.body)
        ) {
            if (session.shouldPreventMenuOnUnlock && session.shouldPreventMenuOnUnlock()) {
                return;
            }

            session.controls.lock();
        }
    };
    document.body.addEventListener('click', onBodyClick);
    return onBodyClick;
}
