const fs = require('fs');

const saveMenuContent = fs.readFileSync('src/ui/save-menu/save-menu.ts', 'utf8');

// Fix broken animation reference in close()
let updatedSaveMenu = saveMenuContent.replace(
    /this\.container\.style\.animation = 'fadeIn 0\.2s ease reverse';/,
    `this.container.style.animation = 'saveMenuFadeIn 0.2s ease reverse';`
);

// Fix show() focus trap timeout
updatedSaveMenu = updatedSaveMenu.replace(
    /        setTimeout\(\(\) => \{\n            if \(this\.container && this\.isOpen\(\)\) \{\n                this\.releaseFocusTrap = trapFocusInside\(this\.container\);\n            \}\n        \}, 100\);/,
    `        setTimeout(() => {
            if (this.container && this.isOpen()) {
                this.releaseFocusTrap = trapFocusInside(this.container);
            }
        }, 200);`
);

if (saveMenuContent !== updatedSaveMenu) {
    fs.writeFileSync('src/ui/save-menu/save-menu.ts', updatedSaveMenu);
    console.log('Patched save-menu.ts');
}
