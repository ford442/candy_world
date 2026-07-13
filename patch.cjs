const fs = require('fs');
let code = fs.readFileSync('src/core/main.ts', 'utf8');

const search = `
    if (btnCoreOnly && btnFullGame && btnFastFull) {
        const setupModeButton = (btn: HTMLButtonElement, mode: 'CORE' | 'FULL' | 'FAST_FULL') => {
            btn.addEventListener('click', async () => {
                btn.setAttribute('aria-busy', 'true');
                btn.setAttribute('aria-disabled', 'true');
                try {
                    updateStartupMode(mode);
                    await yieldFrame();
                } finally {
                    btn.setAttribute('aria-busy', 'false');
                    btn.setAttribute('aria-disabled', 'false');
                }
            });
        };

        setupModeButton(btnCoreOnly, 'CORE');
        setupModeButton(btnFullGame, 'FULL');
        setupModeButton(btnFastFull, 'FAST_FULL');
    }
`;

const replace = `
    if (btnCoreOnly && btnFullGame && btnFastFull) {
        const modeButtons = [
            { btn: btnCoreOnly, mode: 'CORE' as const },
            { btn: btnFullGame, mode: 'FULL' as const },
            { btn: btnFastFull, mode: 'FAST_FULL' as const }
        ];

        const setupModeButton = (btn: HTMLButtonElement, mode: 'CORE' | 'FULL' | 'FAST_FULL', index: number) => {
            btn.addEventListener('click', async () => {
                btn.setAttribute('aria-busy', 'true');
                btn.setAttribute('aria-disabled', 'true');
                try {
                    updateStartupMode(mode);
                    await yieldFrame();
                } finally {
                    btn.setAttribute('aria-busy', 'false');
                    btn.setAttribute('aria-disabled', 'false');
                }
            });

            // ♿ Aria: Keyboard navigation for radiogroup
            btn.addEventListener('keydown', (e) => {
                let nextIndex = -1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIndex = (index + 1) % modeButtons.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIndex = (index - 1 + modeButtons.length) % modeButtons.length;
                }

                if (nextIndex !== -1) {
                    e.preventDefault();
                    const nextBtn = modeButtons[nextIndex].btn;
                    nextBtn.focus();
                    nextBtn.click();
                }
            });

            // ♿ Aria: Roving tabindex management
            btn.addEventListener('focus', () => {
                modeButtons.forEach(mb => mb.btn.setAttribute('tabindex', '-1'));
                btn.setAttribute('tabindex', '0');
            });
        };

        modeButtons.forEach((mb, index) => {
            // Initialize roving tabindex: checked item is 0, others -1
            mb.btn.setAttribute('tabindex', mb.btn.getAttribute('aria-checked') === 'true' ? '0' : '-1');
            setupModeButton(mb.btn, mb.mode, index);
        });
    }
`;

if (code.includes(search)) {
    fs.writeFileSync('src/core/main.ts', code.replace(search, replace));
    console.log("Patched successfully");
} else {
    console.log("Could not find search block");
}
