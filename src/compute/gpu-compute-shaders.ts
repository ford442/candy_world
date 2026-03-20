/**
 * @file gpu-compute-shaders.ts
 * @description WGSL compute shaders for mesh deformation, noise generation, and batch culling.
 *
 * All shaders follow std140 alignment rules. Uniform structs document padding.
 * Shaders are organized by function with shared utility code at the top.
 */

// =============================================================================
// SHARED WGSL UTILITIES
// =============================================================================

const WGSL_NOISE_UTILS = /* wgsl */ `
// --- Shared noise helpers ---

fn hash2(p: vec2<f32>) -> f32 {
    var h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

fn hash3v(p: vec3<f32>) -> vec3<f32> {
    var q = vec3<f32>(
        dot(p, vec3<f32>(127.1, 311.7, 74.7)),
        dot(p, vec3<f32>(269.5, 183.3, 246.1)),
        dot(p, vec3<f32>(113.5, 271.9, 124.6))
    );
    return fract(sin(q) * 43758.5453);
}

fn valueNoise2D(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);

    let a = hash2(i + vec2<f32>(0.0, 0.0));
    let b = hash2(i + vec2<f32>(1.0, 0.0));
    let c = hash2(i + vec2<f32>(0.0, 1.0));
    let d = hash2(i + vec2<f32>(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// =============================================================================
// 1. MESH DEFORMATION SHADERS
// =============================================================================

/**
 * Wave deformation compute shader.
 *
 * Uniforms layout (std140, 32 bytes):
 *   time:       f32   offset 0
 *   strength:   f32   offset 4
 *   frequency:  f32   offset 8
 *   audioPulse: f32   offset 12
 *   vertexCount: u32  offset 16
 *   _pad:       u32   offset 20  (align to 8)
 *   _pad2:      u32   offset 24
 *   _pad3:      u32   offset 28
 */
export const MESH_DEFORM_WAVE_WGSL = /* wgsl */ `
struct Uniforms {
    time: f32,
    strength: f32,
    frequency: f32,
    audioPulse: f32,
    vertexCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> originalPositions: array<f32>;
@group(0) @binding(1) var<storage, read_write> deformedPositions: array<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.vertexCount) { return; }

    let base = idx * 3u;
    let x = originalPositions[base];
    let y = originalPositions[base + 1u];
    let z = originalPositions[base + 2u];

    let wave = sin(x * u.frequency + u.time * 2.0) *
               cos(z * u.frequency + u.time * 2.0);
    let deformedY = y + wave * u.strength * (1.0 + u.audioPulse * 0.5);

    deformedPositions[base]      = x;
    deformedPositions[base + 1u] = deformedY;
    deformedPositions[base + 2u] = z;
}
`;

/**
 * Jiggle deformation compute shader.
 * Same uniform layout as wave.
 */
export const MESH_DEFORM_JIGGLE_WGSL = /* wgsl */ `
struct Uniforms {
    time: f32,
    strength: f32,
    frequency: f32,
    audioPulse: f32,
    vertexCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> originalPositions: array<f32>;
@group(0) @binding(1) var<storage, read_write> deformedPositions: array<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.vertexCount) { return; }

    let base = idx * 3u;
    let x = originalPositions[base];
    let y = originalPositions[base + 1u];
    let z = originalPositions[base + 2u];

    let offset = sin(u.time * 5.0 + y * 2.0) * u.strength * 0.1;
    let pulse = 1.0 + u.audioPulse;

    deformedPositions[base]      = x + offset * pulse;
    deformedPositions[base + 1u] = y;
    deformedPositions[base + 2u] = z + offset * cos(u.time * 5.0 + y * 2.0) * pulse;
}
`;

/**
 * Wobble deformation compute shader.
 * Same uniform layout as wave.
 */
export const MESH_DEFORM_WOBBLE_WGSL = /* wgsl */ `
struct Uniforms {
    time: f32,
    strength: f32,
    frequency: f32,
    audioPulse: f32,
    vertexCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> originalPositions: array<f32>;
@group(0) @binding(1) var<storage, read_write> deformedPositions: array<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.vertexCount) { return; }

    let base = idx * 3u;
    let x = originalPositions[base];
    let y = originalPositions[base + 1u];
    let z = originalPositions[base + 2u];

    // Wobble increases with height (y)
    let wobble = sin(u.time * 2.0 + y * 0.5) * u.strength * 0.05;
    let heightFactor = y / 5.0;
    let pulse = 1.0 + u.audioPulse * 0.3;

    deformedPositions[base]      = x + wobble * heightFactor * pulse;
    deformedPositions[base + 1u] = y;
    deformedPositions[base + 2u] = z;
}
`;

/**
 * Normal recalculation compute shader.
 * Runs after deformation to recompute per-vertex normals from triangle faces.
 *
 * Uniforms layout (8 bytes, padded to 16):
 *   vertexCount:   u32  offset 0
 *   triangleCount: u32  offset 4
 *   _pad0:         u32  offset 8
 *   _pad1:         u32  offset 12
 */
export const NORMAL_RECOMPUTE_WGSL = /* wgsl */ `
struct Uniforms {
    vertexCount: u32,
    triangleCount: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> indices: array<u32>;
@group(0) @binding(2) var<storage, read_write> normals: array<atomic<i32>>;
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let triIdx = gid.x;
    if (triIdx >= u.triangleCount) { return; }

