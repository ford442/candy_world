# Performance Migration Strategy (JS → TS → ASC/WASM → C++/WASM)

## Executive Summary (Read First)
**Primary goal:** migrate performance-critical code down the stack **only when justified by evidence**.

**Migration ladder (in order):**
1. **JavaScript (JS)** → default runtime and orchestration
2. **TypeScript (TS)** → correctness, maintainability, and deopt prevention
3. **AssemblyScript (ASC → WASM)** → proven hot loops on typed arrays
4. **C++ (Emscripten → WASM)** → last resort for SIMD/memory-bound workloads at extreme scale

**Non-goals:**
- We are **not** rewriting the codebase in TS/WASM “because faster.”
- We are **not** moving code to WASM without profiling proof.
- We are **not** debugging complex C++ WASM issues in production. If it’s fragile, revert.

**Two hard gates:**
- **Promote only with proof:** a profile capture (screenshot or trace) showing the function’s self-time.
- **Revert if not worth it:** if migrated code is **< 5% faster** or increases bundle size **> 150kb**, revert to the previous tier.

---

## Terms (Use Consistently)
- **Tier:** one rung in the ladder (JS, TS, ASC/WASM, C++/WASM).
- **Promote:** move code **down** the ladder (toward lower-level).
- **Revert / Downgrade:** move code **up** the ladder (toward higher-level), restoring simplicity.

## Default Iteration Plan (Always / Sometimes / Rarely)

This project improves performance continuously, but **does not** automatically promote code down the ladder. Each iteration should include work from multiple layers **without forcing migration**.

### ALWAYS (every PR / sprint)
- **Step 0: Profile-first discipline**
  - Capture a profile trace or screenshot for the area being worked on.
  - Add/update `@perf-profile` annotations for any hotspot discussed.
- **Architecture foundation**
  - Keep/expand the **interface + adapter** boundary so implementations can be swapped cleanly.
  - Improve batching/orchestration on the JS side (reduce calls/frame, reduce allocations).
- **Step 1: TS correctness upgrades where relevant**
  - Convert touched JS modules to TS *when it reduces bugs or clarifies contracts*.
  - Tighten types, remove `any`, and keep `--strict` passing.

### SOMETIMES (only with evidence)
- **Step 2: ASC/WASM promotion**
  - Promote **only** the **top hotspot loop(s)** proven by profiling (>3ms self-time and high iteration count).
  - Must include batching (≤ 3 WASM calls/frame) and an A/B result.
  - Revert if <5% win or bundle +150kb.

### RARELY (only when ASC is proven insufficient)
- **Step 3: C++/WASM spike**
  - Only after ASC is implemented and still blocked by SIMD/memory-bound constraints.
  - Do it behind a feature flag with a fast revert path.
  - Do not debug fragile C++ WASM issues in production—revert to ASC/TS.
 
  
## The Migration Ladder (Decision Tree)

### Quick Decision Checklist
Stay at the current tier unless **all** promotion criteria for the next tier are met.

1) **JS → TS (correctness gate)**
- Promote when: repeated runtime bugs / `undefined` issues / complex object shapes causing deopts
- Evidence: bug count, crash logs, or profiler showing deopt-heavy code (optional)

2) **TS → ASC/WASM (hot loop gate)**
- Promote when:
  - profiler shows **> 3ms/frame self-time** in a loop, and
  - workload is array/number heavy, and
  - **> 500 iterations/frame** (or equivalent scale)
- Evidence required: profiler screenshot/trace identifying the function’s self-time

3) **ASC/WASM → C++/WASM (last resort gate)**
- Promote when:
  - profiler shows **> 8ms/frame**, and
  - ASC solution is memory-bound or needs SIMD / tighter control, and/or
  - memory allocation thrash is present
- Evidence required: profiler + notes why ASC is insufficient

### Tier Table (Reference)
WASM calls have overhead (~0.5ms/call). Small functions may run slower after migration.

