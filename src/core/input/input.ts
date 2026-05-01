/**
 * Main Input Module
 * Handles pointer lock controls, keyboard/mouse input, ability HUD, and drag & drop
 * Coordinates with playlist-manager and audio-controls modules
 */

import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AudioSystem } from '../../audio/audio-system';
import * as THREE from 'three';
import { discoverySystem } from '../../systems/discovery.js';
import { trapFocusInside } from '../../utils/interaction-utils.ts';
import { openAccessibilityMenu } from '../../ui/accessibility-menu.ts';
import { keyStates, InitInputResult, filterValidMusicFiles } from './input-types.ts';
import {
    initPlaylistManager,
    getIsPlaylistOpen,
    setIsPlaylistOpen,
    closePlaylist,
    getReleaseJukeboxFocus,
    setReleaseJukeboxFocus,
    getWasPausedBeforePlaylist,
    togglePlaylist,
    handlePlaylistKeyDown,
    initLegacyMusicUpload
} from './playlist-manager.ts';
import {
    initAudioControls,
    handleMuteKey,
    handleVolumeKey
} from './audio-controls.ts';

export { keyStates } from './input-types.ts';
export type { KeyStates, InitInputResult } from './input-types.ts';

export function initInput(
    camera: THREE.Camera,
    audioSystem: AudioSystem,
    toggleDayNightCallback: (() => void) | null,
    shouldPreventMenuOnUnlock: (() => boolean) | null
): InitInputResult {
    const controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;

    // Ability HUD Elements
    const hudDash = document.getElementById('ability-dash');
    const hudMine = document.getElementById('ability-mine');
    const hudPhase = document.getElementById('ability-phase');

    // Modal Focus Trap Cleanups
    let releasePauseMenuFocus: (() => void) | null = null;
    let lastFocusedElement: HTMLElement | null = null;

    // --- NEW: Visual Reticle (Crosshair) ---
    // Check if it exists; if not, create it
    if (!document.getElementById('game-reticle')) {
        const reticle = document.createElement('div');
        reticle.id = 'game-reticle';
        document.body.appendChild(reticle);
    }

    // Function to animate reticle based on state using CSS classes
    function updateReticleState(state: 'idle' | 'hover' | 'interact', label?: string): void {
        const reticle = document.getElementById('game-reticle');
        if (!reticle) return;
        const reticleLabel = document.getElementById('reticle-label');

        // Reset classes
        reticle.classList.remove('hover', 'interact');

        // Apply new state
        if (state === 'hover') {
            reticle.classList.add('hover');
        } else if (state === 'interact') {
            reticle.classList.add('interact');
        }

        // Handle Label
        if (reticleLabel) {
            if (state === 'hover' && label) {
                reticleLabel.innerText = label;
                reticleLabel.classList.add('visible');
            } else if (state === 'idle') {
                reticleLabel.classList.remove('visible');
            }
            // Note: On 'interact', we keep the label visible if it was already there
        }
    }

    // Initialize sub-modules
    initPlaylistManager(audioSystem, controls, instructions);
    initAudioControls(audioSystem);
    initLegacyMusicUpload(audioSystem);

    // --- Pointer Lock & Menu Logic ---

    if (startButton) {
        startButton.addEventListener('click', () => {
            controls.lock();
        });
    }

    if (instructions) {
        instructions.addEventListener('click', (event: MouseEvent) => {
            if (event.target === instructions) {
                controls.lock();
            }
        });
    }

    controls.addEventListener('lock', () => {
        // UX: If generating the world, keep the "Generating..." message visible
        // The main.js logic will hide it when done.
        const currentStartButton = document.getElementById('startButton') as HTMLButtonElement | null;
        if (currentStartButton && currentStartButton.disabled) {
            return;
        }

        if (instructions) instructions.style.display = 'none';

        if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
            lastFocusedElement.focus();
            lastFocusedElement = null;
        }
        
        if (releasePauseMenuFocus) {
            releasePauseMenuFocus();
            releasePauseMenuFocus = null;
        }

        // If we locked, force playlist closed just in case
        setIsPlaylistOpen(false);
        const playlistOverlay = document.getElementById('playlist-overlay');
        const playlistBackdrop = document.getElementById('playlist-backdrop');
        if (playlistOverlay) playlistOverlay.style.display = 'none';
        if (playlistBackdrop) playlistBackdrop.style.display = 'none';

        const releaseJukebox = getReleaseJukeboxFocus();
        if (releaseJukebox) {
            releaseJukebox();
            setReleaseJukeboxFocus(null);
        }
    });

    controls.addEventListener('unlock', () => {
        // CRITICAL: Only show Main Menu if Playlist ISN'T open.
        // If Playlist is open, we *want* to be unlocked, but seeing the Playlist, not the start screen.
        if (!getIsPlaylistOpen()) {
            // Check if external condition (like dancing) prevents showing the menu
            if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                return;
            }

            if (instructions) {
                lastFocusedElement = document.activeElement as HTMLElement;
                instructions.style.display = 'flex';
                releasePauseMenuFocus = trapFocusInside(instructions);
            }

            // UX: Update Title to "Paused" to give context
            const title = instructions ? instructions.querySelector('h1') : null;
            if (title) title.innerHTML = 'Game Paused <span aria-hidden="true">⏸️</span>';

            if (startButton) {
                startButton.innerHTML = 'Resume Exploration <span aria-hidden="true">🚀</span> <span class="key-badge" aria-hidden="true">Enter</span>';
                requestAnimationFrame(() => startButton.focus());
            }
        }
    });

    // Click to Resume behavior when menu is hidden but controls are unlocked (e.g. after dancing)
    const onBodyClick = () => {
        // Only trigger if:
        // 1. Controls are unlocked
        // 2. Playlist is closed
        // 3. Instructions (Pause Menu) are hidden
        // 4. We are NOT currently prevented from locking (i.e. not dancing)
        if (!controls.isLocked &&
            !getIsPlaylistOpen() &&
            instructions && instructions.style.display === 'none') {

            if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                // Still dancing/prevented? Do nothing, keep cursor free.
                return;
            }

            controls.lock();
        }
    };
    document.body.addEventListener('click', onBodyClick);

    // Key Handlers
    const onKeyDown = function (event: KeyboardEvent) {
        // Prevent default browser actions (like Ctrl+S)
        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }

        const isPlaylistOpen = getIsPlaylistOpen();

        // Escape: Special Handling to FORCE menu open if it was suppressed (e.g. by dancing)
        if (event.code === 'Escape') {
            if (isPlaylistOpen) {
                event.preventDefault();
                togglePlaylist();
                return;
            } else if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                // If we are dancing, the unlock event fired but menu was suppressed.
                // Pressing Escape again should manually bring up the menu.
                if (instructions) {
                lastFocusedElement = document.activeElement as HTMLElement;
                    instructions.style.display = 'flex';
                    releasePauseMenuFocus = trapFocusInside(instructions);
                }
                if (startButton) {
                    startButton.innerHTML = 'Resume Exploration <span aria-hidden="true">🚀</span> <span class="key-badge" aria-hidden="true">Enter</span>';
                    startButton.focus();
                }
                return;
            }

            // Resume if in pause menu
            if (instructions && instructions.style.display !== 'none') {
                controls.lock();
                return;
            }
        }

        // Enter: Resume/Start if menu is visible and button is active
        if (event.code === 'Enter') {
            if (!isPlaylistOpen && instructions && instructions.style.display !== 'none') {
                if (startButton && !startButton.disabled && document.activeElement !== startButton) {
                    startButton.click();
                    event.preventDefault();
                }
            }
        }

        // --- UX: Focus Trap for Main Menu (Pause Screen) ---
        if (!isPlaylistOpen && instructions && instructions.style.display !== 'none') {
            // 🎨 Palette: Interactive Key Hints
            // Highlight the visual key in the help menu when pressed
            const keyChar = event.key.toUpperCase();
            const code = event.code;
            const keys = instructions.querySelectorAll('kbd.key');

            keys.forEach(k => {
                const text = (k as HTMLElement).innerText.toUpperCase();
                // Match by text content or specific codes
                let match = false;
                if (text === keyChar) match = true;
                if (text === 'SPACE' && code === 'Space') match = true;
                if (text === 'SHIFT' && (code === 'ShiftLeft' || code === 'ShiftRight')) match = true;
                if (text === 'CTRL' && (code === 'ControlLeft' || code === 'ControlRight')) match = true;
                if (text === '+' && (code === 'Equal' || code === 'NumpadAdd')) match = true;
                if (text === '-' && (code === 'Minus' || code === 'NumpadSubtract')) match = true;

                if (match) {
                    k.classList.add('key-highlight');
                }
            });

            if (event.code === 'Tab') {
                const focusable = instructions.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
                if (focusable.length > 0) {
                    const first = focusable[0] as HTMLElement;
                    const last = focusable[focusable.length - 1] as HTMLElement;

                    if (event.shiftKey) {
                        if (document.activeElement === first) {
                            last.focus();
                            event.preventDefault();
                        }
                    } else {
                        if (document.activeElement === last) {
                            first.focus();
                            event.preventDefault();
                        }
                    }
                }
                // Allow Tab to work normally inside the trap
                return;
            }
        }

        // --- UX: Focus Trap & Control Lock when Playlist is open ---
        if (handlePlaylistKeyDown(event)) {
            return;
        }
        // --------------------------------------------------------

        switch (event.code) {
            case 'KeyL':
                if (document.pointerLockElement) {
                    controls.unlock();
                }
                discoverySystem.showLog();
                break;
            case 'KeyQ':
                togglePlaylist();
                break;
            case 'KeyW': keyStates.forward = true; break;
            case 'KeyA': keyStates.left = true; break;
            case 'KeyS': keyStates.backward = true; break;
            case 'KeyD': keyStates.right = true; break;
            case 'KeyF':
                keyStates.action = true;
                if (hudMine) hudMine.classList.add('pressed');
                break; // Jitter Mine Ability
            case 'KeyE':
            case 'e':
                keyStates.dash = true;
                if (hudDash) hudDash.classList.add('pressed');
                break; // Dash Ability
            case 'KeyX':
            case 'x':
                keyStates.dodgeRoll = true;
                break; // Dodge Roll Ability
            case 'KeyZ':
            case 'z':
                keyStates.phase = true;
                if (hudPhase) hudPhase.classList.add('pressed');
                break; // Phase Shift Ability
            case 'KeyC':
            case 'c':
                keyStates.clap = true;
                break; // Sonic Clap Ability
            case 'KeyV':
            case 'v':
                keyStates.strike = true;
                break; // Chord Strike Ability
            case 'KeyR':
            case 'r':
                keyStates.dance = true;
                break; // Dance Ability
            case 'Space': keyStates.jump = true; break;
            case 'KeyN': if(toggleDayNightCallback) toggleDayNightCallback(); break;
            case 'KeyM': handleMuteKey(); break;
            case 'KeyU':
                const uploadInput = document.getElementById('musicUpload') as HTMLInputElement;
                if (uploadInput) uploadInput.click();
                break;
            case 'Equal':
            case 'NumpadAdd':
                handleVolumeKey(0.1);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                handleVolumeKey(-0.1);
                break;
            case 'ControlLeft':
            case 'ControlRight':
                keyStates.sneak = true;
                event.preventDefault();
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                keyStates.sprint = true;
                break;
        }
    };

    const onKeyUp = function (event: KeyboardEvent) {
        // 🎨 Palette: Remove Key Hints
        if (instructions && instructions.style.display !== 'none') {
            const keyChar = event.key.toUpperCase();
            const code = event.code;
            const keys = instructions.querySelectorAll('kbd.key');

            keys.forEach(k => {
                const text = (k as HTMLElement).innerText.toUpperCase();
                let match = false;
                if (text === keyChar) match = true;
                if (text === 'SPACE' && code === 'Space') match = true;
                if (text === 'SHIFT' && (code === 'ShiftLeft' || code === 'ShiftRight')) match = true;
                if (text === 'CTRL' && (code === 'ControlLeft' || code === 'ControlRight')) match = true;
                if (text === '+' && (code === 'Equal' || code === 'NumpadAdd')) match = true;
                if (text === '-' && (code === 'Minus' || code === 'NumpadSubtract')) match = true;

                if (match) {
                    k.classList.remove('key-highlight');
                }
            });
        }

        switch (event.code) {
            case 'KeyW': keyStates.forward = false; break;
            case 'KeyA': keyStates.left = false; break;
            case 'KeyS': keyStates.backward = false; break;
            case 'KeyD': keyStates.right = false; break;
            case 'KeyF':
                keyStates.action = false;
                if (hudMine) hudMine.classList.remove('pressed');
                break;
            case 'KeyE':
            case 'e':
                keyStates.dash = false;
                if (hudDash) hudDash.classList.remove('pressed');
                break;
            case 'KeyX':
            case 'x':
                keyStates.dodgeRoll = false;
                break;
            case 'KeyZ':
            case 'z':
                keyStates.phase = false;
                if (hudPhase) hudPhase.classList.remove('pressed');
                break;
            case 'KeyR':
            case 'r':
                keyStates.dance = false;
                break;
            case 'Space': keyStates.jump = false; break;
            case 'KeyC':
            case 'c': keyStates.clap = false; break;
            case 'KeyV':
            case 'v': keyStates.strike = false; break;
            case 'ControlLeft':
            case 'ControlRight': keyStates.sneak = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': keyStates.sprint = false; break;
        }
    };

    // Standard Mouse State (Right click to move)
    const onMouseDown = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = true;
    };

    const onMouseUp = function (event: MouseEvent) {
        if (getIsPlaylistOpen()) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = false;
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    const toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (toggleDayNightBtn && toggleDayNightCallback) {
        toggleDayNightBtn.addEventListener('click', toggleDayNightCallback);
    }

    // --- D-Pad Direction Controls ---
    type DpadDirection = 'forward' | 'backward' | 'left' | 'right';

    const dpadMap: Record<string, DpadDirection> = {
        'dpad-forward':  'forward',
        'dpad-backward': 'backward',
        'dpad-left':     'left',
        'dpad-right':    'right',
    };

    // Track which D-pad directions are currently held via pointer
    const dpadHeld = new Set<DpadDirection>();

    const dpadPress = (dir: DpadDirection, btn: HTMLElement) => {
        dpadHeld.add(dir);
        keyStates[dir] = true;
        btn.classList.add('dpad-pressed');
    };

    const dpadRelease = (dir: DpadDirection, btn: HTMLElement) => {
        dpadHeld.delete(dir);
        keyStates[dir] = false;
        btn.classList.remove('dpad-pressed');
    };

    for (const [id, dir] of Object.entries(dpadMap)) {
        const btn = document.getElementById(id) as HTMLElement | null;
        if (!btn) continue;

        btn.addEventListener('pointerdown', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            btn.setPointerCapture(e.pointerId);
            dpadPress(dir, btn);
        });

        btn.addEventListener('pointerup', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(dir, btn);
        });

        btn.addEventListener('pointercancel', (e: PointerEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dpadRelease(dir, btn);
        });

        // Prevent context menu on long-press (mobile)
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Safety: release all D-pad directions if window loses focus
    const releaseDpadAll = () => {
        for (const [id, dir] of Object.entries(dpadMap)) {
            const btn = document.getElementById(id) as HTMLElement | null;
            if (btn) dpadRelease(dir, btn);
        }
    };
    window.addEventListener('blur', releaseDpadAll);

    // --- UX: Interactive Ability HUD ---
    // (Variables moved to top of initInput)

    // Helper to simulate key press for abilities
    const triggerAbility = (ability: 'dash' | 'action' | 'phase') => {
        keyStates[ability] = true;
        setTimeout(() => {
            keyStates[ability] = false;
        }, 100);
    };

    if (hudDash) {
        hudDash.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hudDash.getAttribute('aria-disabled') !== 'true') {
                triggerAbility('dash');
            }
        });
        // Add keyboard activation for accessibility (Enter/Space)
        hudDash.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                if (hudDash.getAttribute('aria-disabled') !== 'true') {
                    triggerAbility('dash');
                }
            }
        });
    }

    if (hudMine) {
        hudMine.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hudMine.getAttribute('aria-disabled') !== 'true') {
                triggerAbility('action'); // 'action' corresponds to Jitter Mine (KeyF)
            }
        });
        hudMine.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                if (hudMine.getAttribute('aria-disabled') !== 'true') {
                    triggerAbility('action');
                }
            }
        });
    }

    if (hudPhase) {
        hudPhase.addEventListener('click', (e) => {
            e.stopPropagation();
            if (hudPhase.getAttribute('aria-disabled') !== 'true') {
                triggerAbility('phase');
            }
        });
        hudPhase.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                if (hudPhase.getAttribute('aria-disabled') !== 'true') {
                    triggerAbility('phase');
                }
            }
        });
    }

    const openA11yBtn = document.getElementById('openA11yBtn');
    if (openA11yBtn) {
        openA11yBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openAccessibilityMenu();
        });
    }

    // --- UX: Drag & Drop Support ---
    const dragOverlay = document.getElementById('drag-overlay');
    let dragCounter = 0;

    const onDragEnter = (e: DragEvent) => {
        e.preventDefault();
        dragCounter++;
        if (dragOverlay) {
            dragOverlay.classList.add('active');
            dragOverlay.setAttribute('aria-hidden', 'false');
        }
    };

    const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (dragOverlay) {
                dragOverlay.classList.remove('active');
                dragOverlay.setAttribute('aria-hidden', 'true');
            }
        }
    };

    const onDragOver = (e: DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };

    const onDrop = (e: DragEvent) => {
        e.preventDefault();
        dragCounter = 0;
        if (dragOverlay) {
            dragOverlay.classList.remove('active');
            dragOverlay.setAttribute('aria-hidden', 'true');
        }

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            // Use the filter function from input-types
            const { validFiles, invalidFiles } = filterValidMusicFiles(files);

                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);

                    // Show feedback via Toast
                    import('../../utils/toast.js').then(({ showToast }) => {
                        if (invalidFiles.length > 0) {
                            showToast(`Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`, '⚠️');
                        } else {
                            showToast(`Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`, '📂');
                        }
                    });
                } else {
                    // All files were invalid
                    import('../../utils/toast.js').then(({ showToast }) => {
                        showToast("❌ Only .mod, .xm, .it, .s3m allowed!", '🚫');
                    });
                }
            // End filter
        }
    };

    if (dragOverlay) {
        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('drop', onDrop);
    }

    return {
        controls,
        updateReticleState,
        cleanup: () => {
            document.body.removeEventListener('click', onBodyClick);
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('keyup', onKeyUp);
            document.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mouseup', onMouseUp);
            window.removeEventListener('blur', releaseDpadAll);

            if (dragOverlay) {
                window.removeEventListener('dragenter', onDragEnter);
                window.removeEventListener('dragleave', onDragLeave);
                window.removeEventListener('dragover', onDragOver);
                window.removeEventListener('drop', onDrop);
            }
        },
        updateDayNightButtonState: (isPressed: boolean) => {
            if (toggleDayNightBtn) {
                toggleDayNightBtn.setAttribute('aria-pressed', String(isPressed));
                toggleDayNightBtn.setAttribute('aria-label', isPressed ? 'Switch to Day' : 'Switch to Night');
                toggleDayNightBtn.title = isPressed ? 'Switch to Day (N)' : 'Switch to Night (N)';
                // UX: Update button text to show available action
                toggleDayNightBtn.innerHTML = isPressed
                    ? '<span aria-hidden="true">☀️</span> Switch to Day <span class="key-badge" aria-hidden="true">N</span>'
                    : '<span aria-hidden="true">🌙</span> Switch to Night <span class="key-badge" aria-hidden="true">N</span>';

                import('../../utils/toast.js').then(({ showToast }) => {
                    const mode = isPressed ? "Night Mode Active 🌙" : "Day Mode Active ☀️";
                    showToast(mode, isPressed ? '🌙' : '☀️');
                });
            }
        }
    };
}
