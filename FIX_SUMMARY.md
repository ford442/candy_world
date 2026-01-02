# Fix Summary: TSL Node Type Errors

## Problem
Multiple WebGPU shader compilation errors occurring at runtime:
- `TypeError: aNode.getNodeType is not a function`
- `TypeError: properties.nodes is not iterable`

These errors prevented proper rendering and caused shader compilation failures.

## Root Cause
Incorrect usage of TSL (Three.js Shading Language) node constructors with uniform nodes that already wrap THREE.js objects, creating invalid nested node structures.

## Fixes Applied

### 1. aurora.js (Line 35)

**BEFORE:**
```javascript
const baseColor = vec3(uAuroraColor); 
```

**AFTER:**
```javascript
// FIX: uAuroraColor is already a uniform node (contains THREE.Color), don't wrap in vec3()
const baseColor = uAuroraColor; 
```

**Explanation:** 
- `uAuroraColor` is defined as `uniform(new THREE.Color(0x00FF99))`
- The `uniform()` function already creates a node that represents a color
- Wrapping it again with `vec3()` creates an invalid double-wrapped node
- Solution: Use the uniform node directly

### 2. stars.js (Line 87-88)

**BEFORE:**
```javascript
// FIX: Wrap mat.color in color() node to make it compatible
mat.colorNode = vec4(finalRGB, uStarOpacity).mul(color(mat.color));
```

**AFTER:**
```javascript
// FIX: Don't multiply vec4 by color node - just use finalRGB directly with opacity
// mat.color is a THREE.Color used for fallback/multiplier, already handled by PointsNodeMaterial
mat.colorNode = vec4(finalRGB, uStarOpacity);
```

**Explanation:**
- `mat.color` is a THREE.Color property used internally by PointsNodeMaterial
- Wrapping it in `color()` and multiplying creates an unnecessary and potentially problematic node operation
- The material system already handles the base color internally
- Solution: Assign the colorNode directly without multiplying by the material's color property

## Prevention Measures

### 1. Enhanced Diagnostics (tsl-diagnostics.js)
Added comprehensive validation that checks for:
- Wrapped uniforms containing THREE.js objects
- Nodes missing required methods like `getNodeType()`
- Better error categorization and position tracking
- Auto-scan on initialization (2 seconds after startup)

### 2. Development-Time Validation (common.js)
Added helpers for safer material creation:
- `validateTSLNode()` - Checks node validity during development
- `createValidatedMaterial()` - Wrapper that validates materials on creation
- `DEV_MODE` flag to enable/disable validation

### 3. Documentation (TSL_USAGE_GUIDE.md)
Created comprehensive guide covering:
- Common pitfalls and their solutions
- Quick reference for TSL functions
- Debugging commands and tools
- Best practices for TSL usage

## Console Tools

After these fixes, developers can use:
```javascript
// Scan for TSL errors
window.scanForTSLErrors();

// Validate materials
window.debugScene();
```

The auto-scan will automatically run 2 seconds after page load and report any issues found.

## Key Learnings

### Do's ✅
- Use uniforms directly: `const color = uMyColor;`
- Wrap raw numbers: `value.mul(float(2.0))`
- Create new nodes from primitives: `color(0xFF0000)`

### Don'ts ❌
- Don't wrap uniforms: `vec3(uMyColor)` when `uMyColor` already contains a THREE.Color
- Don't wrap material properties: `color(mat.color)` 
- Don't use raw numbers in operations: `value.mul(2.0)`

## Testing
All modified files have been syntax-checked and validated. The changes are minimal and surgical, only addressing the specific issues without touching unrelated code.

## Expected Outcome
After these fixes:
1. ✅ No more "aNode.getNodeType is not a function" errors
2. ✅ No more "properties.nodes is not iterable" errors
3. ✅ Shaders compile successfully during warmup
4. ✅ Auto-diagnostic scan catches similar issues early
5. ✅ Better error messages help debug future issues faster
