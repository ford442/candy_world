const fs = require('fs');

const analyticsContent = fs.readFileSync('src/ui/analytics-debug.ts', 'utf8');

// Update createElements container to start with opacity 0 and transform
let updatedAnalytics = analyticsContent.replace(
    /overflow: hidden;\n      opacity: 1;\n      transition: opacity 0.2s;/,
    `overflow: hidden;\n      opacity: 0;\n      transform: scale(0.95);\n      transition: opacity 0.2s, transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);`
);

// Update show()
const showReplacement = `    this.elements = this.createElements();
    this.isVisible = true;

    // Force DOM reflow
    void this.elements.container.offsetWidth;

    // Apply active styles
    this.elements.container.style.opacity = '1';
    this.elements.container.style.transform = 'scale(1)';

    // Trap focus inside the overlay
    setTimeout(() => {
      if (this.isVisible && this.elements?.container) {
        this.releaseFocusTrap = trapFocusInside(this.elements.container);
      }
    }, 200);`;

updatedAnalytics = updatedAnalytics.replace(
    /    this\.elements = this\.createElements\(\);\n    this\.isVisible = true;\n    \n    \/\/ Trap focus inside the overlay\n    setTimeout\(\(\) => \{\n      if \(this\.isVisible && this\.elements\.container\) \{\n        this\.releaseFocusTrap = trapFocusInside\(this\.elements\.container\);\n      \}\n    \}, 100\);/,
    showReplacement
);

// Update hide()
updatedAnalytics = updatedAnalytics.replace(
    /    this\.elements\.container\.style\.opacity = '0';/,
    `    this.elements.container.style.opacity = '0';
    this.elements.container.style.transform = 'scale(0.95)';`
);

if (analyticsContent !== updatedAnalytics) {
    fs.writeFileSync('src/ui/analytics-debug.ts', updatedAnalytics);
    console.log('Patched analytics-debug.ts');
}
