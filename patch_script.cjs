const fs = require('fs');
let code = fs.readFileSync('src/core/input/input.ts', 'utf8');

code = code.replace(
    /function triggerButtonPressDown\(buttonId: string\): void \{\n\s+const btn = document\.getElementById\(buttonId\);\n\s+if \(btn && btn\.getAttribute\('aria-disabled'\) !== 'true'\) \{\n\s+btn\.classList\.add\('keyboard-active'\);\n\s+\/\/ Fallback for cases where keyup doesn't fire or focus is lost\n\s+btn\.addEventListener\('blur', \(\) => \{\n\s+btn\.classList\.remove\('keyboard-active'\);\n\s+\}, \{ once: true \}\);\n\s+\}\n\s+\}\n\n\s+function triggerButtonPressUp\(buttonId: string\): void \{\n\s+const btn = document\.getElementById\(buttonId\);\n\s+if \(btn\) \{\n\s+btn\.classList\.remove\('keyboard-active'\);\n\s+\}\n\s+\}/,
    `const activeKeyboardButtons = new Set<string>();

    function triggerButtonPressDown(buttonId: string): void {
        const btn = document.getElementById(buttonId);
        if (btn && btn.getAttribute('aria-disabled') !== 'true') {
            btn.classList.add('keyboard-active');
            activeKeyboardButtons.add(buttonId);
        }
    }

    function triggerButtonPressUp(buttonId: string): void {
        const btn = document.getElementById(buttonId);
        if (btn) {
            btn.classList.remove('keyboard-active');
        }
        activeKeyboardButtons.delete(buttonId);
    }

    // Safety: release all stuck button states if window loses focus
    window.addEventListener('blur', () => {
        for (const buttonId of activeKeyboardButtons) {
            triggerButtonPressUp(buttonId);
        }
    });`
);

code = code.replace(
    /case 'KeyQ':\n\s+if \(getIsPlaylistOpen\(\)\) return; \/\/ Handled by playlist manager\n\s+triggerButtonPressDown\('openJukeboxBtn'\);/,
    `case 'KeyQ':\n                if (getIsPlaylistOpen()) return; // Handled by playlist manager\n                if (event.repeat) return;\n                triggerButtonPressDown('openJukeboxBtn');`
);

code = code.replace(
    /case 'KeyN':\n\s+triggerButtonPressDown\('toggleDayNight'\);/,
    `case 'KeyN':\n                if (event.repeat) return;\n                triggerButtonPressDown('toggleDayNight');`
);

code = code.replace(
    /case 'KeyM':\n\s+triggerButtonPressDown\('toggleMuteBtn'\);/,
    `case 'KeyM':\n                if (event.repeat) return;\n                triggerButtonPressDown('toggleMuteBtn');`
);

code = code.replace(
    /case 'KeyU':\n\s+triggerButtonPressDown\('musicUploadBtn'\);/,
    `case 'KeyU':\n                if (event.repeat) return;\n                triggerButtonPressDown('musicUploadBtn');`
);

code = code.replace(
    /case 'Equal':\n\s+case 'NumpadAdd':\n\s+triggerButtonPressDown\('volUpBtn'\);/,
    `case 'Equal':\n            case 'NumpadAdd':\n                if (event.repeat) return;\n                triggerButtonPressDown('volUpBtn');`
);

code = code.replace(
    /case 'Minus':\n\s+case 'NumpadSubtract':\n\s+triggerButtonPressDown\('volDownBtn'\);/,
    `case 'Minus':\n            case 'NumpadSubtract':\n                if (event.repeat) return;\n                triggerButtonPressDown('volDownBtn');`
);

fs.writeFileSync('src/core/input/input.ts', code);
