## 2024-05-14 - Improve Playlist Remove Button Accessibility
**Learning:** Found an opportunity to improve the accessibility of the playlist remove buttons. The button currently has an `aria-label` but it's hard to distinguish it for screen readers when they read out the list items. Also, adding a title attribute helps with standard mouse hover tooltips.
**Action:** Enhance the button HTML to improve screen reader context and add a title for tooltip support.
