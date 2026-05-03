const fs = require('fs');
const file = 'src/core/input/playlist-manager.ts';
let code = fs.readFileSync(file, 'utf8');

const search = `    // UX: Arrow Key Navigation for Playlist
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
        return true;
    }`;

const replace = `    // UX: Arrow Key Navigation for Playlist
    if (event.code === 'ArrowDown' || event.code === 'ArrowUp') {
        // Query all visually accessible buttons within the playlist overlay
        const focusableBtns = Array.from(playlistOverlay.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')).filter(el => (el as HTMLElement).offsetParent !== null) as HTMLElement[];
        if (focusableBtns.length > 0) {
            event.preventDefault(); // Prevent scrolling
            const currentIndex = focusableBtns.indexOf(document.activeElement as HTMLElement);
            let nextIndex;

            if (event.code === 'ArrowDown') {
                nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % focusableBtns.length;
            } else {
                nextIndex = currentIndex === -1 ? focusableBtns.length - 1 : (currentIndex - 1 + focusableBtns.length) % focusableBtns.length;
            }
            focusableBtns[nextIndex].focus();
        }
        return true;
    }`;

code = code.replace(search, replace);

fs.writeFileSync(file, code);
