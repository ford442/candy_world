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
    var f = fract(p);
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


// =============================================================================
// 4. PARTICLE PHYSICS COMPUTE SHADER
// =============================================================================

/**
 * Particle physics update compute shader.
 * Updates particle positions and velocities with gravity, audio reactivity,
 * and bounds checking with respawn logic.
 *
 * Uniforms layout (std140, 64 bytes):
 *   vec4: deltaTime, gravity, audioKick, audioSnare (offset 0)
 *   vec4: audioPulse, particleCount, boundsMinX, boundsMinY (offset 16)
 *   vec4: boundsMinZ, boundsMaxX, boundsMaxY, boundsMaxZ (offset 32)
 *   vec4: spawnCenterX, spawnCenterY, spawnCenterZ, damping (offset 48)
 *   vec4: restitution, boundsCollision, time, _pad (offset 64)
 */
export const PARTICLE_PHYSICS_WGSL = /* wgsl */ `
// Particle physics update shader
// Input: positions (vec4: x,y,z,life), velocities (vec4: vx,vy,vz,age), colors (vec4: r,g,b,a)
// Output: updated positions, velocities

struct Uniforms {
    deltaTime: f32,
    gravity: f32,
    audioKick: f32,
    audioSnare: f32,
    audioPulse: f32,
    particleCount: u32,
    boundsMinX: f32,
    boundsMinY: f32,
    boundsMinZ: f32,
    boundsMaxX: f32,
    boundsMaxY: f32,
    boundsMaxZ: f32,
    spawnCenterX: f32,
    spawnCenterY: f32,
    spawnCenterZ: f32,
    damping: f32,
    restitution: f32,
    boundsCollision: f32,
    time: f32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> colors: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u: Uniforms;

// Simple hash for pseudo-random spawn positions
fn hash(n: f32) -> f32 {
    return fract(sin(n) * 43758.5453);
}

// 2D hash for variety
fn hash2(n: vec2<f32>) -> f32 {
    return fract(sin(dot(n, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.particleCount) { return; }
    
    var pos = positions[idx];
    var vel = velocities[idx];
    var col = colors[idx];
    
    // Update position based on velocity
    pos.x += vel.x * u.deltaTime;
    pos.y += vel.y * u.deltaTime;
    pos.z += vel.z * u.deltaTime;
    
    // Apply gravity to vertical velocity
    vel.y -= u.gravity * u.deltaTime;
    
    // Apply damping
    vel.xyz = vel.xyz * u.damping;
    
    // Audio reactivity - boost velocity on kick/snare
    let speed = length(vel.xyz);
    if (speed > 0.001) {
        let audioBoost = u.audioKick * 0.3 + u.audioSnare * 0.2 + u.audioPulse * 0.1;
        vel.xyz += normalize(vel.xyz) * audioBoost;
    }
    
    // Bounds check with optional collision
    let boundsMin = vec3<f32>(u.boundsMinX, u.boundsMinY, u.boundsMinZ);
    let boundsMax = vec3<f32>(u.boundsMaxX, u.boundsMaxY, u.boundsMaxZ);
    
    if (u.boundsCollision > 0.5) {
        // Bounce off bounds
        if (pos.x < boundsMin.x) { pos.x = boundsMin.x; vel.x = abs(vel.x) * u.restitution; }
        if (pos.x > boundsMax.x) { pos.x = boundsMax.x; vel.x = -abs(vel.x) * u.restitution; }
        if (pos.y < boundsMin.y) { pos.y = boundsMin.y; vel.y = abs(vel.y) * u.restitution; }
        if (pos.y > boundsMax.y) { pos.y = boundsMax.y; vel.y = -abs(vel.y) * u.restitution; }
        if (pos.z < boundsMin.z) { pos.z = boundsMin.z; vel.z = abs(vel.z) * u.restitution; }
        if (pos.z > boundsMax.z) { pos.z = boundsMax.z; vel.z = -abs(vel.z) * u.restitution; }
    }
    
    // Respawn if out of bounds or dead (life <= 0)
    let outOfBounds = pos.x < boundsMin.x - 1.0 || pos.x > boundsMax.x + 1.0 ||
                      pos.y < boundsMin.y - 1.0 || pos.y > boundsMax.y + 1.0 ||
                      pos.z < boundsMin.z - 1.0 || pos.z > boundsMax.z + 1.0;
    
    if (outOfBounds || pos.w <= 0.0) {
        // Respawn at spawn center with spread
        let seed = f32(idx) + u.time * 10.0;
        let spreadX = (boundsMax.x - boundsMin.x) * 0.3;
        let spreadZ = (boundsMax.z - boundsMin.z) * 0.3;
        
        pos.x = u.spawnCenterX + (hash(seed) - 0.5) * spreadX;
        pos.y = u.spawnCenterY + hash(seed + 1.0) * (boundsMax.y - boundsMin.y) * 0.3;
        pos.z = u.spawnCenterZ + (hash(seed + 2.0) - 0.5) * spreadZ;
        pos.w = 3.0 + hash(seed + 3.0) * 5.0; // Life: 3-8 seconds
        
        // Initial velocity: upward burst with spread
        let spread = 2.0 + u.audioKick * 5.0; // More spread on kick
        vel.x = (hash(seed + 4.0) - 0.5) * spread;
        vel.y = 2.0 + hash(seed + 5.0) * 4.0 + u.audioPulse * 3.0; // Upward with audio boost
        vel.z = (hash(seed + 6.0) - 0.5) * spread;
        vel.w = 0.0; // Age reset
        
        // Color shift on respawn
        let hue = fract(hash(seed + 7.0) + u.time * 0.1);
        // Simple HSL-ish to RGB for variety
        let sat = 0.6 + hash(seed + 8.0) * 0.4;
        let light = 0.5 + hash(seed + 9.0) * 0.4;
        col.r = hash(hue * 3.0) * sat + light * (1.0 - sat);
        col.g = hash(hue * 5.0 + 1.0) * sat + light * (1.0 - sat);
        col.b = hash(hue * 7.0 + 2.0) * sat + light * (1.0 - sat);
    }
    
    // Decrease life
    pos.w -= u.deltaTime;
    vel.w += u.deltaTime; // Increase age
    
    positions[idx] = pos;
    velocities[idx] = vel;
    colors[idx] = col;
}
`;

