# Performance Migration Strategy (Hybrid Sandwich Pattern)

## Executive Summary
**Primary Goal:** Maintain a flexible **JavaScript layer** for rapid feature prototyping while migrating only the hottest **15%** of code to TypeScript or WASM per iteration.

**The "Sandwich" Philosophy:**
1.  **Top Layer (JS):** New features, orchestration, and "draft" logic. Always exists.
2.  **Middle Layer (TS):** Stable logic and complex interfaces.
3.  **Bottom Layer (WASM):** Heavy math loops (Physics/Particles).

**Critical Constraint:**
Never migrate 100% of a file in one go. Leave "Stub" JS files (or keep the file hybrid) to ensure we always have a low-friction place to add new gameplay mechanics (foliage, celestial bodies) without fighting the compiler.

---

## The 15% Rule (Incremental Migration)

**Do not "Boil the Ocean".**
When tasked with a migration or refactor, strict limits apply:

* **Cap Effort:** Migrate only ~15% of the file/module per pass. Focus on the single most computationally expensive function.
* **Leave the Rest:** If a file has 10 functions, and only 1 is a hotspot, migrate that 1 function and **leave the other 9 in JavaScript**.
* **Generous Timeline:** Optimization is a marathon, not a sprint. Do not attempt to "finish" a migration in a single PR.

---

## Stub Retention Policy (Keep JS Alive)

We typically **do not rename** `.js` files to `.ts` entirely. Instead, we extract the "Hardened" logic and leave the JS file as the **Orchestrator** or **Drafting Ground**.

### Pattern: The "Drafting Ground"
When optimizing `foliage.js`:

1.  **Don't:** Rename `foliage.js` -> `foliage.ts` and fix 500 type errors.
2.  **Do:**
    * Create `foliage.core.ts` (or `assembly/foliage.ts`) for the math-heavy `animate()` function.
    * **KEEP** `foliage.js` as the controller.
    * `foliage.js` now imports the optimized function but retains all other logic (spawning, configuration, new experimental features).

**Why?**
Next week, when we want to add "Alien Mushrooms," we can write them quickly in `foliage.js` without recompiling WASM or defining strict interfaces first.

---

## Migration Trigger Ladder

| Tier | File Type | Role | When to Move Logic Here |
| :--- | :--- | :--- | :--- |
| **1** | **JavaScript (`.js`)** | **Default.** Prototyping, orchestration, rare events. | New features start here. |
| **2** | **TypeScript (`.ts`)** | **Stability.** Data models, config definitions, core logic. | Logic is "stable" (unchanged for 2 weeks) or buggy. |
| **3** | **AssemblyScript (`.ts`)** | **Performance.** Hot loops > 3ms/frame. | **Top 15%** of hotspots only. |
| **4** | **C++ (`.cpp`)** | **Heavy Metal.** SIMD, Threads. | **Top 1%** of hotspots (Last Resort). |

---

## Operating Rules for Jules/Copilot

### 1. The "15% Cap"
If asked to "optimize physics," **do not** rewrite the entire physics engine.
* **Identify:** Find the ONE function taking the most time (e.g., `checkCollisions`).
* **Extract:** Move ONLY that function to TS/WASM.
* **Retain:** Leave `updatePositions`, `handleInputs`, and `debugDraw` in JS.

### 2. Stub Preservation
* **Never delete the JS entry point.**
* If migrating `logic.js`, ensure `logic.js` remains exists and acts as the "glue" that calls your new optimized code.
* *Comment for Agent:* "I have left `logic.js` in place so you can easily add new game mechanics there later."

### 3. Proof of Perf
* Before moving even that 15%, provide a profile screenshot showing it is necessary.

---

## Example Workflow: "Adding Celestial Bodies"

1.  **Phase 1 (JS):** Write `celestial.js`. It handles movement, drawing, and gravity. (It runs slow, but works).
2.  **Phase 2 (Partial TS):** Gravity math is buggy. Extract *just* the math to `celestial-math.ts`. `celestial.js` imports it.
3.  **Phase 3 (Partial WASM):** We have 10,000 bodies. Move *just* the loop to `assembly/celestial.ts`.
4.  **Result:** `celestial.js` still exists! You can now open it and add "Comet Trails" in 5 minutes using simple JS, without touching the WASM core.
