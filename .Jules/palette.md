The 'Neon' palette works best with uBloomStrength > 1.5.
Matte clay materials need a strong directional light to show form.
- **Bioluminescent Proximity Glow**: Using `distance()` between `positionWorld` and `uPlayerPosition` combined with a smoothstep falloff creates an incredibly juicy, immersive footprint trail. Multiplying this by `uAudioLow` links player movement inextricably to the music's heartbeat. Cyan and Magenta neon gradients stand out beautifully against dark ground.
## 2026-03-05 - Add ARIA Dialog Roles to Game Overlays
**Learning:** Fullscreen game overlays (like Pause Menus) that trap focus behave effectively as modals. When screen readers transition focus from a canvas back to the DOM, they lose context without explicit container labeling.
**Action:** Always wrap custom full-screen "pause" or "overlay" UI within elements assigned `role="dialog"`, `aria-modal="true"`, and a descriptive `aria-labelledby` linking to the overlay title.
## 2026-03-05 - Avoid layout-shifting inline success hints
**Learning:** Temporarily swapping out `innerHTML` inside complex buttons or labels (e.g. file uploads) to show feedback like "✅ 2 Songs Added!" destroys the original DOM elements (icons, keyboard badges, spans) and causes jarring visual layout shifts. It also removes screen reader context precisely when the user expects confirmation.
**Action:** Always use dedicated non-intrusive status elements (like an `aria-live` Toast notification system) to present temporary success/error feedback instead of mutating the interactive element itself.
## 2026-03-05 - Reset file input values after selection
**Learning:** When using `<input type="file">` for continuous interactions (like adding songs to a playlist), failing to reset the input's `value` prevents users from re-selecting a file they previously added and then removed, because the `change` event won't fire if the file path remains the same.
**Action:** Always clear the value of file inputs (`target.value = ''`) immediately after processing the selected files to ensure subsequent selections of the same file trigger the change event properly.

## 2026-03-05 - Add Game Feel to Jump
**Learning:** Core gameplay interactions like jumping from the ground felt "silent" without visual feedback. Adding impact particles and full-screen effects enhances the sense of weight and juice.
**Action:** Implemented `spawnImpact(player.position, "jump")` and a subtle `uChromaticIntensity` pulse inside the physics update loop (`updateDefaultState` in `src/systems/physics.ts`) when `player.velocity.y > 0 && player.isGrounded` triggers.
## 2026-03-08 - Hide decorative symbols and keyboard badges from screen readers
**Learning:** Screen readers will redundantly read emojis and keyboard shortcut indicators inside buttons alongside the button's `aria-label`. This creates a noisy and confusing experience, like hearing "sun switch to day n" instead of just the functional text.
**Action:** Always wrap decorative text, emojis, and visual key shortcuts (e.g. `<span class="key-badge">`) within elements assigned `aria-hidden="true"` inside buttons to ensure a clean accessible readout.
## 2026-03-08 - Update aria-label dynamically to convey state changes
**Learning:** Screen readers prioritize static `aria-label` attributes over dynamic `title` attributes. When a UI component has a static `aria-label` (e.g., `aria-label="Dash Ability (E)"`), any dynamic updates to its `title` (e.g., changing `title` to "Dash (E) - Recharging...") will not be announced when focus remains on the element, preventing screen reader users from perceiving state changes.
**Action:** Always update the `aria-label` attribute directly (e.g., `setAttribute('aria-label', "Dash Ability (E) - Recharging...")`) alongside the `title` when interactive states change to ensure screen readers correctly announce the new state.

## 2026-03-08 - Provide visual feedback for aria-disabled UI
**Learning:** Adding `aria-disabled="true"` to interactive elements is crucial for screen readers, but sighted users still need visual cues. If a button maintains its hover states, pointer cursor, and full opacity when disabled, it creates a confusing experience where users think the button is clickable but it does nothing.
**Action:** Always pair `aria-disabled="true"` attributes with matching CSS rules (e.g. `[aria-disabled="true"] { opacity: 0.6; cursor: not-allowed; }`) and ensure hover/active states are neutralized so the UI accurately reflects its inactive state to all users.
## 2026-03-08 - Visual Feedback for aria-pressed Toggle Buttons
**Learning:** We added `aria-pressed="true"` states to toggle buttons for screen readers, but sighted users received no clear visual indication when a feature (like Night Mode or Audio Muting) was active since the button looked identical.
**Action:** Always provide explicit CSS styles (e.g., `.toggle-button[aria-pressed="true"]`) with clear visual changes (like an inset shadow or alternative background color) whenever using ARIA state toggles to ensure parity between visual feedback and accessibility tree state.

## 2026-03-09 - Provide explicit confirmation for destructive actions
**Learning:** Destructive actions like removing items from a list (e.g., Jukebox playlist) without visual confirmation or screen reader feedback create an inconsistent and uncertain UX. Users, especially those relying on screen readers, need immediate and explicit feedback that their action was successful.
**Action:** Always pair destructive UI actions with a transient, accessible status notification (like an `aria-live` Toast) confirming the outcome (e.g., "Removed [Item Name]").

## 2026-03-09 - Format file names for screen readers in lists
**Learning:** Dynamically populated lists containing user uploads (like Jukebox playlists) often use raw file names (`super_cool_song_v2.xm`) for `aria-label` and `title` attributes. This results in screen readers reading out the file extension and literal characters, which creates a poor UX compared to a parsed, human-readable title.
**Action:** Always use a human-readable formatted string (e.g. `displayName` parsed from `file.name`) when setting `aria-label` and `title` attributes for dynamically populated elements derived from file uploads to ensure a smooth screen reader experience.

## 2026-03-09 - Make custom UI toggles semantic and keyboard accessible
**Learning:** Custom UI toggles built with `div` elements and purely visual CSS classes (like `.candy-toggle--active`) are completely invisible to screen readers and inaccessible via keyboard navigation. They lack a semantic role, an interactive state, and an accessible name.
**Action:** Always refactor custom `div` toggles into `<button type="button" role="switch">` elements. Bind their active state to `aria-checked` dynamically, link them to a visible label using `aria-labelledby`, and ensure `.focus-visible` styles are present for keyboard users.

## 2026-03-10 - ARIA Labels on Template-Generated Form Controls
**Learning:** Dynamically generated form controls inside template strings (like `<select>` or `<input type="range">`) are often missing `aria-labelledby` mappings to their descriptive label spans. This causes screen reader context loss as the visual label is not programmatically associated with the input.
**Action:** Always ensure template-generated inputs include `aria-labelledby` attributes that point to explicit `id`s on their corresponding label elements.

## 2026-03-23 - Link custom tabs to panels with aria-controls and aria-labelledby
**Learning:** Custom tab implementations often remember to apply `role="tablist"` and `role="tab"`, but frequently omit linking the tab to its content container. Without `aria-controls` on the tab and `role="tabpanel"` + `aria-labelledby` on the content container, screen readers lack context of what content the tab dictates.
**Action:** Always ensure `role="tabpanel"` is applied to the content container of custom tabs, and connect the tab button and panel container explicitly using corresponding `id`, `aria-controls`, and `aria-labelledby` attributes.