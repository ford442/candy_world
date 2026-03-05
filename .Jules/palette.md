The 'Neon' palette works best with uBloomStrength > 1.5.
Matte clay materials need a strong directional light to show form.
- **Bioluminescent Proximity Glow**: Using `distance()` between `positionWorld` and `uPlayerPosition` combined with a smoothstep falloff creates an incredibly juicy, immersive footprint trail. Multiplying this by `uAudioLow` links player movement inextricably to the music's heartbeat. Cyan and Magenta neon gradients stand out beautifully against dark ground.
## 2025-03-04 - HUD Ability Interaction & ARIA Landmark Landmarks
**Learning:** Custom UI components built from divs (like game ability slots) often omit `:hover` and `:focus-visible` styles, rendering them opaque to keyboard users and lacking "juice" for pointer users. Moreover, custom overlays functioning as dialogs/pause menus must utilize `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` to adequately trap context for screen readers.
**Action:** Always provide explicit interactive feedback states (`:hover`, `:focus-visible`) for `role="button"` divs, and ensure fullscreen game menus utilize correct ARIA dialogue landmarks to enhance keyboard and screen-reader accessibility.
