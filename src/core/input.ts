import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { AudioSystem } from '../audio/audio-system';
import * as THREE from 'three';

export interface KeyStates {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    jump: boolean;
    sneak: boolean;
    sprint: boolean;
    dash: boolean;
    dance: boolean;
    action: boolean;
    phase: boolean;
}

export const keyStates: KeyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false,
    dash: false,
    dance: false,
    action: false,
    phase: false
};

// Controls and Event Listeners
// Helper: Show temporary success feedback on upload buttons
const showUploadFeedback = (labelElement: HTMLElement | null, filesCount: number): void => {
    if (!labelElement) return;

    // Save original HTML if not already saved (Preserves formatting/spans)
    if (!labelElement.dataset.originalHtml) {
        labelElement.dataset.originalHtml = labelElement.innerHTML;
    }

    const originalHtml = labelElement.dataset.originalHtml;
    // We can use innerText for the temporary message, or innerHTML if we wanted icons/styles
    labelElement.innerText = `✅ ${filesCount} Song${filesCount > 1 ? 's' : ''} Added!`;

    setTimeout(() => {
        labelElement.innerHTML = originalHtml || '';
    }, 2000);
};

// Helper: Validate and filter files by extension
const filterValidMusicFiles = (files: FileList): { validFiles: File[]; invalidFiles: File[] } => {
    const validExtensions = ['.mod', '.xm', '.it', '.s3m'];
    const validFiles: File[] = [];
    const invalidFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const lowerName = file.name.toLowerCase();
        if (validExtensions.some(ext => lowerName.endsWith(ext))) {
            validFiles.push(file);
        } else {
            invalidFiles.push(file);
        }
    }
    return { validFiles, invalidFiles };
};

export interface InitInputResult {
    controls: PointerLockControls;
    updateReticleState: (state: 'idle' | 'hover' | 'interact', label?: string) => void;
    updateDayNightButtonState: (isPressed: boolean) => void;
}

