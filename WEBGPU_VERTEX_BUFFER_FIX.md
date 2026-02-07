# WebGPU Vertex Buffer Limit Fix

## Problem
WebGPU devices have a maximum of **8 vertex buffers** per pipeline layout. The Candy World game was exceeding this limit, causing:
- Game freezes
- WebGPU validation errors: `Vertex buffer count (11) exceeds the maximum number of vertex buffers (8)`
- Pipeline compilation failures

## Vertex Buffer Accounting

Each InstancedMesh uses these vertex buffers:
| Buffer | Count | Notes |
|--------|-------|-------|
| position | 1 | Geometry vertices |
| normal | 1 | Vertex normals |
| uv | 1 | Texture coordinates |
| instanceMatrix | 4 | Instancing transform (mat4) |
| instanceColor | 1 | Per-instance color (if setColorAt used) |
| **Base Total** | **8** | **At the limit!** |

Any **custom instance attribute** adds to this and exceeds the limit.

## Solution Applied

### 1. Mushroom Batcher (`mushroom-batcher.ts`)
**Before**: 2 vec4 attributes = 2 extra buffers
- `instanceParams` (vec4): hasFace, noteIndex, isGiant, spawnTime
- `instanceAnim` (vec4): triggerTime, velocity

**After**: 1 vec4 attribute = 1 buffer
- `instanceData` (vec4): packed, spawnTime, triggerTime, velocity
- Packed encoding: `packedFlags = (noteIndex+1) + hasFace*20 + isGiant*40`
- Shader unpacks: `hasFace = floor(packed/20) % 2`, `isGiant = floor(packed/40) % 2`

### 2. Lantern Batcher (`lantern-batcher.ts`)
**Before**: 2 attributes
- `instanceParams` (vec4)
- `instanceColor` (vec3)

**After**: 1 attribute
- `instanceParams` (vec4) only
- Colors moved to `setColorAt()` on InstancedMesh

### 3. Berry System (`berries.ts`)
**Before**: Lazy `instanceColor` attribute getter
**After**: Fixed color with `setColorAt()`

### 4. Rainbow Blaster (`rainbow-blaster.ts`)
**Before**: `instanceColor` attribute on geometry
**After**: Material base color with `setColorAt()`

## Remaining Custom Attributes
These use only 1 float each (acceptable):
- `arpeggio-batcher.ts`: `instanceUnfurl` (float)
- `portamento-batcher.ts`: `instanceBend` (float)
- `lantern-batcher.ts`: `instanceParams` (vec4)
- `mushroom-batcher.ts`: `instanceData` (vec4)

## Verification
```bash
npm run build
# ✓ 88 modules transformed.
# ✓ built in 8.29s
```

## Future Guidelines
When adding new instanced foliage:
1. **Use `setColorAt()`** instead of `instanceColor` attribute
2. **Pack multiple flags** into a single float/vec4
3. **Avoid more than 1 custom attribute** per InstancedMesh
4. **Test on WebGPU** - the limit is strict (8 buffers)

## Debugging Tips
If you see `Vertex buffer count (X) exceeds the maximum number of vertex buffers (8)`:
1. Count attributes in your material's TSL code
2. Check `geometry.attributes` for extras
3. Remember: `instanceMatrix` = 4 buffers, `instanceColor` = 1 buffer
4. Use `setColorAt()` instead of custom color attributes
