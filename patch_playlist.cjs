const fs = require('fs');

const htmlContent = fs.readFileSync('index.html', 'utf8');
if (!htmlContent.includes('transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);')) {
    const updatedHtml = htmlContent.replace(
        '#playlist-overlay {',
        '#playlist-overlay {\n            opacity: 0;\n            transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);'
    ).replace(
        '#playlist-backdrop {',
        '#playlist-backdrop {\n            opacity: 0;\n            transition: opacity 0.3s ease;'
    );
    fs.writeFileSync('index.html', updatedHtml);
    console.log('Patched index.html');
}

const pmContent = fs.readFileSync('src/core/input/playlist-manager.ts', 'utf8');

let updatedPm = pmContent.replace(
    /playlistOverlay\.style\.opacity\s*=\s*'1';/g,
    `playlistOverlay.style.opacity = '1';
            playlistOverlay.style.transform = 'translate(-50%, -50%) scale(1)';`
).replace(
    /playlistOverlay\.style\.opacity\s*=\s*'0';/g,
    `playlistOverlay.style.opacity = '0';
            playlistOverlay.style.transform = 'translate(-50%, -50%) scale(0.95)';`
).replace(
    /setTimeout\(\(\) => \{\n\s*if \(isPlaylistOpen && playlistOverlay\) \{\n\s*releaseJukeboxFocus = trapFocusInside\(playlistOverlay\);\n\s*\}\n\s*\}, 100\);/g,
    `setTimeout(() => {
                if (isPlaylistOpen && playlistOverlay) {
                    releaseJukeboxFocus = trapFocusInside(playlistOverlay);
                }
            }, 300);`
);

if (pmContent !== updatedPm) {
    fs.writeFileSync('src/core/input/playlist-manager.ts', updatedPm);
    console.log('Patched playlist-manager.ts');
}
