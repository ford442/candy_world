/**
 * Update Particles Compute Shader (WGSL)
 * 
 * Main simulation loop that runs entirely on the GPU.
 * Updates particle positions, velocities, and lifecycle.
 * 
 * Features:
 * - Gravity and wind forces
 * - Noise-based turbulence (curl noise)
 * - Player attraction/repulsion
 * - Collision with ground
 * - Lifecycle: spawn → update → die → respawn
 * 
 * Workgroup size: 64 threads per workgroup
 */

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

// =============================================================================
// NOISE FUNCTIONS
// =============================================================================

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
    var f = fract(p);
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

// Curl noise for organic turbulent movement
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

// =============================================================================
// RANDOM NUMBER GENERATOR
// =============================================================================

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

// =============================================================================
// PARTICLE TYPE-SPECIFIC UPDATES
// =============================================================================

fn updateFirefly(index: u32, pos: vec3<f32>, vel: vec3<f32>, life: f32, seed: f32) -> vec3<f32> {
    var newVel = vel;
    
    // Curl noise for organic wandering
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
    newVel = newVel + acceleration * uniforms.deltaTime;
    newVel = newVel * 0.95; // Damping
    
    return newVel;
}

fn updatePollen(index: u32, pos: vec3<f32>, vel: vec3<f32>, life: f32, seed: f32) -> vec3<f32> {
    var newVel = vel;
    
    // Wind force
    let windForce = vec3<f32>(uniforms.windX, uniforms.windY, uniforms.windZ) * uniforms.windSpeed * 0.05;
    
    // Curl noise for turbulence
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
    newVel = newVel + acceleration * uniforms.deltaTime;
    newVel = newVel * 0.98; // Light damping
    
    return newVel;
}

fn updateBerry(index: u32, pos: vec3<f32>, vel: vec3<f32>, life: f32, seed: f32) -> vec3<f32> {
    var newVel = vel;
    
    // Gravity
    newVel.y = newVel.y - uniforms.gravity * uniforms.deltaTime;
    
    // Ground bounce (simplified)
    if (pos.y < 0.3) {
        newVel.y = abs(newVel.y) * 0.5; // Bounce with energy loss
        newVel.x = newVel.x * 0.8; // Friction
        newVel.z = newVel.z * 0.8;
    }
    
    return newVel;
}

fn updateRain(index: u32, pos: vec3<f32>, vel: vec3<f32>, life: f32, seed: f32) -> vec3<f32> {
    var newVel = vel;
    
    // Apply wind
    newVel.x = uniforms.windX * uniforms.windSpeed * 0.1;
    newVel.z = uniforms.windZ * uniforms.windSpeed * 0.1;
    
    return newVel;
}

fn updateSpark(index: u32, pos: vec3<f32>, vel: vec3<f32>, life: f32, seed: f32) -> vec3<f32> {
    var newVel = vel;
    
    // Lighter gravity
    newVel.y = newVel.y - uniforms.gravity * 0.5 * uniforms.deltaTime;
    
    // Air resistance
    newVel = newVel * 0.99;
    
    return newVel;
}

// =============================================================================
// RESPAWN LOGIC
// =============================================================================

fn respawnParticle(index: u32) -> vec3<f32> {
    // Random position within bounds
    return vec3<f32>(
        (rand() - 0.5) * uniforms.boundsX + uniforms.centerX,
        rand() * uniforms.boundsY + uniforms.centerY,
        (rand() - 0.5) * uniforms.boundsZ + uniforms.centerZ
    );
}

fn getInitialVelocity() -> vec3<f32> {
    switch uniforms.particleType {
        case 0u: { // Fireflies
            return vec3<f32>((rand() - 0.5) * 2.0, (rand() - 0.5) * 0.5, (rand() - 0.5) * 2.0);
        }
        case 1u: { // Pollen
            return vec3<f32>((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.5);
        }
        case 2u: { // Berries
            return vec3<f32>((rand() - 0.5) * 3.0, rand() * 2.0, (rand() - 0.5) * 3.0);
        }
        case 3u: { // Rain
            return vec3<f32>((rand() - 0.5) * 0.5, -5.0 - rand() * 3.0, (rand() - 0.5) * 0.5);
        }
        case 4u: { // Sparks
            let angle = rand() * 6.28318;
            let speed = 3.0 + rand() * 5.0;
            return vec3<f32>(cos(angle) * speed, rand() * speed, sin(angle) * speed);
        }
        default: {
            return vec3<f32>(0.0, 0.0, 0.0);
        }
    }
}

fn getInitialLife() -> f32 {
    switch uniforms.particleType {
        case 4u: { // Sparks have short life
            return 0.3 + rand() * 0.5;
        }
        default: {
            return 2.0 + rand() * 4.0;
        }
    }
}

// =============================================================================
// MAIN COMPUTE ENTRY POINT
// =============================================================================

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
        pos = respawnParticle(index);
        vel = getInitialVelocity();
        life = getInitialLife();
    } else {
        // Update physics based on particle type
        switch uniforms.particleType {
            case 0u: {
                vel = updateFirefly(index, pos, vel, life, seed);
            }
            case 1u: {
                vel = updatePollen(index, pos, vel, life, seed);
            }
            case 2u: {
                vel = updateBerry(index, pos, vel, life, seed);
            }
            case 3u: {
                vel = updateRain(index, pos, vel, life, seed);
            }
            case 4u: {
                vel = updateSpark(index, pos, vel, life, seed);
            }
            default: {}
        }
        
        // Update position
        pos = pos + vel * uniforms.deltaTime;
        
        // Floor constraints by type
        switch uniforms.particleType {
            case 0u: { // Fireflies - floor bounce
                if (pos.y < 0.5) {
                    pos.y = 0.5;
                    vel.y = abs(vel.y) * 0.3;
                }
            }
            case 1u: { // Pollen - keep above water
                if (pos.y < 1.8) {
                    pos.y = 1.8;
                    vel.y = abs(vel.y) * 0.3;
                }
            }
            case 2u: { // Berries - ground bounce
                if (pos.y < 0.3) {
                    pos.y = 0.3;
                    vel.y = abs(vel.y) * 0.5;
                }
            }
            case 3u: { // Rain - die on ground
                if (pos.y < 0.5) {
                    life = 0.0;
                }
            }
            default: {}
        }
    }
    
    // Write back
    particles.positions[index] = pos;
    particles.velocities[index] = vel;
    particles.lives[index] = life;
}
