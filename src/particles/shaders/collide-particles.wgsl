/**
 * Particle Collision Compute Shader (WGSL)
 * 
 * Handles collision detection between particles and:
 * - Ground height (from WASM height lookup texture)
 * - Obstacles (trees, rocks, etc.)
 * - Water surface
 * 
 * Features:
 * - Height texture sampling for ground collision
 * - Simple sphere collision for obstacles
 * - Bounce physics with energy loss
 * - Collision response velocity adjustment
 */

struct ParticleData {
    positions: array<vec3<f32>>,
    velocities: array<vec3<f32>>,
    lives: array<f32>,
    sizes: array<f32>,
    seeds: array<f32>,
};

struct CollisionParams {
    deltaTime: f32,
    time: f32,
    count: u32,
    
    // Height texture parameters
    heightTextureWidth: u32,
    heightTextureHeight: u32,
    worldMinX: f32,
    worldMaxX: f32,
    worldMinZ: f32,
    worldMaxZ: f32,
    
    // Particle type
    particleType: u32,
    
    // Bounce parameters
    restitution: f32,     // Bounciness (0-1)
    friction: f32,        // Surface friction (0-1)
    
    // Water level
    waterLevel: f32,
};

// Obstacle data (simplified as spheres)
struct Obstacle {
    x: f32,
    y: f32,
    z: f32,
    radius: f32,
};

struct ObstacleList {
    count: u32,
    obstacles: array<Obstacle>,
};

@group(0) @binding(0) var<storage, read_write> particles: ParticleData;
@group(0) @binding(1) var<uniform> params: CollisionParams;
@group(0) @binding(2) var heightTexture: texture_2d<f32>;
@group(0) @binding(3) var heightSampler: sampler;
@group(0) @binding(4) var<storage, read> obstacles: ObstacleList;

// =============================================================================
// GROUND HEIGHT SAMPLING
// =============================================================================

fn sampleGroundHeight(worldX: f32, worldZ: f32) -> f32 {
    // Normalize world coordinates to UV space
    let u = (worldX - params.worldMinX) / (params.worldMaxX - params.worldMinX);
    let v = (worldZ - params.worldMinZ) / (params.worldMaxZ - params.worldMinZ);
    
    // Sample height texture
    let height = textureSampleLevel(heightTexture, heightSampler, vec2<f32>(u, v), 0.0).r;
    
    // Height texture stores normalized height, scale to world
    return height * 50.0; // Assuming max height of 50 units
}

fn getGroundNormal(worldX: f32, worldZ: f32) -> vec3<f32> {
    let delta = 0.5; // Sample offset
    
    let hL = sampleGroundHeight(worldX - delta, worldZ);
    let hR = sampleGroundHeight(worldX + delta, worldZ);
    let hD = sampleGroundHeight(worldX, worldZ - delta);
    let hU = sampleGroundHeight(worldX, worldZ + delta);
    
    // Normal from height differences
    let normal = vec3<f32>(hL - hR, 2.0 * delta, hD - hU);
    return normalize(normal);
}

// =============================================================================
// OBSTACLE COLLISION
// =============================================================================

fn checkObstacleCollision(pos: vec3<f32>, radius: f32) -> vec4<f32> {
    // Returns: (hit, pushX, pushY, pushZ)
    // hit = 1.0 if collision occurred, 0.0 otherwise
    
    for (var i: u32 = 0u; i < obstacles.count; i = i + 1u) {
        let obstacle = obstacles.obstacles[i];
        let obsPos = vec3<f32>(obstacle.x, obstacle.y, obstacle.z);
        
        let toParticle = pos - obsPos;
        let dist = length(toParticle);
        let minDist = radius + obstacle.radius;
        
        if (dist < minDist) {
            // Collision detected - return push vector
            let pushDir = normalize(toParticle);
            let pushDist = minDist - dist;
            return vec4<f32>(1.0, pushDir.x * pushDist, pushDir.y * pushDist, pushDir.z * pushDist);
        }
    }
    
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}

// =============================================================================
// COLLISION RESPONSE
// =============================================================================

fn applyGroundCollision(pos: ptr<function, vec3<f32>>, vel: ptr<function, vec3<f32>>, radius: f32) -> bool {
    let groundHeight = sampleGroundHeight((*pos).x, (*pos).z);
    let particleBottom = (*pos).y - radius;
    
    if (particleBottom < groundHeight) {
        // Push out of ground
        (*pos).y = groundHeight + radius;
        
        // Get ground normal for bounce direction
        let normal = getGroundNormal((*pos).x, (*pos).z);
        
        // Reflect velocity
        let vDotN = dot(*vel, normal);
        let reflection = normal * vDotN * 2.0;
        
        // Apply restitution (bounciness)
        *vel = (*vel - reflection) * params.restitution;
        
        // Apply friction to horizontal components
        (*vel).x = (*vel).x * (1.0 - params.friction);
        (*vel).z = (*vel).z * (1.0 - params.friction);
        
        return true;
    }
    
    return false;
}

fn applyObstacleCollision(pos: ptr<function, vec3<f32>>, vel: ptr<function, vec3<f32>>, radius: f32) -> bool {
    let collision = checkObstacleCollision(*pos, radius);
    
    if (collision.x > 0.5) {
        // Push out of obstacle
        *pos = *pos + vec3<f32>(collision.y, collision.z, collision.w);
        
        // Reflect velocity (simplified - assume normal is push direction)
        let normal = normalize(vec3<f32>(collision.y, collision.z, collision.w));
        let vDotN = dot(*vel, normal);
        let reflection = normal * vDotN * 2.0;
        
        *vel = (*vel - reflection) * params.restitution;
        
        return true;
    }
    
    return false;
}

fn applyWaterCollision(pos: ptr<function, vec3<f32>>, vel: ptr<function, vec3<f32>>, radius: f32) -> bool {
    // Simple water collision - particles die or float
    if ((*pos).y < params.waterLevel + radius) {
        // For rain/splash effects, kill particle
        // For floating particles, apply buoyancy
        
        switch params.particleType {
            case 3u: { // Rain - die on water
                return true; // Signal to kill
            }
            default: {
                // Float on water surface
                (*pos).y = params.waterLevel + radius;
                (*vel).y = abs((*vel).y) * 0.3; // Damped bounce
                (*vel).x = (*vel).x * 0.9; // Water drag
                (*vel).z = (*vel).z * 0.9;
            }
        }
    }
    
    return false;
}

// =============================================================================
// MAIN COLLISION ENTRY POINT
// =============================================================================

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
    let index = globalId.x;
    if (index >= params.count) {
        return;
    }
    
    var pos = particles.positions[index];
    var vel = particles.velocities[index];
    let size = particles.sizes[index];
    let radius = size * 0.5;
    
    var killParticle = false;
    
    // Ground collision
    applyGroundCollision(&pos, &vel, radius);
    
    // Obstacle collision
    applyObstacleCollision(&pos, &vel, radius);
    
    // Water collision (may kill particle)
    if (applyWaterCollision(&pos, &vel, radius)) {
        killParticle = true;
    }
    
    // Write back
    particles.positions[index] = pos;
    particles.velocities[index] = vel;
    
    // Kill if requested
    if (killParticle) {
        particles.lives[index] = 0.0;
    }
}