// =============================================================================
// 5. FOLIAGE ANIMATION COMPUTE SHADER
// =============================================================================

/**
 * Foliage animation compute shader.
 * Batches foliage animation on GPU with multiple animation types:
 * 0=none, 1=sway, 2=bounce, 3=wobble
 *
 * Uniforms layout (std140, 32 bytes):
 *   time:          f32   offset 0
 *   beatPhase:     f32   offset 4
 *   kick:          f32   offset 8
 *   groove:        f32   offset 12
 *   isDay:         u32   offset 16
 *   instanceCount: u32   offset 20
 *   _pad0-1:       u32   offset 24-28
 */
export const FOLIAGE_ANIMATION_WGSL = /* wgsl */ `
// Batch foliage animation on GPU
// Input: original positions, animation params
// Output: animated positions/rotations

struct Instance {
    posX: f32, posY: f32, posZ: f32,
    rotX: f32, rotY: f32, rotZ: f32,
    scaleX: f32, scaleY: f32, scaleZ: f32,
    animType: u32,  // 0=none, 1=sway, 2=bounce, 3=wobble, etc
    animOffset: f32,
    intensity: f32,
};

struct Uniforms {
    time: f32,
    beatPhase: f32,
    kick: f32,
    groove: f32,
    isDay: u32,
    instanceCount: u32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<storage, read> instances: array<Instance>;
@group(0) @binding(1) var<storage, read_write> outputPositions: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.instanceCount) { return; }
    
    let inst = instances[idx];
    var pos = vec3<f32>(inst.posX, inst.posY, inst.posZ);
    var rot = vec3<f32>(inst.rotX, inst.rotY, inst.rotZ);
    let scale = vec3<f32>(inst.scaleX, inst.scaleY, inst.scaleZ);
    
    let animTime = u.time + u.beatPhase + inst.animOffset;
    
    // Apply animation based on type
    switch (inst.animType) {
        case 1u: { // gentleSway - wind-like rotation
            rot.z = sin(u.time * 0.5 + inst.animOffset) * 0.05 * inst.intensity;
        }
        case 2u: { // bounce - vertical bounce with night kick boost
            pos.y = inst.posY + sin(animTime * 3.0) * 0.12 * inst.intensity;
            if (u.isDay == 0u && u.kick > 0.12) {
                pos.y += u.kick * 0.21;
            }
        }
        case 3u: { // wobble - chaotic rotation
            let boost = inst.intensity;
            rot.x = sin(animTime * 3.0) * 0.15 * boost;
            rot.z = cos(animTime * 3.0) * 0.16 * boost;
        }
        case 4u: { // pulseScale - heartbeat scaling
            let pulse = 1.0 + sin(animTime * 4.0) * 0.1 * inst.intensity;
            // Scale is packed in output, handled separately if needed
        }
        case 5u: { // spiral - rotating around Y axis
            rot.y = inst.rotY + animTime * inst.intensity;
        }
        default: { // No animation
        }
    }
    
    // Pack position + rotation into output
    // outputPositions[idx * 2] = position (xyz) + scale X in w
    // outputPositions[idx * 2 + 1] = rotation (xyz) + scale Y in w
    outputPositions[idx * 2u] = vec4<f32>(pos, scale.x);
    outputPositions[idx * 2u + 1u] = vec4<f32>(rot, scale.y);
}
`;

// =============================================================================
// 6. LOD SELECTION COMPUTE SHADER
// =============================================================================

