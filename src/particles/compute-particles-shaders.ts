/**
 * @file compute-particles-shaders.ts
 * @description WGSL shader sources for the compute particle system
 */

/**
 * Update particles compute shader - runs simulation step entirely on GPU
 */
export const UPDATE_PARTICLES_WGSL = /* wgsl */`
struct ParticleData {
    positions: array<vec3<f32>>,
    velocities: array<vec3<f32>>,
    lives: array<f32>,
    sizes: array<f32>,
    seeds: array<f32>,
};

struct Uniforms {
    deltaTime: f32,
    time: f32,
    count: u32,
    boundsX: f32,
    boundsY: f32,
    boundsZ: f32,
    centerX: f32,
    centerY: f32,
    centerZ: f32,
    gravity: f32,
    windX: f32,
    windY: f32,
    windZ: f32,
    windSpeed: f32,
    playerX: f32,
    playerY: f32,
    playerZ: f32,
    audioLow: f32,
    audioHigh: f32,
    particleType: u32,  // 0=fireflies, 1=pollen, 2=berries, 3=rain, 4=sparks
};

@group(0) @binding(0) var<storage, read_write> particles: ParticleData;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

// Simplex noise function for turbulence
fn hash3(p: vec3<f32>) -> vec3<f32> {
    var q = vec3<f32>(
        dot(p, vec3<f32>(127.1, 311.7, 74.7)),
        dot(p, vec3<f32>(269.5, 183.3, 246.1)),
        dot(p, vec3<f32>(113.5, 271.9, 124.6))
    );
    return fract(sin(q) * 43758.5453);
}

fn noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    let n = i.x + i.y * 157.0 + 113.0 * i.z;
    return mix(
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 0.0)).x, 
                hash3(i + vec3<f32>(1.0, 0.0, 0.0)).x, f.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)).x,
                hash3(i + vec3<f32>(1.0, 1.0, 0.0)).x, f.x),
            f.y
        ),
        mix(
            mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)).x,
                hash3(i + vec3<f32>(1.0, 0.0, 1.0)).x, f.x),
            mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)).x,
                hash3(i + vec3<f32>(1.0, 1.0, 1.0)).x, f.x),
            f.y
        ),
        f.z
    );
}

fn curlNoise(p: vec3<f32>, time: f32) -> vec3<f32> {
    let eps = 0.01;
    let n1 = noise(p + vec3<f32>(eps, 0.0, 0.0));
    let n2 = noise(p - vec3<f32>(eps, 0.0, 0.0));
    let n3 = noise(p + vec3<f32>(0.0, eps, 0.0));
    let n4 = noise(p - vec3<f32>(0.0, eps, 0.0));
    let n5 = noise(p + vec3<f32>(0.0, 0.0, eps));
    let n6 = noise(p - vec3<f32>(0.0, 0.0, eps));
    
    let dx = vec3<f32>(eps * 2.0, n3 - n4, n5 - n6);
    let dy = vec3<f32>(n1 - n2, eps * 2.0, n5 - n6);
    let dz = vec3<f32>(n1 - n2, n3 - n4, eps * 2.0);
    
    return normalize(cross(dx, dy));
}

// Random number generator
var<private> rngState: u32 = 0u;

fn rand() -> f32 {
    rngState = rngState * 747796405u + 2891336453u;
    var result: u32 = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
    result = (result >> 22u) ^ result;
    return f32(result) / 4294967295.0;
}

fn seedRand(seed: u32) {
    rngState = seed;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let index = globalId.x;
    if (index >= uniforms.count) {
        return;
    }
    
    // Seed RNG with particle index + time
    seedRand(index + u32(uniforms.time * 1000.0) % 1000000u);
    
    var pos = particles.positions[index];
    var vel = particles.velocities[index];
    var life = particles.lives[index];
    let seed = particles.seeds[index];
    
    // Decrease life
    life = life - uniforms.deltaTime;
    
    // Respawn if dead
    if (life <= 0.0) {
        // Random position within bounds
        pos = vec3<f32>(
            (rand() - 0.5) * uniforms.boundsX + uniforms.centerX,
            rand() * uniforms.boundsY + uniforms.centerY,
            (rand() - 0.5) * uniforms.boundsZ + uniforms.centerZ
        );
        
        // Reset velocity based on type
        switch uniforms.particleType {
            case 0u: { // Fireflies
                vel = vec3<f32>((rand() - 0.5) * 2.0, (rand() - 0.5) * 0.5, (rand() - 0.5) * 2.0);
            }
            case 1u: { // Pollen
                vel = vec3<f32>((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.5);
            }
            case 2u: { // Berries
                vel = vec3<f32>((rand() - 0.5) * 3.0, rand() * 2.0, (rand() - 0.5) * 3.0);
            }
            case 3u: { // Rain
                vel = vec3<f32>((rand() - 0.5) * 0.5, -5.0 - rand() * 3.0, (rand() - 0.5) * 0.5);
            }
            case 4u: { // Sparks
                let angle = rand() * 6.28318;
                let speed = 3.0 + rand() * 5.0;
                vel = vec3<f32>(cos(angle) * speed, rand() * speed, sin(angle) * speed);
            }
            default: {
                vel = vec3<f32>(0.0, 0.0, 0.0);
            }
        }
        
        // Reset life
        life = 2.0 + rand() * 4.0;
        if (uniforms.particleType == 4u) { // Sparks have short life
            life = 0.3 + rand() * 0.5;
        }
    } else {
        // Update physics based on particle type
        switch uniforms.particleType {
            case 0u: { // Fireflies - Gentle floating with curl noise
                let noisePos = pos * 0.1 + uniforms.time * 0.3;
                let curl = curlNoise(noisePos, uniforms.time);
                
                // Spring force to center area
                let toCenter = vec3<f32>(uniforms.centerX, pos.y, uniforms.centerZ) - pos;
                let springForce = toCenter * 0.5;
                
                // Audio turbulence
                let audioForce = normalize(vel) * uniforms.audioLow * 5.0;
                
                // Player repulsion
                let toPlayer = pos - vec3<f32>(uniforms.playerX, uniforms.playerY, uniforms.playerZ);
                let distToPlayer = length(toPlayer);
                let repelStrength = max(0.0, 5.0 - distToPlayer);
                let playerForce = normalize(toPlayer) * repelStrength * 10.0;
                
                // Apply forces
                let acceleration = curl * 2.0 + springForce + audioForce + playerForce;
                vel = vel + acceleration * uniforms.deltaTime;
                vel = vel * 0.95; // Damping
                
                // Floor constraint
                if (pos.y < 0.5) {
                    pos.y = 0.5;
                    vel.y = abs(vel.y) * 0.3;
                }
            }
            case 1u: { // Pollen - Wind-driven with curl noise
                let windForce = vec3<f32>(uniforms.windX, uniforms.windY, uniforms.windZ) * uniforms.windSpeed * 0.05;
                
                let noisePos = pos * 0.2 + uniforms.time * 0.2;
                let curl = curlNoise(noisePos, uniforms.time) * 0.5;
                
                // Audio jitter
                let audioJitter = normalize(vel) * uniforms.audioLow * 2.0;
                
                // Center attraction (keep in area)
                let toCenter = vec3<f32>(uniforms.centerX, uniforms.centerY, uniforms.centerZ) - pos;
                let dist = length(toCenter);
                let pullStrength = max(0.0, dist - 15.0) * 0.1;
                let centerForce = normalize(toCenter) * pullStrength;
                
                // Player repulsion
                let toPlayer = pos - vec3<f32>(uniforms.playerX, uniforms.playerY, uniforms.playerZ);
                let distToPlayer = length(toPlayer);
                let repelFactor = max(0.0, 5.0 - distToPlayer);
                let repelForce = normalize(toPlayer) * repelFactor * 2.0;
                
                let acceleration = windForce + curl + audioJitter + centerForce + repelForce;
                vel = vel + acceleration * uniforms.deltaTime;
                vel = vel * 0.98; // Light damping
                
                // Keep above water
                if (pos.y < 1.8) {
                    pos.y = 1.8;
                    vel.y = abs(vel.y) * 0.3;
                }
            }
            case 2u: { // Berries - Physics with bounce
                // Gravity
                vel.y = vel.y - uniforms.gravity * uniforms.deltaTime;
                
                // Ground bounce (simplified - actual ground collision uses height texture)
                if (pos.y < 0.3) {
                    pos.y = 0.3;
                    vel.y = abs(vel.y) * 0.5; // Bounce with energy loss
                    vel.x = vel.x * 0.8; // Friction
                    vel.z = vel.z * 0.8;
                }
            }
            case 3u: { // Rain - Fast falling with wind
                vel.x = uniforms.windX * uniforms.windSpeed * 0.1;
                vel.z = uniforms.windZ * uniforms.windSpeed * 0.1;
                
                // Splash on ground
                if (pos.y < 0.5) {
                    life = 0.0; // Die and respawn at top
                }
            }
            case 4u: { // Sparks - Fast with gravity
                vel.y = vel.y - uniforms.gravity * 0.5 * uniforms.deltaTime;
                vel = vel * 0.99; // Air resistance
            }
            default: {}
        }
        
        // Update position
        pos = pos + vel * uniforms.deltaTime;
    }
    
    // Write back
    particles.positions[index] = pos;
    particles.velocities[index] = vel;
    particles.lives[index] = life;
}
`;

