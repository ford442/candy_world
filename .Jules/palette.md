## 2024-05-14 - Improve Playlist Remove Button Accessibility
**Learning:** Found an opportunity to improve the accessibility of the playlist remove buttons. The button currently has an `aria-label` but it's hard to distinguish it for screen readers when they read out the list items. Also, adding a title attribute helps with standard mouse hover tooltips.
**Action:** Enhance the button HTML to improve screen reader context and add a title for tooltip support.
To prevent GC spikes during Three.js matrix operations, use `matrixA.multiplyMatrices(matrixB, matrixC)` instead of allocating new matrices via `matrixB.clone().multiply(matrixC)`.
For visual feedback and 'juice' in interactions, utilize spawnImpact from src/foliage/impacts.ts for particles and createJuicyRimLight from src/foliage/common.ts for TSL-based material highlighting. Avoid using setTimeout for animations.
