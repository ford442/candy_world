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
