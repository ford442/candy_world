const fs = require('fs');

const a11yContent = fs.readFileSync('src/ui/accessibility-menu.ts', 'utf8');

// Update createMenu overlay to start with opacity 0
let updatedA11y = a11yContent.replace(
    /opacity: 1;\n\s*transition: opacity 0.3s ease;/,
    `opacity: 0;\n      transition: opacity 0.3s ease;`
);

// Update createMenu container to start with opacity 0 and transform
updatedA11y = updatedA11y.replace(
    /font-family: system-ui, -apple-system, sans-serif;\n\s*transition: opacity 0.3s ease;/,
    `font-family: system-ui, -apple-system, sans-serif;\n      opacity: 0;\n      transform: scale(0.95);\n      transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);`
);

// Update open()
const openReplacement = `    this.createMenu();
    this.isOpen = true;
    document.addEventListener('keydown', this.boundKeyHandler);

    // Force DOM reflow
    void this.overlay!.offsetWidth;
    void this.container!.offsetWidth;

    // Apply active CSS styles
    this.overlay!.style.opacity = '1';
    this.container!.style.opacity = '1';
    this.container!.style.transform = 'scale(1)';

    // Trap focus after transition
    if (this.container) {
      setTimeout(() => {
        if (this.container && this.isOpen) {
          this.releaseFocusTrap = trapFocusInside(this.container);
        }
      }, 300);
      announce('Accessibility menu opened. Use Tab to navigate, Enter to select.', 'polite');
    }`;

updatedA11y = updatedA11y.replace(
    /    this\.createMenu\(\);\n    this\.isOpen = true;\n    document\.addEventListener\('keydown', this\.boundKeyHandler\);\n    \n    \/\/ Trap focus\n    if \(this\.container\) \{\n      setTimeout\(\(\) => \{\n        if \(this\.container && this\.isOpen\) \{\n          this\.releaseFocusTrap = trapFocusInside\(this\.container\);\n        \}\n      \}, 100\);\n      announce\('Accessibility menu opened\. Use Tab to navigate, Enter to select\.', 'polite'\);\n    \}/,
    openReplacement
);

// Update close()
updatedA11y = updatedA11y.replace(
    /    \/\/ Remove elements\n    if \(this\.container\) \{\n      this\.container\.style\.opacity = '0';\n    \}\n    if \(this\.overlay\) \{\n      this\.overlay\.style\.opacity = '0';\n    \}/,
    `    // Remove elements
    if (this.container) {
      this.container.style.opacity = '0';
      this.container.style.transform = 'scale(0.95)';
    }
    if (this.overlay) {
      this.overlay.style.opacity = '0';
    }`
);

if (a11yContent !== updatedA11y) {
    fs.writeFileSync('src/ui/accessibility-menu.ts', updatedA11y);
    console.log('Patched accessibility-menu.ts');
}
