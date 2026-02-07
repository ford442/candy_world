import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute, float, mix, color, vec3, smoothstep, sin, positionLocal,
    exp, rotate, normalize, time, vec4
} from 'three/tsl';
import { uTime, uAudioHigh } from './common.ts';

const MAX_PARTICLES = 4000; // Increased capacity for juice
let _impactMesh = null;
let _head = 0;

const IMPACT_CONFIG = {
    jump: { count: 20 },
    land: { count: 40 },
    dash: { count: 30 },
    berry: { count: 15 },
    snare: { count: 25 },
    mist: { count: 20 },
    rain: { count: 30 },
    trail: { count: 1 },
    muzzle: { count: 10 },
    spore: { count: 12 }
};

export function createImpactSystem() {
    // 1. Geometry: "Candy Crumb" (Low Poly Sphere)
    // Icosahedron with detail 0 = 20 faces. Perfect for crunchy particles.
    const geometry = new THREE.IcosahedronGeometry(0.15, 0);

    // 2. Material (TSL)
    // OPTIMIZATION: Pack all attributes into 'instanceMatrix' to save buffers
    // instanceMatrix is 4x4, giving us 4 vec4 columns (16 floats per instance).
    // Layout:
    // Col 0: spawnPosition.xyz, birthTime
    // Col 1: velocity.xyz, lifeSpan
    // Col 2: color.rgb, size
    // Col 3: rotationAxis.xyz, gravityScale

    const mat = new MeshStandardNodeMaterial({
        color: 0xFFFFFF,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        depthWrite: false, // Particles don't occlude
    });

    // --- TSL LOGIC ---
    // Retrieve the matrix attribute. Note: This assumes the material doesn't apply
    // the default instance transform because we override positionNode below.
    const instanceMat = attribute('instanceMatrix', 'mat4');

    // Extract columns using basis vectors
    const col0 = instanceMat.mul(vec4(1, 0, 0, 0));
    const col1 = instanceMat.mul(vec4(0, 1, 0, 0));
    const col2 = instanceMat.mul(vec4(0, 0, 1, 0));
    const col3 = instanceMat.mul(vec4(0, 0, 0, 1));

    // Map to logic variables
    const spawnPos = col0.xyz;
    const birthTime = col0.w;
    
    const velocity = col1.xyz;
    const lifeSpan = col1.w;

    const colorAttr = col2.rgb;
    const sizeAttr = col2.w;

    const rotAxis = col3.xyz;
    const gravityScale = col3.w;

    // Age & Progress
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan);
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // 1. Physics: Explosive Drag + Gravity
    const drag = float(2.0);
    // Integral of v*exp(-drag*t)
    const explosiveDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    const gravity = vec3(0.0, -12.0, 0.0); // Slightly heavier gravity for chunks
    const gravityDrop = gravity.mul(gravityScale).mul(age.mul(age).mul(0.5));

    const particleWorldPos = spawnPos.add(explosiveDist).add(gravityDrop);

    // 2. Rotation (Spin)
    const spinSpeed = float(10.0);
    const rotationAngle = age.mul(spinSpeed);
    const rotatedLocal = rotate(positionLocal, normalize(rotAxis), rotationAngle);

    // 3. Scaling (Pop in, Shrink out)
    const scale = sizeAttr.mul(float(1.0).sub(lifeProgress));
    // Apply scale to rotated local vertex
    const scaledLocal = rotatedLocal.mul(scale);

    // Final Position Node
    // This OVERRIDES the default vertex position logic, effectively ignoring the 
    // garbage transform that 'instanceMatrix' would normally produce.
    mat.positionNode = particleWorldPos.add(scaledLocal);

    // 4. Color & Juice
    // Audio Shimmer
    const shimmer = sin(age.mul(20.0).add(uAudioHigh.mul(10.0))).mul(0.2).add(1.0);

    // Fade Out
    const opacity = float(1.0).sub(smoothstep(0.7, 1.0, lifeProgress));

    mat.colorNode = colorAttr.mul(shimmer);
    mat.opacityNode = opacity.mul(isAlive);

    // 5. Mesh Creation
    _impactMesh = new THREE.InstancedMesh(geometry, mat, MAX_PARTICLES);
    _impactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _impactMesh.count = MAX_PARTICLES; 
    _impactMesh.castShadow = false;
    _impactMesh.receiveShadow = false;
    _impactMesh.frustumCulled = false;
    _impactMesh.userData.isImpactSystem = true;
    
    // Disable raycasting as the geometry doesn't match the matrix
    _impactMesh.raycast = () => {};

    // Initialize Birth Times to -1000 (Dead)
    // Layout: Col 0 W component (Index 3, 19, 35...)
    const array = _impactMesh.instanceMatrix.array;
    for (let i = 0; i < MAX_PARTICLES; i++) {
        // Stride 16. BirthTime is at offset 3.
        array[i * 16 + 3] = -1000.0;
    }
    _impactMesh.instanceMatrix.needsUpdate = true;

    return _impactMesh;
}

