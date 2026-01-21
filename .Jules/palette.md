# Palette's Journal

## 2024-05-23 - Visual Consistency in Typography
**Learning:** The "Candy" aesthetic relies heavily on the "Fredoka One" font for its playful, rounded look. However, standard UI elements (headings in the pause menu and jukebox) were defaulting to system fonts (`Segoe UI`), creating a visual disconnect.
**Action:** Always verify that branding fonts are applied consistently across all UI layers, especially in modal overlays that sit on top of the 3D world. Consolidating font usage (e.g., in `index.html`) is a low-cost, high-impact visual polish.

## 2024-10-24 - Initial vs. Dynamic State Consistency
**Learning:** The Mute button's initial HTML state ("🔊 Mute") differed from its dynamic JavaScript state ("🔊 Mute (M)"). This meant the keyboard shortcut was undiscoverable until after the user had already interacted with the button.
**Action:** When implementing UI that updates dynamically, always ensure the hardcoded HTML `initial` state matches the `logic` state to prevent "pop-in" of information or missing affordances on first load.

## 2024-10-27 - Reduced Motion for Loaders
**Learning:** When implementing `prefers-reduced-motion: reduce`, simply removing animations from loading spinners (`animation: none`) can make the app appear frozen or broken.
**Action:** For status indicators like spinners, slow down the animation significantly (e.g., 5s duration) instead of removing it completely. This respects the user's preference while still communicating active processing.

## 2024-11-20 - Focus Traps in Game Overlays
**Learning:** In pointer-locked games, unlocking the cursor for menus often leaves keyboard focus undefined, leading to tabbing into hidden elements or out of the game entirely.
**Action:** Implement explicit "Focus Traps" (cycling Tab navigation) for all in-game overlays to ensure users stay within the intended UI context.
