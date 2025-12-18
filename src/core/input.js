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

    // Lock pointer when Start button is clicked
    if (startButton) {
        startButton.addEventListener('click', () => {
            controls.lock();
        });
    }

    // Also keep the instructions container click for convenience
    if (instructions) {
        instructions.addEventListener('click', (event) => {
            if (event.target === instructions) {
                controls.lock();
            }
        });
    }

    const settingsContainer = document.querySelector('.settings-container');
    if (settingsContainer) {
        settingsContainer.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    }

    controls.addEventListener('lock', () => {
        if (instructions) instructions.style.display = 'none';
    });
    controls.addEventListener('unlock', () => {
        if (instructions) instructions.style.display = 'flex';
        // Palette: Update button text to "Resume" to indicate game state is preserved
        if (startButton) {
            startButton.innerText = 'Resume Exploration 🚀';
            startButton.setAttribute('aria-label', 'Resume Exploration');
        }
    });

    // Key Handlers
    const onKeyDown = function (event) {
        if (event.ctrlKey && event.code !== 'ControlLeft' && event.code !== 'ControlRight') {
            event.preventDefault();
        }
        switch (event.code) {
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

    const onMouseDown = function (event) {
        if (event.button === 2) { // Right Click
            keyStates.forward = true;
        }
    };

    const onMouseUp = function (event) {
        if (event.button === 2) {
            keyStates.forward = false;
        }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);

    // --- Music Upload Handler ---
    const musicUpload = document.getElementById('musicUpload');
    if (musicUpload) {
        musicUpload.addEventListener('change', (event) => {
            const files = event.target.files;
            if (files && files.length > 0) {
                console.log(`Selected ${files.length} file(s) for upload`);
                audioSystem.addToQueue(files);

                // Visual feedback
                const label = document.querySelector('label[for="musicUpload"]');
                if (label) {
                    if (!label.dataset.originalText) {
                        label.dataset.originalText = label.innerText;
                    }
                    const fileCount = files.length;
                    label.innerText = `✅ ${fileCount} Track${fileCount > 1 ? 's' : ''} Added!`;
                    label.style.borderColor = '#4CAF50';
                    label.style.color = '#4CAF50';

                    if (label.dataset.timeoutId) {
                        clearTimeout(Number(label.dataset.timeoutId));
                    }

                    const timeoutId = setTimeout(() => {
                        label.innerText = label.dataset.originalText;
                        label.style.borderColor = '';
                        label.style.color = '';
                        delete label.dataset.timeoutId;
                    }, 2500);

                    label.dataset.timeoutId = timeoutId.toString();
                }
            }
        });
    }

    // Day/Night Toggle UI
    const toggleDayNightBtn = document.getElementById('toggleDayNight');
    if (toggleDayNightBtn && toggleDayNightCallback) {
        toggleDayNightBtn.addEventListener('click', toggleDayNightCallback);
    }

    // We return a function to update ARIA state of toggle button if needed
    return {
        controls,
        updateDayNightButtonState: (isPressed) => {
            if (toggleDayNightBtn) {
                toggleDayNightBtn.setAttribute('aria-pressed', isPressed);
            }
        }
    };
}
