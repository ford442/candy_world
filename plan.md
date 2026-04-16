1. **Import `trapFocusInside` in `src/ui/analytics-debug.ts`.**
   - Import `trapFocusInside` from `../utils/interaction-utils.ts` in `src/ui/analytics-debug.ts`.

2. **Implement focus trapping in `AnalyticsDebugOverlay`.**
   - Add a private `releaseFocusTrap: (() => void) | null = null;` property to `AnalyticsDebugOverlay`.
   - In `show()`, call `this.releaseFocusTrap = trapFocusInside(this.elements.container);` after the container is created and attached to the DOM.
   - In `hide()`, check if `this.releaseFocusTrap` is defined. If so, call it and then set it to null.

3. **Complete pre-commit steps.**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

4. **Submit PR as Palette.**
   - Title: `🎨 Palette: [Accessibility Polish]`
   - Commit the changes and submit.