    let i0 = indices[triIdx * 3u];
    let i1 = indices[triIdx * 3u + 1u];
    let i2 = indices[triIdx * 3u + 2u];

    let p0 = vec3<f32>(positions[i0 * 3u], positions[i0 * 3u + 1u], positions[i0 * 3u + 2u]);
    let p1 = vec3<f32>(positions[i1 * 3u], positions[i1 * 3u + 1u], positions[i1 * 3u + 2u]);
    let p2 = vec3<f32>(positions[i2 * 3u], positions[i2 * 3u + 1u], positions[i2 * 3u + 2u]);

    let edge1 = p1 - p0;
    let edge2 = p2 - p0;
    let faceNormal = cross(edge1, edge2);

    // Fixed-point accumulation: multiply by 1e6, store as i32
    let scale = 1000000.0;
    let nx = i32(faceNormal.x * scale);
    let ny = i32(faceNormal.y * scale);
    let nz = i32(faceNormal.z * scale);

    // Accumulate into each vertex's normal
    for (var v = 0u; v < 3u; v = v + 1u) {
        var vi: u32;
        if (v == 0u) { vi = i0; }
        else if (v == 1u) { vi = i1; }
        else { vi = i2; }

        atomicAdd(&normals[vi * 3u], nx);
        atomicAdd(&normals[vi * 3u + 1u], ny);
        atomicAdd(&normals[vi * 3u + 2u], nz);
    }
}
`;

/**
 * Normal normalization pass (run after accumulation).
 * Converts accumulated i32 normals to normalized f32.
 */
export const NORMAL_NORMALIZE_WGSL = /* wgsl */ `
struct Uniforms {
    vertexCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> accumulatedNormals: array<i32>;
@group(0) @binding(1) var<storage, read_write> outputNormals: array<f32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.vertexCount) { return; }

    let base = idx * 3u;
    let scale = 1.0 / 1000000.0;
    let nx = f32(accumulatedNormals[base]) * scale;
    let ny = f32(accumulatedNormals[base + 1u]) * scale;
    let nz = f32(accumulatedNormals[base + 2u]) * scale;

    let len = sqrt(nx * nx + ny * ny + nz * nz);
    let invLen = select(1.0, 1.0 / len, len > 0.0001);

    outputNormals[base]      = nx * invLen;
    outputNormals[base + 1u] = ny * invLen;
    outputNormals[base + 2u] = nz * invLen;
}
`;

// =============================================================================
// 2. PROCEDURAL NOISE (FBM) SHADER
// =============================================================================

/**
 * FBM noise generation compute shader.
 *
 * Uniforms layout (std140, 48 bytes):
 *   width:       u32   offset 0
 *   height:      u32   offset 4
 *   scale:       f32   offset 8
 *   octaves:     u32   offset 12
 *   lacunarity:  f32   offset 16
 *   persistence: f32   offset 20
 *   time:        f32   offset 24
 *   _pad0:       u32   offset 28
 */
export const NOISE_FBM_WGSL = /* wgsl */ `
${WGSL_NOISE_UTILS}

