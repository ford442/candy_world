1. **Optimize `findNearby` in `PhysicsSpatialGrid`**
   - File: `src/systems/physics/physics-core.ts`
   - Issue: Using a `Set` for deduplication every frame causes GC spikes in `_querySet.clear()` and `_querySet.add()` for high-frequency queries.
   - Fix: Replace the `Set` with an incrementing query ID tag on objects (e.g., `obj.userData._lastQueryId`).
   - Implementation:
     ```typescript
     let physicsQueryId = 0;
     ```
     Inside `findNearby`:
     ```typescript
     physicsQueryId++;
     this._queryResult.length = 0;
     // ... loops
     const obj = cell[i];
     if (!obj.userData) obj.userData = {};
     if (obj.userData._lastQueryId !== physicsQueryId) {
         obj.userData._lastQueryId = physicsQueryId;
         this._queryResult.push(obj);
     }
     ```
     Actually, since `PhysicsSpatialGrid` is generic `any[]`, adding `userData` assumes `THREE.Object3D`. We can just use a unique symbol or `_lastQueryId` directly on the object.
     ```typescript
     let globalQueryId = 0;

     class PhysicsSpatialGrid {
         findNearby() {
             globalQueryId++;
             this._queryResult.length = 0;
             // ...
             if (obj._lastQueryId !== globalQueryId) {
                 obj._lastQueryId = globalQueryId;
                 this._queryResult.push(obj);
             }
         }
     }
     ```
     This completely eliminates `Set` allocation and clearing overhead.

2. **Optimize Math in `waterfall-batcher.ts`**
   - File: `src/foliage/waterfall-batcher.ts`
   - Issue: `updateInstance` uses `Math.sqrt` in a hot loop.
   - Fix: Import `fastInvSqrt` from `../utils/wasm-loader.ts` and replace:
     ```typescript
     const ratio = Math.sqrt(scaleXSq / currentScaleZSq) * thicknessScale;
     ```
     With:
     ```typescript
     // Math.sqrt(scaleXSq / currentScaleZSq) = Math.sqrt(scaleXSq) * fastInvSqrt(currentScaleZSq)
     // To strictly eliminate Math.sqrt:
     // If we really need sqrt(scaleXSq), we might still need one sqrt, or we can approximate it.
     // Alternatively, we could just do:
     // const invRatio = fastInvSqrt(scaleXSq / currentScaleZSq);
     // const ratio = (1.0 / invRatio) * thicknessScale;
     // Wait, 1.0 / invRatio is the same speed as Math.sqrt, probably. Let's just use fastInvSqrt on the denominator:
     const ratio = scaleXSq * fastInvSqrt(scaleXSq * currentScaleZSq) * thicknessScale; // since sqrt(x/y) = sqrt(x)/sqrt(y) = x / sqrt(x*y)
     ```
     Actually, `ratio = scaleXSq * fastInvSqrt(scaleXSq * currentScaleZSq)` is equivalent to `Math.sqrt(scaleXSq / currentScaleZSq)`. Let's use this!

3. **Check `culling-system.ts` for object array iteration**
   - Just confirm there's no `Array.from` or `filter` left that I can fix easily. I checked it earlier, the scratch arrays are already used.

4. **Verify changes and Submit**