| Tier | Environment | Default Use | Promote to Next Tier When… | Agent Flag |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **JavaScript (ES6+)** | DOM/events/orchestration | correctness or complexity demands TS, or perf still high after JS optimization | N/A |
| **2** | **TypeScript (Strict)** | complex state/config, safer refactors | **> 3ms/frame** in hot array loop + **> 500 iters/frame** | `@refactor ts` |
| **3** | **AssemblyScript (WASM)** | proven hot loops on typed arrays | **> 8ms/frame** + SIMD/memory-bound/alloc thrash needs | `@optimize asc` |
| **4** | **C++ (Emscripten WASM)** | extreme scale + SIMD | stop here (lowest tier) | `@optimize cpp` |

---

## Architecture Rule: Interface-First + Adapters (Mandatory)
**Goal:** decouple gameplay logic from implementation so we can swap backends (JS ↔ TS ↔ WASM ↔ C++) without rewriting consumers.

### 1) Define the Contract (TypeScript Interface)
- Create strict interfaces (e.g. `src/interfaces/IPhysicsEngine.ts`).
- Interfaces **must not** expose:
  - memory offsets
  - pointers
  - glue-specific details
- Data transfer should be abstract and stable (e.g., returning `Float32Array` views).

### 2) Adapter Pattern (Implementation Isolation)
- **LegacyAdapter (JS/TS):** wraps current logic and implements the interface.
- **WasmAdapter (ASC or C++):** talks to the WASM backend.
- Consumers select at init:
  - `const physics = useWasm ? new WasmPhysicsAdapter() : new LegacyPhysicsAdapter();`
- **Rule:** All glue (copies, `SharedArrayBuffer` views, offsets) lives inside adapters.

### 3) Future-Proofing
This structure maps to the **WASM Component Model**: adapters become standardized bindings later.

---

## Operating Rules for Jules/Copilot (Agent Contract)

### Agent Must
- **Profile first** and attach proof before promoting tiers.
- Keep the **interface + adapter** boundary intact.
- Prefer **batching** over multiple WASM calls.

### Agent Must Not
- Migrate code to WASM “just in case.”
- Introduce object-heavy bridging across JS/WASM boundaries.
- Leave half-migrated code paths without a clean fallback.

### Performance Constraints (Hard)
- **WASM call budget:** max **3 WASM calls per frame** (batch when needed).
- **Revert policy:** revert if < **5%** faster or bundle size grows > **150kb**.
- **C++ debugging constraint:** if C++ WASM becomes fragile, revert to ASC/TS; do not sink time into production C++ debugging.

### Platform Constraints
- **SharedArrayBuffer** requires COOP/COEP headers; test on production domain before relying on SAB.

---

## Migration Protocol (Playbook)

### Step 0 — Profile First (MANDATORY)
**Tools:** Chrome DevTools → Performance  
**Look for:**
- Long Task (>50ms)
- frequent function calls
- GC pauses
- self-time hotspots

**Rule:** No promotion without a profile screenshot/trace showing the function’s self-time.

---

### Step 1 — Promote JS → TS (Correctness / Maintainability)
**Trigger:** complex objects, repeated `undefined` crashes, hard-to-refactor logic.

**Actions:**
1. Rename `.js` → `.ts`.
2. Enable strictness (or confirm it): `tsc --noEmit --strict`.
3. Remove implicit `any`; add types/interfaces (e.g., configs, component shapes).
4. Re-profile (type safety can reduce V8 deopts).

**Definition of Done:**
- TS compiles in strict mode
- consumer API unchanged
- any performance regressions are measured (or explained)

---

### Step 2 — Promote TS → ASC/WASM (Hot Loops on Typed Arrays)
**Trigger:** profiler shows **>3ms/frame self-time** in a loop over arrays with **>500 iterations/frame**.

**Pre-requisite (MANDATORY):**
- System is accessed through an `I[System]` interface.
- Current implementation is wrapped behind a `LegacyAdapter`.

**Actions:**
1. **Refactor boundary:** ensure the interface exists and gameplay uses the interface only.
2. Move compute-heavy logic into `assembly/` as `export function ...`.
3. Use only flat data:
   - TypedArrays only (`Float32Array`, `Int32Array`, etc.)
   - **Struct-of-Arrays** pattern (no objects)
