## 2024-05-14 - Improve Playlist Remove Button Accessibility
**Learning:** Found an opportunity to improve the accessibility of the playlist remove buttons. The button currently has an `aria-label` but it's hard to distinguish it for screen readers when they read out the list items. Also, adding a title attribute helps with standard mouse hover tooltips.
**Action:** Enhance the button HTML to improve screen reader context and add a title for tooltip support.

## 2025-05-16 - Add aria-hidden to decorative icons
**Learning:** Found an opportunity to improve the accessibility of the decorative emojis in `index.html`. They were being read out by screen readers which is redundant since the surrounding context is already clear.
**Action:** Enhance the HTML by adding `aria-hidden="true"` to these decorative elements.
