## 2025-12-20 - [GC Pressure in Animation Loop]
**Learning:** Three.js applications often create hidden GC pressure by instantiating objects (Vectors, Colors, Maps) inside the `animate` loop.
**Action:** Always check `animate` loops for `new Class()` calls. Hoist these to module scope or reuse existing objects.
