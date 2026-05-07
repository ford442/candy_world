# Lake, Island & Creek

- Feature: Add a lake with an island and a creek that flows into the lake; water should have a gentle flow animation and interact with moisture/growth systems.
- Design notes:
  - Create a `lake` mesh with a water material that supports flow direction and normal-based reflections.
  - Add a small island mesh with rocks/vegetation and a creek mesh/path that visually connects a source to the lake.
  - Optional: use a simple heightfield or spline-based mesh to define creek path and animate texture UVs for flow.
- Interaction with foliage/growth:
  - Areas near the creek and lake have increased `soilMoisture` and support faster growth/spawning.
  - Allow fish or water-specific species to spawn near the lake/island (future work).
- Implementation notes:
  - Add a `water.js` helper for a simple flow shader (or reuse an existing water shader from examples).
  - Ensure creek/lake scale and placement are configurable in the scene editor or level config.
- Acceptance criteria:
  - Lake and creek visually match the expected aesthetic, the creek visibly flows into the lake, and surrounding foliage growth reacts to increased moisture.
