/**
 * Spawn Particles Compute Shader (WGSL)
 * 
 * Handles particle birth and emission logic.
 * Can be used for burst emissions or continuous spawning.
 * 
 * Features:
 * - Burst spawning (explosions, impacts)
 * - Continuous emission (rain, smoke)
 * - Shape-based emission (sphere, box, cone)
 * - Velocity initialization patterns
 */

struct ParticleData {
    positions: array<vec3<f32>>,
    velocities: array<vec3<f32>>,
    lives: array<f32>,
    sizes: array<f32>,
    seeds: array<f32>,
};

struct SpawnParams {
    // Emission center
    centerX: f32,
    centerY: f32,
    centerZ: f32,
    
    // Emission shape: 0=sphere, 1=box, 2=cone, 3=disc
    shape: u32,
    
    // Shape parameters
    radius: f32,
    boxX: f32,
    boxY: f32,
    boxZ: f32,
    coneAngle: f32,
    
    // Velocity pattern: 0=random, 1=explosive, 2=implosive, 3=directional, 4=spiral
    velocityPattern: u32,
    baseSpeed: f32,
    speedVariation: f32,
    
    // Direction (for directional pattern)
    dirX: f32,
    dirY: f32,
    dirZ: f32,
    
    // Life parameters
    lifeMin: f32,
    lifeMax: f32,
    
    // Count parameters
    startIndex: u32,
    spawnCount: u32,
    totalCount: u32,
    
    // Time seed for randomization
    timeSeed: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: ParticleData;
@group(0) @binding(1) var<uniform> params: SpawnParams;

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
// POSITION GENERATION BY SHAPE
// =============================================================================

fn randomPointInSphere(radius: f32) -> vec3<f32> {
    // Cube root for uniform distribution
    let r = pow(rand(), 0.33333) * radius;
    let theta = rand() * 6.28318;
    let phi = acos(2.0 * rand() - 1.0);
    
    return vec3<f32>(
        r * sin(phi) * cos(theta),
        r * sin(phi) * sin(theta),
        r * cos(phi)
    );
}

fn randomPointInBox(boxX: f32, boxY: f32, boxZ: f32) -> vec3<f32> {
    return vec3<f32>(
        (rand() - 0.5) * boxX,
        (rand() - 0.5) * boxY,
        (rand() - 0.5) * boxZ
    );
}

fn randomPointInCone(angle: f32, height: f32) -> vec3<f32> {
    // Random height along cone
    let h = rand() * height;
    // Radius at this height
    let maxRadius = tan(angle) * h;
    let r = sqrt(rand()) * maxRadius;
    let theta = rand() * 6.28318;
    
    return vec3<f32>(
        r * cos(theta),
        h,
        r * sin(theta)
    );
}

fn randomPointOnDisc(radius: f32) -> vec3<f32> {
    let r = sqrt(rand()) * radius;
    let theta = rand() * 6.28318;
    
    return vec3<f32>(
        r * cos(theta),
        0.0,
        r * sin(theta)
    );
}

fn generatePosition() -> vec3<f32> {
    var localPos: vec3<f32>;
    
    switch params.shape {
        case 0u: { // Sphere
            localPos = randomPointInSphere(params.radius);
        }
        case 1u: { // Box
            localPos = randomPointInBox(params.boxX, params.boxY, params.boxZ);
        }
        case 2u: { // Cone
            localPos = randomPointInCone(params.coneAngle, params.boxY);
        }
        case 3u: { // Disc
            localPos = randomPointOnDisc(params.radius);
        }
        default: {
            localPos = vec3<f32>(0.0, 0.0, 0.0);
        }
    }
    
    return vec3<f32>(params.centerX, params.centerY, params.centerZ) + localPos;
}

// =============================================================================
// VELOCITY GENERATION BY PATTERN
// =============================================================================

fn randomVelocity() -> vec3<f32> {
    let theta = rand() * 6.28318;
    let phi = acos(2.0 * rand() - 1.0);
    let speed = params.baseSpeed + (rand() - 0.5) * params.speedVariation;
    
    return vec3<f32>(
        speed * sin(phi) * cos(theta),
        speed * sin(phi) * sin(theta),
        speed * cos(phi)
    );
}

fn explosiveVelocity(pos: vec3<f32>) -> vec3<f32> {
    let center = vec3<f32>(params.centerX, params.centerY, params.centerZ);
    let dir = normalize(pos - center);
    let speed = params.baseSpeed + rand() * params.speedVariation;
    return dir * speed;
}

fn implosiveVelocity(pos: vec3<f32>) -> vec3<f32> {
    let center = vec3<f32>(params.centerX, params.centerY, params.centerZ);
    let dir = normalize(center - pos);
    let speed = params.baseSpeed + rand() * params.speedVariation;
    return dir * speed;
}

fn directionalVelocity() -> vec3<f32> {
    let dir = normalize(vec3<f32>(params.dirX, params.dirY, params.dirZ));
    let spread = 0.2; // Cone spread
    let theta = rand() * 6.28318;
    let phi = rand() * spread;
    
    // Create orthogonal basis
    let up = vec3<f32>(0.0, 1.0, 0.0);
    let tangent = normalize(cross(dir, up));
    let bitangent = cross(dir, tangent);
    
    let spreadDir = tangent * cos(theta) * sin(phi) + bitangent * sin(theta) * sin(phi) + dir * cos(phi);
    let speed = params.baseSpeed + (rand() - 0.5) * params.speedVariation;
    
    return normalize(spreadDir) * speed;
}

fn spiralVelocity(pos: vec3<f32>) -> vec3<f32> {
    let center = vec3<f32>(params.centerX, params.centerY, params.centerZ);
    let toCenter = pos - center;
    let dist = length(toCenter.xz);
    
    // Tangential direction for spiral
    let tangent = normalize(vec3<f32>(-toCenter.z, 0.0, toCenter.x));
    // Upward/outward direction
    let outward = normalize(toCenter);
    
    let speed = params.baseSpeed + rand() * params.speedVariation;
    return (tangent * 0.7 + outward * 0.3) * speed;
}

fn generateVelocity(pos: vec3<f32>) -> vec3<f32> {
    switch params.velocityPattern {
        case 0u: { // Random
            return randomVelocity();
        }
        case 1u: { // Explosive
            return explosiveVelocity(pos);
        }
        case 2u: { // Implosive
            return implosiveVelocity(pos);
        }
        case 3u: { // Directional
            return directionalVelocity();
        }
        case 4u: { // Spiral
            return spiralVelocity(pos);
        }
        default: {
            return randomVelocity();
        }
    }
}

// =============================================================================
// MAIN SPAWN ENTRY POINT
// =============================================================================

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let localIndex = globalId.x;
    
    // Check bounds
    if (localIndex >= params.spawnCount) {
        return;
    }
    
    let particleIndex = params.startIndex + localIndex;
    
    // Wrap around if exceeding total count
    if (particleIndex >= params.totalCount) {
        return;
    }
    
    // Seed RNG
    seedRand(particleIndex + u32(params.timeSeed * 1000.0));
    
    // Generate position
    let pos = generatePosition();
    
    // Generate velocity
    let vel = generateVelocity(pos);
    
    // Generate life
    let life = params.lifeMin + rand() * (params.lifeMax - params.lifeMin);
    
    // Write particle data
    particles.positions[particleIndex] = pos;
    particles.velocities[particleIndex] = vel;
    particles.lives[particleIndex] = life;
    particles.seeds[particleIndex] = rand() * 1000.0;
}
