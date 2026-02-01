# WebGPU Renderer clippingPlanes Fix

## Problem

The WebGPURenderer in Three.js 0.171.0+ can crash during shader compilation if `clippingPlanes` properties are undefined on the scene, objects, or materials. The error occurs in `setupHardwareClipping`:

```
TypeError: Cannot read properties of undefined (reading 'length')
```

This happens when the renderer tries to check the length of `clippingPlanes` arrays that haven't been initialized.

## Solution

The fix ensures that `clippingPlanes` is initialized as an empty array on:

1. **The scene itself** - `scene.clippingPlanes = []`
2. **All objects in the scene** - via `scene.traverse()`
3. **All materials** - both single materials and multi-material arrays

### Implementation Location

The fix is implemented in `main.js` in the deferred shader pre-compilation section, right before the call to `renderer.compileAsync(scene, camera)` (around line 686-715).

### Code Changes

```javascript
// FIX: Initialize clippingPlanes on scene, objects, and materials
// This prevents "Cannot read properties of undefined (reading 'length')" errors
// in setupHardwareClipping during shader compilation
if (!scene.clippingPlanes) {
    scene.clippingPlanes = [];
}

scene.traverse((object) => {
    // Set clippingPlanes on all objects
    if (!object.clippingPlanes) {
        object.clippingPlanes = [];
    }
    
    // Set clippingPlanes on all materials
    if (object.material) {
        if (Array.isArray(object.material)) {
            // Handle multi-material objects
            object.material.forEach((mat) => {
                if (mat && !mat.clippingPlanes) {
                    mat.clippingPlanes = [];
                }
            });
        } else if (!object.material.clippingPlanes) {
            // Handle single material
            object.material.clippingPlanes = [];
        }
    }
});

console.log('[Deferred] Initialized clippingPlanes on scene, objects, and materials');
```

## Testing

A verification test was added at `verification/verify_clipping_planes.js` that validates:

1. Scene clippingPlanes initialization
2. Object clippingPlanes initialization
3. Single material clippingPlanes initialization
4. Multi-material clippingPlanes initialization
5. Nested object clippingPlanes initialization

All tests pass successfully.

## Impact

This fix prevents shader compilation crashes in WebGPU environments and ensures compatibility with Three.js 0.171.0+ without any breaking changes or performance impact. The initialization happens once during the deferred shader compilation phase, which is already an async background operation.

## Related

- Three.js version: 0.171.0
- WebGPU Renderer
- Shader compilation
- Hardware clipping planes
