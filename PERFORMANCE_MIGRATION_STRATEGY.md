# Performance Migration Strategy & Optimization Formula (Refined)

**Goal:** Move performance-critical code down the stack only when proven necessary.

## 🎯 The Optimization Pipeline (Decision Tree)
| Tier | Environment | When to Use It | Migration Threshold | Agent Flag |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **JavaScript (ES6+)** | Default. DOM, events, orchestration. | < 2ms/frame | N/A |
| **2** | **TypeScript (Strict)** | Complex state, type safety needed. | Logic errors > 5% | `@refactor ts` |
| **3** | **AssemblyScript (WASM)** | Hot loops: math on >1k items. | > 3ms/frame | `@optimize asc` |
| **4** | **C++ (WASM)** | Extreme scale: >5k entities. | > 8ms/frame | `@optimize cpp` |

## 🎯 Current Migration Queue (Prioritized)

### Priority A: Hot Loops (Migrate to WASM)
| Function | File | Profile Data | Target | Status |
| :--- | :--- | :--- | :--- | :--- |
| `animateFoliage` | `src/foliage/animation.ts` | 4.2ms/frame | `assembly/foliage.ts` | **Done (Hybrid)** |
| `updateParticles` | `src/foliage/fireflies.js` | 5.1ms/frame | `assembly/particles.ts` | **Pending** |

### Priority B: Type Safety (Migrate to TS)
| Function | File | Status |
| :--- | :--- | :--- |
| `createFloweringTree` | `src/foliage/trees.ts` | **Done** |
| `generateMap` | `src/world/generation.ts` | **Done** |

### Priority C: Complex Algorithmic Optimization (Tier 1)
| Function | File | Challenge |
| :--- | :--- | :--- |
| `updatePhysics` | `src/systems/physics.js` | **BLOCKER:** Needs Spatial Hashing (Grid/Octree) implemented in JS *before* any WASM migration. |
