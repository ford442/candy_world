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
            playlistList.innerHTML = '<li class="playlist-item" style="justify-content:center; color:#999;">No songs loaded... add some! 🍭</li>';
        }
    }

    // Hook up AudioSystem callbacks
    audioSystem.onPlaylistUpdate = () => { if (isPlaylistOpen) renderPlaylist(); };
    audioSystem.onTrackChange = () => { if (isPlaylistOpen) renderPlaylist(); };

    // --- Input Logic ---

    // Toggle Function
    function togglePlaylist() {
        isPlaylistOpen = !isPlaylistOpen;

        if (isPlaylistOpen) {
            // OPENING
            controls.unlock(); // Unlock mouse so we can click
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
            }
        }
    });

    // Key Handlers
    const onKeyDown = function (event) {
        // Prevent default browser actions (like Ctrl+S)
        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }

        switch (event.code) {
            case 'KeyQ':
                togglePlaylist();
                break;
            case 'KeyW': keyStates.jump = true; break;
            case 'KeyA': keyStates.left = true; break;
            case 'KeyS': keyStates.backward = true; break;
            case 'KeyD': keyStates.right = true; break;
            case 'Space': keyStates.jump = true; break;
            case 'KeyN': if(toggleDayNightCallback) toggleDayNightCallback(); break;
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
            case 'KeyW': keyStates.jump = false; break;
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
        if (event.button === 2) keyStates.forward = true;
    };

    const onMouseUp = function (event) {
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

    return {
        controls,
        updateDayNightButtonState: (isPressed) => {
            if (toggleDayNightBtn) toggleDayNightBtn.setAttribute('aria-pressed', isPressed);
        }
    };
}
