## 2024-05-24 - Semantic Toggles & Hidden Emojis in Analytics Debug
**Learning:** Custom UI toggles (using `<div>` and background colors) lack semantics, making them invisible to screen readers, and inline emojis add noise for visually impaired users.
**Action:** Always use `<button type="button" role="switch" aria-checked="...">` for custom toggles, and add `:focus-visible` outlines. Wrap inline decorative emojis in `<span aria-hidden="true">` to preserve visual delight while ensuring accessibility.

## 2024-05-26 - Audio-Reactive Impacts
**Learning:** Short-lived particle effects (impacts, jumps) feel disconnected from the world if they don't share the global audio rhythm.
**Action:** Mixed `uAudioHigh` and `uAudioLow` into the impact particle scale and color intensity, making explosions pulse organically before fading.

## 2024-06-03 - Empty State Actions and Destructive Action Confirmation
**Learning:** Empty states without a clear next action lead to user confusion, and destructive actions (like overwriting save files) without confirmation lead to accidental data loss.
**Action:** Always include a Call-To-Action (CTA) inside empty states to guide the user towards the desired action. Always use a confirmation dialog before completing a destructive or irreversible action.
## 2024-11-20 - Empty States and Textarea Readability
**Learning:** Empty states without Call-To-Action (CTA) buttons leave users stranded. Textareas containing code, JSON, or Base64 data trigger browser spellcheckers, cluttering the UI with red squiggly lines and degrading performance.
**Action:** Always provide a clear CTA in empty states to guide the user out of it. Add `spellcheck="false"` to data input textareas, and use the `readonly` attribute for output/export textareas to prevent accidental modifications.

## 2025-02-14 - Moon TSL Audio Reactivity
**Learning:** Implementing moon glow using TSL makes it react responsively and beautifully without JS polling.
**Action:** Use `mix` and `uAudioLow` or `uAudioHigh` directly inside TSL emissive materials for organic sky celestial bodies.

## 2024-04-12 - First Contentful Paint and Granular Loading Updates
**Learning:** Dynamically building the base DOM structure of a loading screen via JavaScript causes a blank white screen (FOUC) while scripts load, damaging the perceived performance and 'Game Feel'. Generic 'Loading...' messages without progress bars lead to user frustration and perceived freezes during heavy tasks like WASM init and World Generation.
**Action:** Hardcode the HTML shell of the loading UI directly into `index.html` to guarantee immediate visibility on First Contentful Paint. Replace global `window.setLoadingStatus` hacks with a modular `updateProgress(phaseId, percentage, text)` API threaded directly into heavy initialization functions for smooth, granular updates.
## 2024-04-13 - Audio System Juice
**Learning:** Candy World synthesizes its own sound effects (jumps, impacts, UI clicks) procedurally using the Web Audio API rather than relying on external `.wav` or `.mp3` assets to keep the package lightweight and stylized.
**Action:** When adding new physics or interaction events, trigger them via `(window as any).AudioSystem.playSound('type')` and use the built-in procedural oscillators in `src/audio/audio-system.ts`.
## 2026-04-15 - Accessibility Menu Focus Trapping
**Learning:** The Accessibility Menu needed a robust focus trap to ensure keyboard navigation remained within the modal while it was open, preventing users from accidentally tabbing out into the underlying game canvas or other UI elements.
**Action:** Replaced the simple `this.a11y.trapFocus(this.container)` call with the `trapFocusInside` utility from `interaction-utils.ts`, securely binding and unbinding the focus trap during the menu's lifecycle.
