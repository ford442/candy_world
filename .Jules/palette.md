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