struct Uniforms {
    width: u32,
    height: u32,
    scale: f32,
    octaves: u32,
    lacunarity: f32,
    persistence: f32,
    time: f32,
    _pad0: u32,
};

@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

fn fbm(coord: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    for (var i = 0u; i < u.octaves; i = i + 1u) {
        value += amplitude * valueNoise2D(coord * frequency);
        frequency *= u.lacunarity;
        amplitude *= u.persistence;
    }
    return value;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= u.width || y >= u.height) { return; }

    let nx = (f32(x) / f32(u.width)) * u.scale + u.time * 0.1;
    let ny = (f32(y) / f32(u.height)) * u.scale + u.time * 0.05;

    let noise = fbm(vec2<f32>(nx, ny));

    // Candy swirl pattern
    let swirl = sin(nx * 10.0 + noise * 3.0) * 0.5 + 0.5;

    // Pastel candy colors (RGBA)
    let r = noise * 0.5 + swirl * 0.5;
    let g = noise * 0.7 + (1.0 - swirl) * 0.3;
    let b = noise * 0.3 + swirl * 0.7;

    let idx = (y * u.width + x) * 4u;
    output[idx]      = r;
    output[idx + 1u] = g;
    output[idx + 2u] = b;
    output[idx + 3u] = 1.0;
}
`;

/**
 * Single-channel FBM noise (for heightmaps / raw data).
 * Same uniform layout as NOISE_FBM_WGSL.
 */
export const NOISE_HEIGHTMAP_WGSL = /* wgsl */ `
${WGSL_NOISE_UTILS}

struct Uniforms {
    width: u32,
    height: u32,
    scale: f32,
    octaves: u32,
    lacunarity: f32,
    persistence: f32,
    time: f32,
    _pad0: u32,
};

@group(0) @binding(0) var<storage, read_write> output: array<f32>;
@group(0) @binding(1) var<uniform> u: Uniforms;

fn fbm(coord: vec2<f32>) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var frequency = 1.0;
    for (var i = 0u; i < u.octaves; i = i + 1u) {
        value += amplitude * valueNoise2D(coord * frequency);
        frequency *= u.lacunarity;
        amplitude *= u.persistence;
    }
    return value;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= u.width || y >= u.height) { return; }

    let nx = (f32(x) / f32(u.width)) * u.scale + u.time * 0.1;
    let ny = (f32(y) / f32(u.height)) * u.scale + u.time * 0.05;

    let idx = y * u.width + x;
    output[idx] = fbm(vec2<f32>(nx, ny));
}
`;

// =============================================================================
// 3. BATCH CULLING SHADERS
// =============================================================================

/**
 * Frustum culling compute shader.
 * Tests each instance's bounding sphere against 6 frustum planes.
 *
 * Uniforms layout (std140, 112 bytes):
 *   frustumPlanes: array<vec4<f32>, 6>  offset 0  (96 bytes — 6 × 16)
 *   instanceCount: u32                  offset 96
 *   _pad0-2:       u32 × 3             offset 100-108
 */
export const FRUSTUM_CULL_WGSL = /* wgsl */ `
struct Uniforms {
    plane0: vec4<f32>,
    plane1: vec4<f32>,
    plane2: vec4<f32>,
    plane3: vec4<f32>,
    plane4: vec4<f32>,
    plane5: vec4<f32>,
    instanceCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

// Each instance: vec4(centerX, centerY, centerZ, radius)
@group(0) @binding(0) var<storage, read> boundingSpheres: array<vec4<f32>>;
// Output: 1 = visible, 0 = culled
@group(0) @binding(1) var<storage, read_write> visibilityFlags: array<u32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

fn testPlane(plane: vec4<f32>, center: vec3<f32>, radius: f32) -> bool {
    let dist = dot(plane.xyz, center) + plane.w;
    return dist >= -radius;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.instanceCount) { return; }

