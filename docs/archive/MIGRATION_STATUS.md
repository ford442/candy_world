# Candy World Migration Status (archived)

> **This document is outdated.**  
> **Current version:** [`/MIGRATION_STATUS.md`](../../MIGRATION_STATUS.md) (root, updated 2026-07-08)  
> **Tracker:** [`/MIGRATION_TRACKER.md`](../../MIGRATION_TRACKER.md)

The April 2026 snapshot below is kept for historical reference only.

---

# Candy World Migration Status

> **Last Updated:** 2026-04-07  
> **Migration Path:** JavaScript → TypeScript → AssemblyScript → C++ → WebGPU

*(Original content preserved below.)*

---

## 1. Migration Overview

This document tracks the progressive optimization migration of the Candy World codebase through multiple performance tiers.

### Migration Layers

| Layer | Technology | Responsibility | Performance Target |
|-------|------------|----------------|-------------------|
| **Tier 0** | JavaScript (ES6+) | Legacy fallback, UI logic | Baseline |
| **Tier 1** | TypeScript | Type-safe application layer, systems | Maintainable |
| **Tier 2** | AssemblyScript | WASM modules for physics, animation, batching | 5-10x faster |
| **Tier 3** | C++ / Emscripten | Heavy compute, OpenMP parallelization | 10-50x faster |
| **Tier 4** | WebGPU Compute | GPU-accelerated physics, particles, mesh deformation | 100x+ faster |

---

## Historical note

All items marked **IN PROGRESS** in the 2026-04-07 version (e.g. `wasm-loader.js`, `init.js`, duplicate utils) were completed by 2026-07. See the root [`MIGRATION_STATUS.md`](../../MIGRATION_STATUS.md) for current tier tables, wasm-loader split, C++ export inventory, and links to issues [#1326](https://github.com/ford442/candy_world/issues/1326)–[#1330](https://github.com/ford442/candy_world/issues/1330).
