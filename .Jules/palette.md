## 2024-05-23 - Semantic Controls List
**Learning:** Using `<dl>` (Definition Lists) for key-command mappings creates a much richer semantic structure than `<div>` soup. It allows screen readers to associate the "Key" (Term) with the "Action" (Description) programmatically.
**Action:** Always check "cheat sheet" or "controls" sections for Definition List opportunities.

## 2024-05-24 - Feedback for Invisible Actions
**Learning:** Users lack confidence when performing actions with no immediate visual result (like uploading files that just enter a queue). Updating the trigger element's text temporarily is a zero-layout-shift way to provide confirmation.
**Action:** Look for file inputs and async buttons that don't change state, and add temporary success messages.
