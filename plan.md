Status: Implemented ✅
We have finished the startup improvements.
- Loading phases reweighed and `shader-warmup` removed.
- `enterWorld` logic wrapped in robust `try...finally` to fix the `isGenerating` race condition.
- `getHeightmapBatch` implemented and integrated into ground geometry deformation loop to drastically reduce synchronous WASM calls.
Next Step: Move on to Wave 3 optimizations or address memory allocation efficiency on WASM boundary.
