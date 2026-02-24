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

## 2026-03-12 - Handling Text Overflow in User Content
**Learning:** When displaying user-generated filenames (like in a playlist), long strings without spaces can break flexbox layouts or push UI controls off-screen.
**Action:** Always apply `text-overflow: ellipsis`, `overflow: hidden`, and `white-space: nowrap` (along with `min-width: 0` in flex containers) to text elements that display variable content, ensuring layout integrity.

## 2026-06-25 - Mouse Parity for System Controls
**Learning:** Key system controls (like Volume) often get relegated to keyboard shortcuts, excluding mouse-only or touch users. Reliance on "standard" shortcuts (like +/-) excludes devices without those keys visible (e.g. some tablets).
**Action:** Ensure every system toggle/adjustment has a visible UI equivalent in the settings menu, using accessible buttons with clear visual states (e.g., disabled when min/max reached).

## 2026-07-15 - Tooltips for Shortcut Discoverability
**Learning:** In a keyboard-heavy 3D application, users often miss available shortcuts for UI controls (like volume) when the buttons only display icons. While `aria-label` helps screen readers, sighted mouse users have no way to discover these shortcuts without guessing.
**Action:** Add `title` attributes to all icon-only control buttons that include both the action name and the keyboard shortcut (e.g., "Decrease Volume (-)"), bridging the gap between mouse and keyboard interaction.

## 2026-07-28 - Visualizing Ability Cooldowns
**Learning:** Players often fail to use abilities like Dash or Mines because they lack visual feedback on when they are ready. Relying solely on internal timers or audio cues creates cognitive load and frustration.
**Action:** Implement always-visible HUD elements for key abilities that include both iconographic representation and dynamic cooldown overlays, synchronized with the game loop state.

## 2026-08-01 - Volume Button Focus Preservation
**Learning:** The native `disabled` attribute removes elements from the focus order, causing disorientation for keyboard users when a button (like Volume Down) becomes disabled after activation.
**Action:** Use `aria-disabled="true"` with custom CSS styling to create a "soft disabled" state that preserves focus. Ensure associated click handlers explicitly check this attribute to prevent unwanted actions.

## 2026-08-04 - In-Context Shortcut Visualization
**Learning:** While `title` tooltips help discoverability, they require hover interaction. For frequently used controls like Volume, users benefit significantly from seeing the shortcut key directly on the button surface, reducing cognitive load and reinforcing muscle memory.
**Action:** Append visual key badges (e.g., `<span class="key-badge">+</span>`) to the label of primary control buttons where space permits, ensuring the badge style is consistent with other HUD elements.

## 2026-08-05 - Keyboard Feedback for HUD Elements
**Learning:** While cooldown indicators show *availability*, they don't confirm *input*. Players pressing keys for abilities (like Dash) often wonder if the game registered the press, especially if the action fails due to other constraints (e.g. energy).
**Action:** Add immediate visual feedback (e.g., a "pressed" style with scale/border change) to HUD elements when the corresponding physical key is pressed, decoupling the input confirmation from the game logic execution.

## 2026-08-08 - Unified Progress Feedback
**Learning:** When multiple async processes contribute to a single 'Loading' state (e.g. map generation + procedural extras), treating them as separate 0-100% bars confuses the user as the progress jumps back to 0.
**Action:** Calculate a global total for all phases upfront and report cumulative progress to provide a single, continuous timeline. Reinforce this with a visual progress bar (e.g. gradient background) on the CTA button itself for better glanceability.

## 2026-08-12 - Throttled Progress Announcements
**Learning:** Rapidly updating text content for visual smoothness (e.g., "Loading 1%... 2%... 3%") creates an unusable experience for screen reader users, who hear a constant torrent of numbers.
**Action:** Decouple visual progress (smooth gradients/animations) from semantic progress. Throttle text updates and ARIA announcements to significant milestones (e.g., every 10%) and use `aria-busy="true"` to indicate ongoing processing.
