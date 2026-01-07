// src/core/input.js

import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export const keyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    sneak: false,
    sprint: false
};

// Controls and Event Listeners
export function initInput(camera, audioSystem, toggleDayNightCallback) {
    const controls = new PointerLockControls(camera, document.body);
    const instructions = document.getElementById('instructions');
    const startButton = document.getElementById('startButton');
    
    // Playlist Elements
    const playlistOverlay = document.getElementById('playlist-overlay');
    const playlistList = document.getElementById('playlist-list');
    const closePlaylistBtn = document.getElementById('closePlaylistBtn');
    const playlistUploadInput = document.getElementById('playlistUploadInput');

    let isPlaylistOpen = false;
    let lastFocusedElement = null; // Store focus before opening modal

    // --- NEW: Visual Reticle (Crosshair) ---
    // Check if it exists; if not, create it
    if (!document.getElementById('game-reticle')) {
        const reticle = document.createElement('div');
        reticle.id = 'game-reticle';
        document.body.appendChild(reticle);
    }

    // Function to animate reticle based on state using CSS classes
    function updateReticleState(state) {
        const reticle = document.getElementById('game-reticle');
        if (!reticle) return;

        // Reset classes
        reticle.classList.remove('hover', 'interact');

        // Apply new state
        if (state === 'hover') {
            reticle.classList.add('hover');
        } else if (state === 'interact') {
            reticle.classList.add('interact');
        }
    }

    // --- Helper: Render Playlist ---
    function renderPlaylist() {
        if (!playlistList) return;
        playlistList.innerHTML = '';
        const songs = audioSystem.getPlaylist();
        const currentIdx = audioSystem.getCurrentIndex();

        songs.forEach((file, index) => {
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
                    if (newItems[index]) newItems[index].focus();
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

    // Hook up AudioSystem callbacks
    audioSystem.onPlaylistUpdate = () => { if (isPlaylistOpen) renderPlaylist(); };

    // UX: Show toast and update playlist when track changes
    audioSystem.onTrackChange = (index) => {
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

    // Toggle Function
    function togglePlaylist() {
        isPlaylistOpen = !isPlaylistOpen;

        if (isPlaylistOpen) {
            // OPENING
            lastFocusedElement = document.activeElement;
            controls.unlock(); // Unlock mouse so we can click
            if (instructions) instructions.style.display = 'none'; // Ensure pause menu is hidden
            playlistOverlay.style.display = 'flex';
            renderPlaylist();
            // Focus management: focus the overlay or the close button for accessibility
            requestAnimationFrame(() => {
                if (closePlaylistBtn) closePlaylistBtn.focus();
            });
        } else {
            // CLOSING
            playlistOverlay.style.display = 'none';
            controls.lock(); // Re-lock mouse to play
            // Note: We don't restore focus here because controls.lock() resumes the game
            // and hides the previous UI context.
        }
    }

    // Event Listeners for UI
    if (closePlaylistBtn) {
        closePlaylistBtn.addEventListener('click', togglePlaylist);
    }

    // Helper: Show temporary success feedback on upload buttons
    const showUploadFeedback = (labelElement, filesCount) => {
        if (!labelElement) return;

        // Save original text if not already saved
        if (!labelElement.dataset.originalText) {
            labelElement.dataset.originalText = labelElement.innerText;
        }

        const originalText = labelElement.dataset.originalText;
        labelElement.innerText = `✅ ${filesCount} Song${filesCount > 1 ? 's' : ''} Added!`;

        setTimeout(() => {
            labelElement.innerText = originalText;
        }, 2000);
    };

    if (playlistUploadInput) {
        playlistUploadInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                audioSystem.addToQueue(files);
                const label = document.querySelector('label[for="playlistUploadInput"]');
                showUploadFeedback(label, files.length);
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
        instructions.addEventListener('click', (event) => {
            if (event.target === instructions) {
                controls.lock();
            }
        });
    }

    controls.addEventListener('lock', () => {
        instructions.style.display = 'none';
        
        // If we locked, force playlist closed just in case
        isPlaylistOpen = false; 
        if (playlistOverlay) playlistOverlay.style.display = 'none';
    });

    controls.addEventListener('unlock', () => {
        // CRITICAL: Only show Main Menu if Playlist ISN'T open.
        // If Playlist is open, we *want* to be unlocked, but seeing the Playlist, not the start screen.
        if (!isPlaylistOpen) {
            if (instructions) instructions.style.display = 'flex';
            if (startButton) {
                startButton.innerText = 'Resume Exploration 🚀';
                requestAnimationFrame(() => startButton.focus());
            }
        }
    });

    // Key Handlers
    const onKeyDown = function (event) {
        // Prevent default browser actions (like Ctrl+S)
        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }

        // --- UX: Focus Trap & Control Lock when Playlist is open ---
        if (isPlaylistOpen) {
            // Close on Escape or Q
            if (event.code === 'Escape' || event.code === 'KeyQ') {
                event.preventDefault();
                togglePlaylist();
                return;
            }

            // UX: Arrow Key Navigation for Playlist
            if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
                const playlistBtns = Array.from(playlistOverlay.querySelectorAll('.playlist-btn'));
                if (playlistBtns.length > 0) {
                    event.preventDefault(); // Prevent scrolling
                    const currentIndex = playlistBtns.indexOf(document.activeElement);
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

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

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
            case 'Space': keyStates.jump = true; break;
            case 'KeyN': if(toggleDayNightCallback) toggleDayNightCallback(); break;
            case 'KeyM': toggleMute(); break;
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

    const onKeyUp = function (event) {
        switch (event.code) {
            case 'KeyW': keyStates.forward = false; break;
            case 'KeyA': keyStates.left = false; break;
            case 'KeyS': keyStates.backward = false; break;
            case 'KeyD': keyStates.right = false; break;
            case 'Space': keyStates.jump = false; break;
            case 'ControlLeft':
            case 'ControlRight': keyStates.sneak = false; break;
            case 'ShiftLeft':
            case 'ShiftRight': keyStates.sprint = false; break;
        }
    };

    // Standard Mouse State (Right click to move)
    const onMouseDown = function (event) {
        if (isPlaylistOpen) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = true;
    };

    const onMouseUp = function (event) {
        if (isPlaylistOpen) return; // Block game mouse input
        if (event.button === 2) keyStates.forward = false;
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    // Existing Music Upload Handler (Main Menu) - Kept for compatibility
    const musicUpload = document.getElementById('musicUpload');
    if (musicUpload) {
        musicUpload.addEventListener('change', (event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
                audioSystem.addToQueue(files);
                const label = document.querySelector('label[for="musicUpload"]');
                showUploadFeedback(label, files.length);
            }
        });
    }

    const toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (toggleDayNightBtn && toggleDayNightCallback) {
        toggleDayNightBtn.addEventListener('click', toggleDayNightCallback);
    }

    const toggleMuteBtn = document.getElementById('toggleMuteBtn');

    // Helper: Mute Toggle Logic
    const toggleMute = () => {
        const isMuted = audioSystem.toggleMute();

        if (toggleMuteBtn) {
            toggleMuteBtn.setAttribute('aria-pressed', isMuted);
            toggleMuteBtn.innerHTML = isMuted ? '🔇 Unmute (M)' : '🔊 Mute (M)';
            toggleMuteBtn.setAttribute('aria-label', isMuted ? 'Unmute Audio' : 'Mute Audio');
        }

        import('../utils/toast.js').then(({ showToast }) => {
            showToast(isMuted ? "Audio Muted 🔇" : "Audio Unmuted 🔊", isMuted ? '🔇' : '🔊');
        });
    };

    if (toggleMuteBtn) {
        toggleMuteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent locking/unlocking if that's an issue
            toggleMute();
        });
    }

    const openJukeboxBtn = document.getElementById('openJukeboxBtn');
    if (openJukeboxBtn) {
        openJukeboxBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePlaylist();
        });
    }

    return {
        controls,
        updateReticleState, // <--- EXPORT THIS
        updateDayNightButtonState: (isPressed) => {
            if (toggleDayNightBtn) {
                toggleDayNightBtn.setAttribute('aria-pressed', isPressed);
                // UX: Update button text to show available action
                toggleDayNightBtn.innerHTML = isPressed
                    ? '☀️ Switch to Day (N)'
                    : '🌙 Switch to Night (N)';

                import('../utils/toast.js').then(({ showToast }) => {
                    const mode = isPressed ? "Night Mode Active 🌙" : "Day Mode Active ☀️";
                    showToast(mode, isPressed ? '🌙' : '☀️');
                });
            }
        }
    };
}
