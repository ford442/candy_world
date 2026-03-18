/**
 * Particle Render Vertex Shader (WGSL)
 * 
 * Transforms particles for rendering with:
 * - Billboard quads (camera-facing)
 * - Size variation and animation
 * - Stretch based on velocity
 * - Type-specific visual effects
 */

struct Uniforms {
    // Transformation matrices
    mvpMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    
    // Camera position for distance-based effects
    cameraX: f32,
    cameraY: f32,
    cameraZ: f32,
    
    // Time for animation
    time: f32,
    
    // Particle type for type-specific rendering
    particleType: u32,
    
    // Audio reactivity
    audioLow: f32,
    audioHigh: f32,
    
    // Global size multiplier
    globalSize: f32,
};

struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    
    // Particle data (from storage buffer)
    @location(0) position: vec3<f32>,
    @location(1) velocity: vec3<f32>,
    @location(2) life: f32,
    @location(3) size: f32,
    @location(4) color: vec4<f32>,
    @location(5) seed: f32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) life: f32,
    @location(3) velocity: vec3<f32>,
    @location(4) size: f32,
    @location(5) worldPos: vec3<f32>,
    @location(6) viewDir: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

fn rotateToAlignWithDirection(dir: vec3<f32>, up: vec3<f32>) -> mat3x3<f32> {
    // Create rotation matrix that aligns 'up' with 'dir'
    let z = normalize(dir);
    let x = normalize(cross(up, z));
    let y = cross(z, x);
    return mat3x3<f32>(x, y, z);
}

// =============================================================================
// VERTEX MAIN
// =============================================================================

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Quad vertices (2 triangles = 6 vertices, but we use 4 for strip)
    // vertexIndex: 0=BL, 1=BR, 2=TL, 3=TR
    let quadVertices = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),  // Bottom-left
        vec2<f32>( 1.0, -1.0),  // Bottom-right
        vec2<f32>(-1.0,  1.0),  // Top-left
        vec2<f32>( 1.0,  1.0)   // Top-right
    );
    
    let quadIndex = input.vertexIndex % 4u;
    let quadOffset = quadVertices[quadIndex];
    
    // UV coordinates
    let uvs = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    output.uv = uvs[quadIndex];
    
    // ===================================================================
    // SIZE CALCULATION WITH TYPE-SPECIFIC EFFECTS
    // ===================================================================
    var finalSize = input.size * uniforms.globalSize;
    
    switch uniforms.particleType {
        case 0u: { // Fireflies - pulsing glow
            let pulse = sin(uniforms.time * 5.0 + input.seed * 10.0) * 0.3 + 1.0;
            let audioPulse = uniforms.audioHigh * 0.5;
            finalSize = finalSize * pulse + audioPulse;
        }
        case 1u: { // Pollen - twinkling
            let twinkle = sin(uniforms.time * 3.0 + input.seed * 20.0) * 0.2 + 1.0;
            finalSize = finalSize * twinkle;
        }
        case 2u: { // Berries - consistent size
            finalSize = finalSize * (0.9 + sin(input.seed) * 0.1);
        }
        case 3u: { // Rain - stretch based on velocity
            let speed = length(input.velocity);
            let stretch = 1.0 + speed * 0.5;
            finalSize = finalSize * stretch;
        }
        case 4u: { // Sparks - shrink with life
            finalSize = finalSize * input.life * 2.0;
        }
        default: {}
    }
    
    // ===================================================================
    // BILLBOARD TRANSFORMATION
    // ===================================================================
    
    // Extract camera right and up vectors from view matrix
    let cameraRight = vec3<f32>(uniforms.viewMatrix[0][0], uniforms.viewMatrix[1][0], uniforms.viewMatrix[2][0]);
    let cameraUp = vec3<f32>(uniforms.viewMatrix[0][1], uniforms.viewMatrix[1][1], uniforms.viewMatrix[2][1]);
    
    // For rain, align with velocity instead of camera
    var right = cameraRight;
    var up = cameraUp;
    
    if (uniforms.particleType == 3u) { // Rain
        let velDir = normalize(input.velocity);
        if (length(input.velocity) > 0.1) {
            up = velDir;
            right = normalize(cross(cameraRight, up));
        }
    }
    
    // Calculate world position of quad vertex
    let worldPos = input.position + (right * quadOffset.x + up * quadOffset.y) * finalSize;
    
    // ===================================================================
    // OUTPUT
    // ===================================================================
    
    output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
    output.color = input.color;
    output.life = input.life;
    output.velocity = input.velocity;
    output.size = finalSize;
    output.worldPos = worldPos;
    
    // View direction for effects
    output.viewDir = normalize(vec3<f32>(uniforms.cameraX, uniforms.cameraY, uniforms.cameraZ) - worldPos);
    
    return output;
}