/**
 * Render vertex shader - transforms particles for rendering
 */
export const RENDER_PARTICLES_WGSL = /* wgsl */`
struct Uniforms {
    mvpMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    projectionMatrix: mat4x4<f32>,
    time: f32,
    particleType: u32,
};

struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
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
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    
    // Billboard quad vertices
    let quadVertices = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    
    let quadIndex = input.vertexIndex % 4u;
    let quadOffset = quadVertices[quadIndex];
    
    // Calculate size with type-specific effects
    var finalSize = input.size;
    
    switch uniforms.particleType {
        case 0u: { // Fireflies - pulse
            let pulse = sin(uniforms.time * 5.0 + input.seed * 10.0) * 0.3 + 1.0;
            finalSize = finalSize * pulse;
        }
        case 1u: { // Pollen - twinkle
            let twinkle = sin(uniforms.time * 3.0 + input.seed * 20.0) * 0.2 + 1.0;
            finalSize = finalSize * twinkle;
        }
        case 4u: { // Sparks - shrink with life
            finalSize = finalSize * input.life;
        }
        default: {}
    }
    
    // Billboard transformation
    let right = vec3<f32>(uniforms.viewMatrix[0][0], uniforms.viewMatrix[1][0], uniforms.viewMatrix[2][0]);
    let up = vec3<f32>(uniforms.viewMatrix[0][1], uniforms.viewMatrix[1][1], uniforms.viewMatrix[2][1]);
    
    let worldPos = input.position + (right * quadOffset.x + up * quadOffset.y) * finalSize;
    
    output.position = uniforms.mvpMatrix * vec4<f32>(worldPos, 1.0);
    output.color = input.color;
    output.uv = quadOffset * 0.5 + 0.5;
    output.life = input.life;
    output.velocity = input.velocity;
    output.size = finalSize;
    
    return output;
}
`;