/**
 * LOD (Level of Detail) selection compute shader.
 * GPU-accelerated LOD level selection based on distance from camera.
 * Outputs LOD level: 0=closest/highest detail, 1=medium, 2=low, 3=culled/farthest
 *
 * Uniforms layout (std140, 32 bytes):
 *   camPos:      vec3  offset 0
 *   lod0Dist:    f32   offset 12
 *   lod1Dist:    f32   offset 16
 *   lod2Dist:    f32   offset 20
 *   objectCount: u32   offset 24
 *   _pad0:       u32   offset 28
 */
export const LOD_SELECT_WGSL = /* wgsl */ `
// GPU-accelerated LOD level selection
// Input: positions, camera position, LOD distances
// Output: LOD level for each object

struct Uniforms {
    camPos: vec3<f32>,
    lod0Dist: f32,
    lod1Dist: f32,
    lod2Dist: f32,
    objectCount: u32,
    _pad0: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec3<f32>>;
@group(0) @binding(1) var<storage, write> lodLevels: array<u32>;
@group(0) @binding(2) var<uniform> u: Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.objectCount) { return; }
    
    let pos = positions[idx];
    let dist = distance(pos, u.camPos);
    
    var lod: u32;
    if (dist < u.lod0Dist) {
        lod = 0u; // Highest detail
    } else if (dist < u.lod1Dist) {
        lod = 1u; // Medium detail
    } else if (dist < u.lod2Dist) {
        lod = 2u; // Low detail
    } else {
        lod = 3u; // Culled/farthest
    }
    
    lodLevels[idx] = lod;
}
`;

// =============================================================================
// 7. AUDIO-REACTIVE COLOR COMPUTE SHADER
// =============================================================================

/**
 * Audio-reactive color compute shader.
 * Computes audio-reactive colors in batch by mapping frequencies to hues.
 * Includes HSL to RGB conversion for vibrant reactive colors.
 *
 * Uniforms layout (std140, 16 bytes):
 *   materialCount:  u32   offset 0
 *   audioIntensity: f32   offset 4
 *   _pad0-1:        u32   offset 8-12
 */
export const AUDIO_COLOR_WGSL = /* wgsl */ `
// Compute audio-reactive colors in batch
// Input: frequencies, base colors
// Output: modulated colors

// HSL to RGB conversion helper
fn hslToRgb(h: f32, s: f32, l: f32) -> vec3<f32> {
    // HSL to RGB conversion
    let c = (1.0 - abs(2.0 * l - 1.0)) * s;
    let x = c * (1.0 - abs(fract(h * 6.0) * 2.0 - 1.0));
    let m = l - c * 0.5;
    
    var rgb: vec3<f32>;
    if (h < 1.0/6.0) { rgb = vec3<f32>(c, x, 0.0); }
    else if (h < 2.0/6.0) { rgb = vec3<f32>(x, c, 0.0); }
    else if (h < 3.0/6.0) { rgb = vec3<f32>(0.0, c, x); }
    else if (h < 4.0/6.0) { rgb = vec3<f32>(0.0, x, c); }
    else if (h < 5.0/6.0) { rgb = vec3<f32>(x, 0.0, c); }
    else { rgb = vec3<f32>(c, 0.0, x); }
    
    return rgb + vec3<f32>(m);
}

struct Uniforms {
    materialCount: u32,
    audioIntensity: f32,
    _pad0: u32,
    _pad1: u32,
};

@group(0) @binding(0) var<storage, read> frequencies: array<f32>;
@group(0) @binding(1) var<storage, read> baseColors: array<vec4<f32>>;
@group(0) @binding(2) var<storage, write> outputColors: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= u.materialCount) { return; }
    
    let freqCount = arrayLength(&frequencies);
    let freq = frequencies[idx % freqCount];
    let base = baseColors[idx];
    
    // Map frequency to hue (musical frequency to color mapping)
    // 55Hz (A1) as reference, use log2 for perceptual scaling
    var hue = 0.0;
    if (freq > 1.0) {
        hue = fract(log2(freq / 55.0) * 0.1);
    }
    let reactiveColor = hslToRgb(hue, 1.0, 0.6);
    
    // Blend with base color based on audio intensity
    let blendFactor = clamp(u.audioIntensity * 0.3, 0.0, 1.0);
    let finalColor = mix(base.rgb, reactiveColor, blendFactor);
    
    outputColors[idx] = vec4<f32>(finalColor, base.a);
}
`;

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Combined export of all compute shaders for easy access.
 */
export const COMPUTE_SHADERS = {
    PARTICLE_PHYSICS: PARTICLE_PHYSICS_WGSL,
    FOLIAGE_ANIMATION: FOLIAGE_ANIMATION_WGSL,
    FRUSTUM_CULL: FRUSTUM_CULL_WGSL,
    LOD_SELECT: LOD_SELECT_WGSL,
    AUDIO_COLOR: AUDIO_COLOR_WGSL,
};
