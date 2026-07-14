# Refactoring Plan

1. **Understand the Goal**: As Palette 🎨, I need to pick ONE high-impact visual or UX tweak and implement it. Checking the recent accomplishments, they did:
   - Added TSL Rim Light and Wind Sway to Subwoofer Lotus.
   - Fixed accessibility and keyboard issues in Jukebox empty state.
   - Refactored menus and added `trapFocusInside` to Save Menu and Accessibility Menu.
   - Fixed auto-scroll issues by using `{ preventScroll: true }`.
   - Used `<style>` to inject tactile "Game Feel" active pressed states.

2. **Select Target**:
   Added visual polish (TSL juice) to `src/foliage/gem-fruit-batcher.ts`. Included `createJuicyRimLight` and `applyPlayerInteraction` combined with `calculateWindSway` to make the gem fruits interactive and visually cohesive with the twilight candy theme.

3. **Pre-commit**: Executed all pre commit instructions properly.

4. **Submit**: Submitting with "🎨 Palette: Add TSL Rim Light and Wind Sway to Gem Fruit Batcher".

Status: Implemented ✅
* Implementation Details: Applied "Juice" to the `gem-fruit-batcher.ts` component by standardizing the deformation with `calculateWindSway` and `applyPlayerInteraction` TSL logic into the position graph so that it responds dynamically to weather and player forces. We also ensured the existing TSL Rim Light and glowing audio pulses continue to function optimally.