/**
 * Render fragment shader - colors and effects
 */
export const FRAGMENT_PARTICLES_WGSL = /* wgsl */`
struct Uniforms {
    time: f32,
    particleType: u32,
    audioLow: f32,
    audioHigh: f32,
};

struct FragmentInput {
    @location(0) color: vec4<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) life: f32,
    @location(3) velocity: vec3<f32>,
    @location(4) size: f32,
};

struct FragmentOutput {
    @location(0) color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@fragment
fn main(input: FragmentInput) -> FragmentOutput {
    var output: FragmentOutput;
    
    // Distance from center for soft circle
    let center = vec2<f32>(0.5, 0.5);
    let dist = distance(input.uv, center);
    
    // Soft edge
    let alpha = smoothstep(0.5, 0.2, dist);
    
    var finalColor = input.color;
    
    // Type-specific coloring
    switch uniforms.particleType {
        case 0u: { // Fireflies - yellow-green glow
            let intensity = input.life / 6.0;
            let green = vec3<f32>(0.53, 1.0, 0.0);
            let gold = vec3<f32>(1.0, 0.84, 0.0);
            finalColor.rgb = mix(green, gold, intensity);
            finalColor.rgb = finalColor.rgb * (1.0 + uniforms.audioHigh * 3.0);
        }
        case 1u: { // Pollen - neon cyan/magenta
            let hueMix = sin(input.uv.x * 10.0 + uniforms.time) * 0.5 + 0.5;
            let cyan = vec3<f32>(0.0, 1.0, 1.0);
            let magenta = vec3<f32>(1.0, 0.0, 1.0);
            finalColor.rgb = mix(cyan, magenta, hueMix);
        }
        case 2u: { // Berries - red/orange
            let berryColor = vec3<f32>(1.0, 0.4, 0.0);
            finalColor.rgb = berryColor * (0.8 + input.life * 0.1);
        }
        case 3u: { // Rain - blue tint
            let rainColor = vec3<f32>(0.6, 0.8, 1.0);
            finalColor.rgb = rainColor;
            // Stretch based on velocity
            let speed = length(input.velocity);
            finalColor.a = alpha * (0.5 + speed * 0.1);
        }
        case 4u: { // Sparks - white/yellow core
            let sparkColor = mix(
                vec3<f32>(1.0, 1.0, 0.5),
                vec3<f32>(1.0, 0.5, 0.0),
                1.0 - input.life
            );
            finalColor.rgb = sparkColor;
            finalColor.a = alpha * input.life * 2.0;
        }
        default: {}
    }
    
    // Hot core for all particles
    let coreMix = smoothstep(0.3, 0.0, dist);
    finalColor.rgb = mix(finalColor.rgb, vec3<f32>(1.0, 1.0, 1.0), coreMix * 0.5);
    
    // Audio reactivity boost
    finalColor.rgb = finalColor.rgb * (1.0 + uniforms.audioLow);
    
    output.color = vec4<f32>(finalColor.rgb, finalColor.a * alpha);
    
    return output;
}
`;
