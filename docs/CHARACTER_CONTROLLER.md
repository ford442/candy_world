# Character Controller

Candy World operates a hybrid WASM dual-architecture physics stack where character locomotion rules may act differently depending on the context. As part of `#1577`, formalizing the first-person character controller brings predictable edge cases (stairs, ramps, ledge grace).

## Existing Stack Architecture

*   **C++ Execution (off-lake):** Most of the environment operates purely using the C++ native `updatePhysicsCPP` pipeline, calling the engine across the WASM boundary to get `PlayerState` variables (`isGrounded`, velocity, position vectors).
*   **JS Fallback Execution (in-lake):** Explicitly when inside the Melody Lake Basin, C++ execution is avoided. Instead of utilizing WASM bindings, standard JavaScript is evaluated, and the terrain height is queried via an integrated ground height query function (`getGroundHeight`). The `CharacterController` sits specifically here for `PlayerState.DEFAULT`.

## Logic and Tuning Constants

Locomotion is smoothed through these variables (editable through `CONFIG.player`):
*   **`coyoteTimeMs` (100):** After falling off a ledge, how long can the player jump mid-air gracefully.
*   **`jumpBufferMs` (100):** While mid-air, the amount of milliseconds ahead of touching the ground to buffer a jump. Once touched, jump automatically is consumed.
*   **`stepHeight` (0.35):** Maximum world unit delta height to automatically step-up (like candy cobble stones) without jumping. Steps taller than this reject movement on the forward axis.
*   **`skinWidth` (0.05):** Minimum displacement size appended to ground-snap checks so that the character doesn't buzz between `isGrounded` state transitions rapidly.
*   **`airAccel` (5.0):** Slower acceleration variant to be used whenever the player isn't grounded, to implement classic candy-floaty feel without strict quake-like air-accelerate.

## Slope Slide limit
`CONFIG.ground.maxSlopeAngle` specifies the walkable limit `(25 * Math.PI) / 180`. Any surface angled steeper triggers a physics slide vector downhill.

Note:
*   Ability hooks (Vine, Dash, Dodge, etc.) modify velocity sequentially and run *before* the Character Controller evaluation logic so inputs can process their specific effects properly.
*   The `reconcileGroundedEyeY` call runs as a second pass right after character-controller update to perform ground elevation smooth lerping to fix residual error tracking.
