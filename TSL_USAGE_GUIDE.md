# TSL (Three.js Shading Language) Usage Guide

## Common Pitfalls and Solutions

### 1. Uniform Node Wrapping

**❌ WRONG:**
```javascript
// Creating a uniform with THREE.Color
export const uAuroraColor = uniform(new THREE.Color(0x00FF99));

// Then wrapping it again in TSL code
const baseColor = vec3(uAuroraColor); // ERROR!
```

**✅ CORRECT:**
```javascript
// Creating a uniform with THREE.Color
export const uAuroraColor = uniform(new THREE.Color(0x00FF99));

// Use the uniform directly - it's already a node
const baseColor = uAuroraColor; // Correct!
```

**Explanation:** When you create a uniform with `uniform(new THREE.Color(...))`, the uniform itself becomes a TSL node that represents a color/vec3. Wrapping it again with `vec3()` or `color()` creates invalid nested nodes.

### 2. Material Color Properties

**❌ WRONG:**
```javascript
const mat = new PointsNodeMaterial({ color: 0xFFFFFF });
// ...
mat.colorNode = vec4(finalRGB, opacity).mul(color(mat.color)); // ERROR!
```

**✅ CORRECT:**
```javascript
const mat = new PointsNodeMaterial({ color: 0xFFFFFF });
// ...
mat.colorNode = vec4(finalRGB, opacity); // Correct!
// The material's .color property is handled internally
```

**Explanation:** Material properties like `mat.color` are THREE.Color objects used for fallback values. Don't wrap them in `color()` nodes and multiply - the material system handles this automatically.

### 3. Number vs Float in TSL

**❌ WRONG:**
```javascript
const value = someNode.mul(2.0); // Raw number
```

**✅ CORRECT:**
```javascript
const value = someNode.mul(float(2.0)); // Wrapped in float()
```

**Explanation:** When using TSL operators like `mul()`, `add()`, etc., all operands should be nodes. Wrap raw numbers with `float()`.

## Quick Reference

### When to use uniform()
- When you need a value that can be updated from JavaScript
- Always pass THREE.js objects (THREE.Color, THREE.Vector3, etc.) to uniform()
- Example: `export const uTime = uniform(0.0);`

### When to use color()
- When creating a new color node from a hex value or RGB components
- Example: `const myColor = color(0xFF0000);`
- Example: `const myColor = color(r, g, b);`

### When to use vec3()
- When creating a new 3D vector node from components
- Example: `const pos = vec3(x, y, z);`
- Example: `const offset = vec3(float(0.0), height, float(0.0));`

### When to use float()
- When wrapping raw numbers for TSL operations
- Example: `const scaled = value.mul(float(2.0));`

## Debugging Tools

### Console Commands
```javascript
// Scan the scene for TSL errors
window.scanForTSLErrors();

// Validate scene materials
window.debugScene();
```

### Auto-Scan
The diagnostics system automatically scans for errors 2 seconds after initialization. Check the console for warnings.

### Common Error Messages

**"aNode.getNodeType is not a function"**
- You're passing something that isn't a proper TSL node
- Check for unwrapped numbers or incorrectly wrapped uniforms

**"properties.nodes is not iterable"**
- A node property expects an array but received something else
- Usually indicates a type mismatch in node construction

## Best Practices

1. **Always wrap numbers in float()**
   ```javascript
   const result = nodeA.add(float(5.0)); // Good
   const result = nodeA.add(5.0);        // Bad
   ```

2. **Use uniforms directly after creation**
   ```javascript
   const uColor = uniform(new THREE.Color(0xFF0000));
   material.colorNode = uColor; // Good
   material.colorNode = color(uColor); // Bad
   ```

3. **Enable DEV_MODE for validation**
   ```javascript
   // In common.js
   const DEV_MODE = true; // Enables runtime validation
   ```

4. **Check console during development**
   - The auto-scan will catch most issues
   - Fix errors as they appear to prevent shader compilation failures

## Related Files
- `src/utils/tsl-diagnostics.js` - Main diagnostic tools
- `src/utils/debug-helpers.js` - Additional validation helpers
- `src/foliage/common.js` - Material creation helpers with validation