    let sphere = boundingSpheres[idx];
    let center = sphere.xyz;
    let radius = sphere.w;

    var visible = true;
    visible = visible && testPlane(u.plane0, center, radius);
    visible = visible && testPlane(u.plane1, center, radius);
    visible = visible && testPlane(u.plane2, center, radius);
    visible = visible && testPlane(u.plane3, center, radius);
    visible = visible && testPlane(u.plane4, center, radius);
    visible = visible && testPlane(u.plane5, center, radius);

    visibilityFlags[idx] = select(0u, 1u, visible);
}
`;

/**
 * Distance culling compute shader.
 *
 * Uniforms layout (std140, 32 bytes):
 *   cameraPosition: vec3<f32>  offset 0
 *   maxDistance:     f32        offset 12
 *   instanceCount:  u32        offset 16
 *   _pad0-2:        u32 × 3   offset 20-28
 */
export const DISTANCE_CULL_WGSL = /* wgsl */ `
struct Uniforms {
    cameraPosition: vec3<f32>,
    maxDistance: f32,
    instanceCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> boundingSpheres: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibilityFlags: array<u32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.instanceCount) { return; }

    let center = boundingSpheres[idx].xyz;
    let dist = distance(center, u.cameraPosition);

    visibilityFlags[idx] = select(0u, 1u, dist <= u.maxDistance);
}
`;

/**
 * Combined frustum + distance culling compute shader.
 *
 * Uniforms layout (std140, 128 bytes):
 *   frustumPlanes: 6 × vec4<f32>  offset 0  (96 bytes)
 *   cameraPosition: vec3<f32>     offset 96
 *   maxDistance:     f32           offset 108
 *   instanceCount:  u32           offset 112
 *   _pad0-2:        u32 × 3      offset 116-124
 */
export const COMBINED_CULL_WGSL = /* wgsl */ `
struct Uniforms {
    plane0: vec4<f32>,
    plane1: vec4<f32>,
    plane2: vec4<f32>,
    plane3: vec4<f32>,
    plane4: vec4<f32>,
    plane5: vec4<f32>,
    cameraPosition: vec3<f32>,
    maxDistance: f32,
    instanceCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<storage, read> boundingSpheres: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibilityFlags: array<u32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

fn testPlane(plane: vec4<f32>, center: vec3<f32>, radius: f32) -> bool {
    let dist = dot(plane.xyz, center) + plane.w;
    return dist >= -radius;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.instanceCount) { return; }

    let sphere = boundingSpheres[idx];
    let center = sphere.xyz;
    let radius = sphere.w;

    // Distance check first (cheaper)
    let dist = distance(center, u.cameraPosition);
    if (dist > u.maxDistance) {
        visibilityFlags[idx] = 0u;
        return;
    }

    // Frustum check
    var visible = true;
    visible = visible && testPlane(u.plane0, center, radius);
    visible = visible && testPlane(u.plane1, center, radius);
    visible = visible && testPlane(u.plane2, center, radius);
    visible = visible && testPlane(u.plane3, center, radius);
    visible = visible && testPlane(u.plane4, center, radius);
    visible = visible && testPlane(u.plane5, center, radius);

    visibilityFlags[idx] = select(0u, 1u, visible);
}
`;
