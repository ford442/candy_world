## 2024-05-24 - Accessibility in Pointer Lock Games
**Learning:** In a Pointer Lock game (First Person), standard HTML UI elements (like buttons) become inaccessible once the pointer is locked. When unlocking (e.g., via ESC), it is critical to explicitly manage focus. If focus is lost or remains on the canvas, screen reader users cannot navigate the pause menu.
**Action:** Always implement an `unlock` event listener that explicitly moves focus to the primary action button of the pause menu (e.g., "Resume") using `requestAnimationFrame`.

## 2024-05-24 - Micro-Interactions for Invisible Inputs
**Learning:** File inputs are often visually hidden for styling, but this removes standard feedback (filename). Users need immediate confirmation that their action worked.
**Action:** When using hidden file inputs, capture the `change` event and update the associated `<label>` text temporarily with a success message (e.g., "✅ 3 Songs Added!"). Save and restore the original text after a short delay.

## 2024-05-25 - Passive Information in Immersive Apps
**Learning:** In full-screen immersive applications (like games), status updates (e.g., "Now Playing") often get buried in menus. Users appreciate passive, non-blocking notifications that confirm automatic state changes without requiring interaction or breaking immersion.
**Action:** Use "Toast" notifications for passive state changes. Ensure they are `aria-live="polite"`, visually distinct but unobtrusive (e.g., top center), and auto-dismissing.
