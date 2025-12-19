## 2024-05-22 - Playlist Overlay Accessibility
**Learning:** Adding `role="dialog"` and `aria-modal="true"` to overlays is crucial for screen readers, but it must be paired with focus management (moving focus to the dialog when opened) to be truly effective. Also, ensuring that focus returns to the triggering element (or a reasonable fallback) when the dialog closes is key for keyboard navigation flow.
**Action:** Always implement focus trapping/management whenever introducing a modal or overlay that interrupts the main game loop.