4. Measure overhead and avoid chatty calls:
   - batch inputs in JS
   - call WASM once per frame per type (e.g., `FoliageBatcher`)
5. Update loader/bindings accordingly.

**A/B Test Rule:**
- If WASM version is not **> 5% faster**, revert.

**Definition of Done:**
- Interface + adapters in place
- batching implemented (≤ 3 calls/frame)
- benchmark recorded and decision documented (keep or revert)

---

### Step 3 — Promote ASC/WASM → C++/WASM (Last Resort)
**Trigger:** profiler shows **>8ms/frame**, ASC is memory-bound or needs SIMD / allocation control.

**Actions:**
1. Define stable C ABI and minimal structs (e.g., `emscripten/include/entity.h`).
2. Export functions with `EMSCRIPTEN_KEEPALIVE`.
3. Prefer raw pointers and lengths (flat arrays):
   - `float* positions`, `int length`
4. Enable SIMD: add `-msimd128` to build flags/script.
5. Call from JS via `Module.ccall(...)` or embind (keep it minimal).

**Fallback:**
- If build becomes fragile or runtime crashes: revert to ASC. Do not debug C++ in prod.

**Definition of Done:**
- measurable perf win (>5%)
- stable build + runtime
- clean fallback path preserved

---

## Deliverables Checklist (By Tier Promotion)

### JS → TS deliverables
- `.ts` file(s) compiling with `--strict`
- new interfaces/types for configs and state
- zero `any` except explicitly justified

### TS → ASC deliverables
- `src/interfaces/I<Module>.ts`
- `src/adapters/Legacy<Module>Adapter.ts`
- `src/adapters/Wasm<Module>Adapter.ts`
- `assembly/<module>.ts` exports (typed arrays in/out)
- loader updates + batching
- A/B result recorded

### ASC → C++ deliverables
- minimal C header(s) + exported C functions
- build flags updated (SIMD if needed)
- JS glue isolated in adapter
- A/B result recorded + fallback verified

---

## Current Migration Queue (Driven by Profile Data)

### Priority A — Hot Loops (Promote to ASC/WASM)
| Function | File | Profile Data | Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| `animateFoliage` | `src/foliage/animation.ts` | 4.2ms/frame | `assembly/foliage.ts` | **Done (Hybrid)** |
| `updateParticles` | `src/foliage/fireflies.js` | 5.1ms/frame | `assembly/particles.ts` | **Pending** |

### Priority B — Type Safety (Promote to TS)
| Function | File | Issue | Action |
| :--- | :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.js` | 3 undefined bugs this sprint | Rename to `.ts`, add `FoliageConfig` interface |
| `generateMap` | `src/world/generation.js` | Logic complexity | Rename to `.ts`, strict mode | **Done** |

### Priority C — Research (Do NOT promote yet)
| Function | File | Blocker |
| :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.ts` | **Done** |
| `generateMap` | `src/world/generation.ts` | **Done** |

## Agent Annotation Standard (Machine-Readable)
Use these comments so automation can verify evidence and intent:

```javascript
// @perf-profile {selfTime: "4.2ms", frame: "animation", screenshot: "profile-001.png"}
// @perf-migrate {from: "ts", to: "asc", reason: "hot-loop", threshold: "3ms", callsPerFrameBudget: 3}
// @perf-result {delta: "+7.1%", kept: true, notes: "batched foliage into 1 call/frame"}
```

---

## Request Template (Copy/Paste for Jules/Copilot)
When asking an agent to do work, provide this:

- **Target function + file:**
- **Current tier:** (JS / TS / ASC / C++)
- **Proposed tier:**
- **Profiling proof:** (screenshot/trace name + self-time)
- **Workload scale:** (entities/particles/plants per frame)
- **Constraints:** (WASM calls/frame, bundle size limits)
- **Acceptance criteria:** (>5% win, no API break, fallback works)