export function spawnImpact(pos, type = 'jump', options = {}) {
    if (!_impactMesh) return;

    // Use the single instanceMatrix buffer
    const array = _impactMesh.instanceMatrix.array;
    const config = IMPACT_CONFIG[type] || IMPACT_CONFIG.jump;
    const count = config.count;
    const now = (uTime.value !== undefined) ? uTime.value : performance.now() / 1000;

    const colorOverride = options.color;
    const direction = options.direction;

    for (let i = 0; i < count; i++) {
        const idx = _head;
        _head = (_head + 1) % MAX_PARTICLES;
        const offset = idx * 16;

        // Spawn Position (Randomized slightly)
        const ox = (Math.random() - 0.5) * 0.5;
        const oy = (Math.random() - 0.5) * 0.5;
        const oz = (Math.random() - 0.5) * 0.5;
        
        // Write Col 0: SpawnPos (xyz), BirthTime (w)
        array[offset + 0] = pos.x + ox;
        array[offset + 1] = pos.y + oy;
        array[offset + 2] = pos.z + oz;
        array[offset + 3] = now;

        // Velocity Logic
        let vx, vy, vz;
        let gScale = 1.0;

        if (type === 'jump') {
             const theta = Math.random() * Math.PI * 2;
             const r = Math.random() * 2.0;
             vx = Math.cos(theta) * r;
             vy = 3.0 + Math.random() * 4.0;
             vz = Math.sin(theta) * r;
        } else if (type === 'land') {
             const theta = Math.random() * Math.PI * 2;
             const r = 4.0 + Math.random() * 3.0;
             vx = Math.cos(theta) * r;
             vy = 1.0 + Math.random() * 2.0;
             vz = Math.sin(theta) * r;
        } else if (type === 'dash') {
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 4.0 + Math.random() * 6.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'berry') {
             const theta = Math.random() * Math.PI * 2;
             const phi = Math.random() * Math.PI;
             const speed = 2.0 + Math.random() * 4.0;
             vx = Math.sin(phi) * Math.cos(theta) * speed;
             vy = Math.cos(phi) * speed;
             vz = Math.sin(phi) * Math.sin(theta) * speed;
        } else if (type === 'snare') {
            const theta = Math.random() * Math.PI * 2;
            const r = 2.0 + Math.random() * 3.0;
            vx = Math.cos(theta) * r;
            vy = 2.0 + Math.random() * 5.0; 
            vz = Math.sin(theta) * r;
        } else if (type === 'mist') {
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.5;
            vx = Math.cos(theta) * r;
            vy = 2.0 + Math.random() * 3.0; 
            vz = Math.sin(theta) * r;
            gScale = -0.5; 
        } else if (type === 'rain') {
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 1.0;
            vx = Math.cos(theta) * r;
            vy = -5.0 - Math.random() * 5.0; 
            vz = Math.sin(theta) * r;
            gScale = 2.0; 
        } else if (type === 'spore') {
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 2.0;
            vx = Math.cos(theta) * r;
            vy = 1.0 + Math.random() * 2.0; 
            vz = Math.sin(theta) * r;
            gScale = -0.2; 
        } else if (type === 'trail') {
            vx = (Math.random() - 0.5) * 0.5;
            vy = (Math.random() - 0.5) * 0.5;
            vz = (Math.random() - 0.5) * 0.5;
            gScale = 0.0;
        } else if (type === 'muzzle') {
            if (direction) {
                const speed = 10.0 + Math.random() * 5.0;
                const spread = 2.0;
                vx = direction.x * speed + (Math.random() - 0.5) * spread;
                vy = direction.y * speed + (Math.random() - 0.5) * spread;
                vz = direction.z * speed + (Math.random() - 0.5) * spread;
            } else {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const speed = 5.0 + Math.random() * 5.0;
                vx = Math.sin(phi) * Math.cos(theta) * speed;
                vy = Math.cos(phi) * speed;
                vz = Math.sin(phi) * Math.sin(theta) * speed;
            }
            gScale = 0.5;
        }

        // Life
        let life = 0.5 + Math.random() * 0.5;
        if (type === 'trail') life = 0.3 + Math.random() * 0.2;
        else if (type === 'muzzle') life = 0.15 + Math.random() * 0.15;
        else if (type === 'spore') life = 1.5 + Math.random() * 1.5;

        // Write Col 1: Velocity (xyz), LifeSpan (w)
        array[offset + 4] = vx;
        array[offset + 5] = vy;
        array[offset + 6] = vz;
        array[offset + 7] = life;

        // Color
        let r=1, g=1, b=1;
        if (colorOverride) {
            r = colorOverride.r; g = colorOverride.g; b = colorOverride.b;
        } else if (type === 'jump') { r=1.0; g=0.8; b=0.2; }
        else if (type === 'land') { r=0.6; g=0.5; b=0.4; }
        else if (type === 'dash') { r=0.0; g=1.0; b=1.0; }
        else if (type === 'berry') {
            if (Math.random() > 0.5) { r=1.0; g=0.2; b=0.5; }
            else { r=1.0; g=0.6; b=0.0; }
        }
        else if (type === 'snare') { r=1.0; g=0.1; b=0.1; }
        else if (type === 'mist') { r=0.9; g=0.9; b=1.0; }
        else if (type === 'rain') { r=0.2; g=0.2; b=1.0; }
        else if (type === 'spore') {
            const rand = Math.random();
            if (rand < 0.33) { r=0.0; g=1.0; b=1.0; }
            else if (rand < 0.66) { r=1.0; g=0.0; b=1.0; }
            else { r=0.5; g=1.0; b=0.0; }
        }

        // Size
        let size = 0.5 + Math.random() * 1.0;
        if (type === 'trail') size = 0.3 + Math.random() * 0.2;
        else if (type === 'muzzle') size = 0.5 + Math.random() * 0.5;
        else if (type === 'spore') size = 0.2 + Math.random() * 0.3;

        // Write Col 2: Color (rgb), Size (w)
        array[offset + 8] = r;
        array[offset + 9] = g;
        array[offset + 10] = b;
        array[offset + 11] = size;

        // Rotation & Gravity
        // Write Col 3: RotAxis (xyz), GravityScale (w)
        array[offset + 12] = Math.random()-0.5;
        array[offset + 13] = Math.random()-0.5;
        array[offset + 14] = Math.random()-0.5;
        array[offset + 15] = gScale;
    }

    // Flag Update
    _impactMesh.instanceMatrix.needsUpdate = true;
}