export function initInput(
    camera: THREE.Camera,
    audioSystem: AudioSystem,
    toggleDayNightCallback: (() => void) | null,
    shouldPreventMenuOnUnlock: (() => boolean) | null
): InitInputResult {
    const controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    const startButton = document.getElementById('startButton') as HTMLButtonElement | null;
    
    // Playlist Elements
    const playlistOverlay = document.getElementById('playlist-overlay');
    const playlistBackdrop = document.getElementById('playlist-backdrop');
    const playlistList = document.getElementById('playlist-list');
    const closePlaylistBtn = document.getElementById('closePlaylistBtn');
    const playlistCloseX = document.getElementById('playlistCloseX');
    const playlistUploadInput = document.getElementById('playlistUploadInput') as HTMLInputElement | null;
    const openJukeboxBtn = document.getElementById('openJukeboxBtn');

    // Ability HUD Elements
    const hudDash = document.getElementById('ability-dash');
    const hudMine = document.getElementById('ability-mine');
    const hudPhase = document.getElementById('ability-phase');

    let isPlaylistOpen = false;
    let lastFocusedElement: Element | null = null; // Store focus before opening modal

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

    // --- Helper: Render Playlist ---
    function renderPlaylist(): void {
        if (!playlistList) return;
        playlistList.innerHTML = '';
        const songs = audioSystem.getPlaylist();
        const currentIdx = audioSystem.getCurrentIndex();

        songs.forEach((file: File, index: number) => {
            const li = document.createElement('li');
            li.className = `playlist-item ${index === currentIdx ? 'active' : ''}`;

            // UX: Use a button for keyboard accessibility
            const btn = document.createElement('button');
            btn.className = 'playlist-btn';
            btn.title = file.name; // Tooltip for full filename
            btn.setAttribute('aria-label', `Play ${file.name}`);
            if (index === currentIdx) {
                btn.setAttribute('aria-current', 'true');
            }

            btn.innerHTML = `
                <span class="song-title">${index + 1}. ${file.name}</span>
                <span class="status-icon" aria-hidden="true">${index === currentIdx ? '🔊' : '▶️'}</span>
            `;

            btn.onclick = (e) => {
                // Prevent bubbling if needed, though li has no click handler now
                e.stopPropagation();
                audioSystem.playAtIndex(index);
                renderPlaylist(); // Re-render to update active state

                // Keep focus on the clicked item (re-rendered)
                // We need to find the new button after render
                requestAnimationFrame(() => {
                    const newItems = playlistList.querySelectorAll('.playlist-btn');
                    if (newItems[index] && newItems[index] instanceof HTMLElement) {
                        (newItems[index] as HTMLElement).focus();
                    }
                });
            };

            li.appendChild(btn);
            playlistList.appendChild(li);
        });
        
        if (songs.length === 0) {
            // UX: Make Empty State Actionable
            const li = document.createElement('li');
            li.style.listStyle = 'none';
            li.style.padding = '20px 0';
            li.style.textAlign = 'center';

            const emptyBtn = document.createElement('button');
            emptyBtn.className = 'secondary-button'; // Reuse existing class for consistent look
            emptyBtn.style.fontSize = '1em'; // Make it slightly more prominent if needed
            emptyBtn.innerText = 'No songs... Click to Add! 🍭';
            emptyBtn.setAttribute('aria-label', 'Playlist empty. Click to upload music files.');

            emptyBtn.onclick = (e) => {
                e.stopPropagation();
                if (playlistUploadInput) playlistUploadInput.click();
            };

            li.appendChild(emptyBtn);
            playlistList.appendChild(li);
        }
    }

    // UX: Update Jukebox Button text with song count
    function updateJukeboxButtonState(count: number): void {
        if (!openJukeboxBtn) return;
        const countText = count > 0 ? ` (${count})` : '';
        openJukeboxBtn.innerHTML = `Open Jukebox${countText} <span class="key-badge">Q</span>`;
        openJukeboxBtn.setAttribute('aria-label', `Open Jukebox playlist${count > 0 ? `, ${count} songs` : ''}`);
    }

    // Initialize state
    if (audioSystem.getPlaylist) {
        updateJukeboxButtonState(audioSystem.getPlaylist().length);
    }

    // Hook up AudioSystem callbacks
    audioSystem.onPlaylistUpdate = (playlist: File[]) => {
        if (isPlaylistOpen) renderPlaylist();
        updateJukeboxButtonState(playlist ? playlist.length : 0);
    };

    // UX: Show toast and update playlist when track changes
    audioSystem.onTrackChange = (index: number) => {
        if (isPlaylistOpen) renderPlaylist();

        // Show "Now Playing" toast
        const songs = audioSystem.getPlaylist();
        if (songs && songs[index]) {
            import('../utils/toast.js').then(({ showToast }) => {
                showToast(`Now Playing: ${songs[index].name}`, '🎵');
            });
        }
    };

    // --- Input Logic ---

    let wasPausedBeforePlaylist = false;

    // Toggle Function
    function togglePlaylist(): void {
        isPlaylistOpen = !isPlaylistOpen;

        if (isPlaylistOpen) {
            // OPENING

            // 🎨 Palette: Smart Context Preservation
            // Check if we are opening from the Pause Menu (instructions visible)
            wasPausedBeforePlaylist = instructions ? (instructions.style.display !== 'none') : false;

            lastFocusedElement = document.activeElement;
            controls.unlock(); // Unlock mouse so we can click
            if (instructions) instructions.style.display = 'none'; // Ensure pause menu is hidden
            if (playlistOverlay) playlistOverlay.style.display = 'flex';
            if (playlistBackdrop) playlistBackdrop.style.display = 'block';
            renderPlaylist();
            // UX: Auto-focus the currently playing track for immediate context
            requestAnimationFrame(() => {
                const currentIdx = audioSystem.getCurrentIndex();
                if (!playlistList) return;
                const playlistBtns = playlistList.querySelectorAll('.playlist-btn');

                if (currentIdx >= 0 && playlistBtns[currentIdx]) {
                    const activeBtn = playlistBtns[currentIdx] as HTMLElement;
                    activeBtn.focus();
                    // Ensure the active song is visible in the scrollable list
                    activeBtn.scrollIntoView({ block: 'center', behavior: 'smooth' });
                } else if (closePlaylistBtn) {
                    closePlaylistBtn.focus();
                }
            });
        } else {
            // CLOSING
            if (playlistOverlay) playlistOverlay.style.display = 'none';
            if (playlistBackdrop) playlistBackdrop.style.display = 'none';

            // 🎨 Palette: Smart Context Restoration
            if (wasPausedBeforePlaylist) {
                // Return to Pause Menu
                if (instructions) instructions.style.display = 'flex';
                // Restore focus to the button that opened the jukebox (e.g. Open Jukebox button)
                if (lastFocusedElement && lastFocusedElement instanceof HTMLElement) {
                    lastFocusedElement.focus();
                }
                // Do NOT lock controls, stay unlocked
            } else {
                // Return to Game
                controls.lock(); // Re-lock mouse to play
            }
        }
    }

    // Event Listeners for UI
    if (closePlaylistBtn) {
        closePlaylistBtn.addEventListener('click', togglePlaylist);
    }

    if (playlistCloseX) {
        playlistCloseX.addEventListener('click', togglePlaylist);
    }

    if (playlistBackdrop) {
        playlistBackdrop.addEventListener('click', togglePlaylist);
    }

    if (playlistUploadInput) {
        playlistUploadInput.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLInputElement;
            const files = target.files;
            if (files && files.length > 0) {
                const { validFiles } = filterValidMusicFiles(files);
                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);
                    const label = document.querySelector('label[for="playlistUploadInput"]') as HTMLElement;
                    showUploadFeedback(label, validFiles.length);
                }
            }
        });
    }

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
        
        // If we locked, force playlist closed just in case
        isPlaylistOpen = false; 
        if (playlistOverlay) playlistOverlay.style.display = 'none';
        if (playlistBackdrop) playlistBackdrop.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        // CRITICAL: Only show Main Menu if Playlist ISN'T open.
        // If Playlist is open, we *want* to be unlocked, but seeing the Playlist, not the start screen.
        if (!isPlaylistOpen) {
            // Check if external condition (like dancing) prevents showing the menu
            if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                return;
            }

            if (instructions) instructions.style.display = 'flex';

            // UX: Update Title to "Paused" to give context
            const title = instructions ? instructions.querySelector('h1') : null;
            if (title) title.innerText = 'Game Paused ⏸️';

            if (startButton) {
                startButton.innerHTML = 'Resume Exploration 🚀 <span class="key-badge">Enter</span>';
                requestAnimationFrame(() => startButton.focus());
            }
        }
    });

    // Click to Resume behavior when menu is hidden but controls are unlocked (e.g. after dancing)
    document.body.addEventListener('click', () => {
        // Only trigger if:
        // 1. Controls are unlocked
        // 2. Playlist is closed
        // 3. Instructions (Pause Menu) are hidden
        // 4. We are NOT currently prevented from locking (i.e. not dancing)
        if (!controls.isLocked &&
            !isPlaylistOpen &&
            instructions && instructions.style.display === 'none') {

            if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                // Still dancing/prevented? Do nothing, keep cursor free.
                return;
            }

            controls.lock();
        }
    });

    // Key Handlers
    const onKeyDown = function (event: KeyboardEvent) {
        // Prevent default browser actions (like Ctrl+S)
        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }

        // Escape: Special Handling to FORCE menu open if it was suppressed (e.g. by dancing)
        if (event.code === 'Escape') {
            if (isPlaylistOpen) {
                event.preventDefault();
                togglePlaylist();
                return;
            } else if (shouldPreventMenuOnUnlock && shouldPreventMenuOnUnlock()) {
                // If we are dancing, the unlock event fired but menu was suppressed.
                // Pressing Escape again should manually bring up the menu.
                if (instructions) instructions.style.display = 'flex';
                if (startButton) {
                    startButton.innerHTML = 'Resume Exploration 🚀 <span class="key-badge">Enter</span>';
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
        if (isPlaylistOpen && playlistOverlay) {
            // Close on Q
            if (event.code === 'KeyQ') {
                event.preventDefault();
                togglePlaylist();
                return;
            }

            // UX: Arrow Key Navigation for Playlist
            if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
                const playlistBtns = Array.from(playlistOverlay.querySelectorAll('.playlist-btn')) as HTMLElement[];
                if (playlistBtns.length > 0) {
                    event.preventDefault(); // Prevent scrolling
                    const currentIndex = playlistBtns.indexOf(document.activeElement as HTMLElement);
                    let nextIndex;

                    if (event.code === 'ArrowDown') {
                        nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % playlistBtns.length;
                    } else {
                        nextIndex = currentIndex === -1 ? playlistBtns.length - 1 : (currentIndex - 1 + playlistBtns.length) % playlistBtns.length;
                    }
                    playlistBtns[nextIndex].focus();
                }
                return;
            }

            // Focus Trap Logic for Tab
            if (event.code === 'Tab') {
                const focusable = playlistOverlay.querySelectorAll('button, input, [href], select, textarea, [tabindex]:not([tabindex="-1"])');
                if (focusable.length === 0) return;

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
                return;
            }

            // Block game controls while in menu
            return;
        }
        // --------------------------------------------------------

        switch (event.code) {
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
                keyStates.dash = true;
                if (hudDash) hudDash.classList.add('pressed');
                break; // Dash Ability
            case 'KeyZ':
                keyStates.phase = true;
                if (hudPhase) hudPhase.classList.add('pressed');
                break; // Phase Shift Ability
            case 'KeyR': keyStates.dance = true; break; // Dance Ability
            case 'Space': keyStates.jump = true; break;
            case 'KeyN': if(toggleDayNightCallback) toggleDayNightCallback(); break;
            case 'KeyM': toggleMute(); break;
            case 'Equal':
            case 'NumpadAdd':
                adjustVolume(0.1);
                break;
            case 'Minus':
            case 'NumpadSubtract':
                adjustVolume(-0.1);
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
                keyStates.dash = false;
                if (hudDash) hudDash.classList.remove('pressed');
                break;
            case 'KeyZ':
                keyStates.phase = false;
                if (hudPhase) hudPhase.classList.remove('pressed');
                break;
            case 'KeyR': keyStates.dance = false; break;
            case 'Space': keyStates.jump = false; break;
            case 'ControlLeft':
            case 'ControlRight': keyStates.sneak = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': keyStates.sprint = false; break;
        }
    };

    // Standard Mouse State (Right click to move)
    const onMouseDown = function (event: MouseEvent) {
        if (isPlaylistOpen) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = true;
    };

    const onMouseUp = function (event: MouseEvent) {
        if (isPlaylistOpen) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = false;
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    // Existing Music Upload Handler (Main Menu) - Kept for compatibility
    const musicUpload = document.getElementById('musicUpload') as HTMLInputElement | null;
    if (musicUpload) {
        musicUpload.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            const files = target.files;
            if (files && files.length > 0) {
                const { validFiles, invalidFiles } = filterValidMusicFiles(files);

                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);
                    const label = document.querySelector('label[for="musicUpload"]') as HTMLElement | null;
                    showUploadFeedback(label, validFiles.length);

                    if (invalidFiles.length > 0) {
                        import('../utils/toast.js').then(({ showToast }) => {
                            showToast(`Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`, '⚠️');
                        });
                    }
                } else {
                     // All files were invalid
                    import('../utils/toast.js').then(({ showToast }) => {
                        showToast("❌ Only .mod, .xm, .it, .s3m allowed!", '🚫');
                    });
                }
            }
        });
    }

    const toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (toggleDayNightBtn && toggleDayNightCallback) {
        toggleDayNightBtn.addEventListener('click', toggleDayNightCallback);
    }

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

    const toggleMuteBtn = document.getElementById('toggleMuteBtn');
    const volDownBtn = document.getElementById('volDownBtn') as HTMLButtonElement | null;
    const volUpBtn = document.getElementById('volUpBtn') as HTMLButtonElement | null;

    // Helper: Update Mute UI
    const updateMuteUI = (isMuted: boolean) => {
        if (toggleMuteBtn) {
            toggleMuteBtn.setAttribute('aria-pressed', String(isMuted));
            toggleMuteBtn.innerHTML = isMuted ? '🔇 Unmute <span class="key-badge">M</span>' : '🔊 Mute <span class="key-badge">M</span>';
            toggleMuteBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
            toggleMuteBtn.title = isMuted ? 'Unmute Audio (M)' : 'Mute Audio (M)';
        }
    };

    // Helper: Mute Toggle Logic
    const toggleMute = () => {
        const isMuted = audioSystem.toggleMute();
        updateMuteUI(isMuted);

        import('../utils/toast.js').then(({ showToast }) => {
            showToast(isMuted ? "Audio Muted 🔇" : "Audio Unmuted 🔊", isMuted ? '🔇' : '🔊');
        });
    };

    // Helper: Adjust Volume
    const adjustVolume = (delta: number) => {
        let newVol = audioSystem.volume + delta;
        newVol = Math.max(0, Math.min(1, newVol));
        audioSystem.setVolume(newVol);

        if (newVol > 0 && audioSystem.isMuted) {
            audioSystem.isMuted = false;
            updateMuteUI(false);
        }

        const percentage = Math.round(newVol * 100);

        // UX: Update Button States (Visual Polish)
        // Use epsilon for float comparison safety
        if (volDownBtn) {
            volDownBtn.setAttribute('aria-disabled', String(newVol <= 0.01));
            volDownBtn.title = `Decrease Volume (-) • ${percentage}%`;
        }
        if (volUpBtn) {
            volUpBtn.setAttribute('aria-disabled', String(newVol >= 0.99));
            volUpBtn.title = `Increase Volume (+) • ${percentage}%`;
        }

        const icon = newVol === 0 ? '🔇' : newVol < 0.5 ? '🔉' : '🔊';

        import('../utils/toast.js').then(({ showToast }) => {
            showToast(`Volume: ${percentage}% ${icon}`, icon);
        });
    };

    // Initialize Volume Buttons State
    if (volDownBtn) volDownBtn.setAttribute('aria-disabled', String(audioSystem.volume <= 0.01));
    if (volUpBtn) volUpBtn.setAttribute('aria-disabled', String(audioSystem.volume >= 0.99));

    // NEW: Initialize Tooltips
    const initialVolPct = Math.round(audioSystem.volume * 100);
    if (volDownBtn) volDownBtn.title = `Decrease Volume (-) • ${initialVolPct}%`;
    if (volUpBtn) volUpBtn.title = `Increase Volume (+) • ${initialVolPct}%`;
    if (toggleMuteBtn) toggleMuteBtn.title = audioSystem.isMuted ? 'Unmute Audio (M)' : 'Mute Audio (M)';

    if (volDownBtn) {
        volDownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (volDownBtn.getAttribute('aria-disabled') === 'true') return;
            adjustVolume(-0.1);
        });
    }

    if (volUpBtn) {
        volUpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (volUpBtn.getAttribute('aria-disabled') === 'true') return;
            adjustVolume(0.1);
        });
    }

    if (toggleMuteBtn) {
        toggleMuteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent locking/unlocking if that's an issue
            toggleMute();
        });
    }

    if (openJukeboxBtn) {
        openJukeboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlaylist();
        });
    }

    // --- UX: Drag & Drop Support ---
    const dragOverlay = document.getElementById('drag-overlay');
    let dragCounter = 0;

    if (dragOverlay) {
        window.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            dragOverlay.classList.add('active');
            dragOverlay.setAttribute('aria-hidden', 'false');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                dragOverlay.classList.remove('active');
                dragOverlay.setAttribute('aria-hidden', 'true');
            }
        });

        window.addEventListener('dragover', (e) => {
            e.preventDefault(); // Necessary to allow dropping
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            dragCounter = 0;
            dragOverlay.classList.remove('active');
            dragOverlay.setAttribute('aria-hidden', 'true');

            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const { validFiles, invalidFiles } = filterValidMusicFiles(files);

                if (validFiles.length > 0) {
                    audioSystem.addToQueue(validFiles);

                    // Show feedback via Toast
                    import('../utils/toast.js').then(({ showToast }) => {
                        if (invalidFiles.length > 0) {
                            showToast(`Added ${validFiles.length} song${validFiles.length > 1 ? 's' : ''}. (${invalidFiles.length} ignored)`, '⚠️');
                        } else {
                            showToast(`Added ${validFiles.length} Song${validFiles.length > 1 ? 's' : ''}! 🎶`, '📂');
                        }
                    });

                    // Also trigger label feedback if available
                    const label = document.querySelector('label[for="musicUpload"]') as HTMLElement | null;
                    if (label) showUploadFeedback(label, validFiles.length);
                } else {
                    // All files were invalid
                    import('../utils/toast.js').then(({ showToast }) => {
                        showToast("❌ Only .mod, .xm, .it, .s3m allowed!", '🚫');
                    });
                }
            }
        });
    }

    return {
        controls,
        updateReticleState, // <--- EXPORT THIS
        updateDayNightButtonState: (isPressed: boolean) => {
            if (toggleDayNightBtn) {
                toggleDayNightBtn.setAttribute('aria-pressed', String(isPressed));
                toggleDayNightBtn.setAttribute('aria-label', isPressed ? 'Switch to Day' : 'Switch to Night');
                // UX: Update button text to show available action
                toggleDayNightBtn.innerHTML = isPressed
                    ? '☀️ Switch to Day <span class="key-badge">N</span>'
                    : '🌙 Switch to Night <span class="key-badge">N</span>';

                import('../utils/toast.js').then(({ showToast }) => {
                    const mode = isPressed ? "Night Mode Active 🌙" : "Day Mode Active ☀️";
                    showToast(mode, isPressed ? '🌙' : '☀️');
                });
            }
        }
    };
}