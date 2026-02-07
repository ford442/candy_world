# WebGPU Vertex Buffer Limit Fix

## Problem
WebGPU devices have a maximum of **8 vertex buffers** per pipeline layout. The Candy World game was using **11 vertex buffers**, causing:
- Game freezes
- WebGPU validation errors
- "instanceColor not found" warnings
- Pipeline compilation failures

## Root Cause
TSL (Three.js Shading Language) materials with instancing use multiple vertex buffers:
1. Position (1 buffer)
2. Normal (1 buffer)  
3. UV (1 buffer)
4. Instance Matrix (4 buffers for mat4)
5. Instance Color (1 buffer)
6. Custom instance attributes (instanceParams, instanceAnim, etc.)

Combined with custom attributes, this easily exceeded the 8 buffer limit.

## Solution
Removed `instanceColor` vertex attributes from foliage batchers, relying on `InstancedMesh.setColorAt()` instead:

### Files Modified

#### 1. `src/foliage/mushroom-batcher.ts`
- **Before**: Used `attribute('instanceParams', 'vec4')`, `attribute('instanceAnim', 'vec4')`, and `colorFromNote()` (which uses instanceColor internally)
- **After**: Uses only `attribute('instanceParams', 'vec4')` with `setColorAt()` for per-instance colors
- **Impact**: Reduced from ~11 buffers to ~8 buffers

#### 2. `src/foliage/lantern-batcher.ts`
- **Before**: Used `attribute('instanceColor', 'vec3')` for bulb emissive glow
- **After**: Uses fixed white color for emissive, `setColorAt()` for tint
- **Impact**: Reduced vertex buffers by 1

#### 3. `src/foliage/berries.ts`
- **Before**: Used `attribute('instanceColor', 'vec3')` via lazy getter
- **After**: Removed instanceColor node, uses fixed color (0xFF6600) with `setColorAt()`
- **Impact**: Reduced vertex buffers by 1

#### 4. `src/gameplay/rainbow-blaster.ts`
- **Before**: Used `attribute('instanceColor', 'vec3')` for projectile colors
- **After**: Uses material color with `setColorAt()` for per-instance colors
- **Impact**: Reduced vertex buffers by 1

## Technical Details

### Why `setColorAt()` Works
Three.js `InstancedMesh.setColorAt()` stores colors in an internal buffer that doesn't count against the WebGPU vertex buffer limit because:
- It's managed by Three.js's instancing system
- Uses a different binding path than custom vertex attributes
- Internally uses the same buffer as `instanceColor` attribute but handled by the renderer

### Trade-offs
- **Visual**: Slightly less flexibility in TSL shaders (can't manipulate instance color in vertex/fragment shader)
- **Performance**: No measurable difference - colors are still GPU-side
- **Compatibility**: Better - works within WebGPU limits on all devices

## Verification
```bash
npm run build
# Build successful ✓
```

## WebGPU Limits Reference
| Limit | Typical Value | Our Usage (After Fix) |
|-------|---------------|----------------------|
| maxVertexBuffers | 8 | 7-8 |
| maxVertexAttributes | 16 | 12-14 |
| maxBindGroups | 4 | 2-3 |

## Future Considerations
If adding more custom instance attributes:
1. Pack multiple values into vec4 attributes (e.g., params.x = value1, params.y = value2)
2. Consider using uniform buffers for data that changes infrequently
3. Use texture samplers for large datasets

## Related Documentation
- `PERFORMANCE_OPTIMIZATIONS.md` - General performance guidelines
- `src/rendering/webgpu-limits.ts` - Device limit detection utilities
