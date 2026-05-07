# MOD-Driven Mapping (Leveraging Tracker Precision)

- Note-Level Precision Mapping: Use MOD note value and velocity to trigger specific morphs or node responses (exact pitch → unique animation state; velocity → emission/visual radius).
- Instrument-Specific Architecture: Map channels to plant organ types (bass→vines, melody→flowers, hi-hat→seed popping, arpeggios→spiral fronds, vibrato→stem tremor). Store instrument metadata (decay, displacement, color hints) alongside instrument definitions.
- Temporal Sequencing & Prediction: Use the MOD player's row callback for lookahead (1-2 rows) to render ghost pre-glows and to queue long fades or slides (portamento) so visuals are rhythmically anticipatory and deterministic.
- Structural Visualization: Use morphological blendshapes driven by pattern/row (verse vs chorus states), and render inter-instrument filaments/bridges to show counterpoint.
- Camera Integration: Assign camera moves to empty MOD channels for choreographed cinematography and use row-accurate triggers to drive focus pulls, dolly moves, and macro-shot timing.
- Performance & Efficiency: Drive large sets of plants via instanced vertex shader animation, with a uniform buffer representing current row's note stack and compact per-instance parameters (phase, channel, species id).

Implementation Notes & Acceptance
--------------------------------

- Hook into the MOD player's row callback as the canonical timing source (row frequency ~50-60Hz). Emit `noteOn`, `noteOff`, `patternBoundary`, and `slide` events to the reactivity system.
- Provide a `modVisualizer` subsystem that translates tracker events into compact uniform data for shaders (e.g., top-N active notes, channel intensities, slide endpoints).
- Acceptance criteria:
  - Musical events (notes, slides, volume changes) are visually synchronized to tracker rows with lookahead-based pre-glows.
  - Macro-shot POC: a stamen portamento sequence with matching color morphing and trailing spores, timed from MOD data, plays back reliably.
