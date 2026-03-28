## 2024-06-25 - Object Allocation Spikes During Audio Reactivity
**Learning:** High-frequency event triggers tied to gameplay logic (like `handleAbilities` reacting to beat triggers) can generate GC spikes if they use inline instantiations or methods that implicitly return new objects (e.g. `Vector3.clone()`).
**Action:** Replaced `.clone().add()` chains with `.copy().add()` using pre-allocated module-level scratch vectors to maintain a zero-allocation profile during interaction checks.
