The 'Neon' palette works best with uBloomStrength > 1.5.
Matte clay materials need a strong directional light to show form.
- **Bioluminescent Proximity Glow**: Using `distance()` between `positionWorld` and `uPlayerPosition` combined with a smoothstep falloff creates an incredibly juicy, immersive footprint trail. Multiplying this by `uAudioLow` links player movement inextricably to the music's heartbeat. Cyan and Magenta neon gradients stand out beautifully against dark ground.
## 2026-03-05 - Add ARIA Dialog Roles to Game Overlays
**Learning:** Fullscreen game overlays (like Pause Menus) that trap focus behave effectively as modals. When screen readers transition focus from a canvas back to the DOM, they lose context without explicit container labeling.
**Action:** Always wrap custom full-screen "pause" or "overlay" UI within elements assigned `role="dialog"`, `aria-modal="true"`, and a descriptive `aria-labelledby` linking to the overlay title.
