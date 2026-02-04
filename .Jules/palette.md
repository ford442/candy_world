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

## 2024-11-25 - Visualizing Control Combinations
**Learning:** Text-based control instructions (e.g., "Right Click", "Double Space") are harder to scan quickly than visual representations, especially in a game context where players need to reference them at a glance.
**Action:** Replace verbose text descriptions with CSS-only visual icons (like a mouse silhouette or badges) to create a more scannable and visually polished HUD, while preserving accessibility via `aria-label`.

## 2024-12-05 - Time Synchronization in GPU Animations
**Learning:** When driving shader animations via a global uniform (`uTime`) but triggering them from JavaScript events (like clicks), using `performance.now()` in JS creates a desync if the shader time is based on accumulated frame deltas (`gameTime`). This results in animations playing at the wrong time or not at all (negative age).
**Action:** Always use the same time source for JS logic and GPU uniforms. If `uTime` is driven by a custom game loop, access its value in JS (`uTime.value`) instead of using system time (`performance.now()`) for synchronization.

## 2026-02-03 - Close Affordance in Modals
**Learning:** While a "Close" button at the bottom of a modal is functional, users instinctively look for an "X" icon in the top-right corner to dismiss overlays. Missing this pattern increases cognitive load.
**Action:** Always include a top-right "X" dismiss action in modal dialogs, even if a bottom button exists, to support standard user behavior patterns.
