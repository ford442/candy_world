import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute, float, sin, positionLocal,
    exp, rotate, normalize, vec4, vec3, smoothstep
} from 'three/tsl';
import { uTime, uAudioHigh } from './common.ts';

const MAX_PARTICLES = 4000; // Increased capacity for juice
let _impactMesh: THREE.InstancedMesh | null = null;
let _head = 0;

export type ImpactType =
  | 'jump'
  | 'land'
  | 'dash'
  | 'berry'
  | 'snare'
  | 'mist'
  | 'rain'
  | 'spore'
  | 'trail'
  | 'muzzle';

interface ImpactConfigItem {
    count: number;
}

const IMPACT_CONFIG: Record<ImpactType, ImpactConfigItem> = {
    jump: { count: 20 },
    land: { count: 40 },
    dash: { count: 30 },
    berry: { count: 15 },
    snare: { count: 25 },
    mist: { count: 20 },
    rain: { count: 30 },
    spore: { count: 10 },
    trail: { count: 1 },
    muzzle: { count: 5 } // Fast burst
};

export interface SpawnOptions {
    color?: { r: number; g: number; b: number };
    direction?: THREE.Vector3 | { x: number; y: number; z: number };
}

export function createImpactSystem(): THREE.InstancedMesh {
    if (_impactMesh) return _impactMesh;

    // Candy Crumbs Geometry
    // OPTIMIZATION: Use Icosahedron (low poly) instead of Sphere
    // Fixes WebGPU pointUV issue and allows rotation
    const geometry = new THREE.IcosahedronGeometry(0.1, 0);

    // JUICE: Custom TSL Material for particles
    const mat = new MeshStandardNodeMaterial({
        color: 0xFFFFFF,
        roughness: 0.4,
        metalness: 0.1,
        transparent: true,
        depthWrite: false, // Particles don't occlude
    });

    // --- TSL LOGIC ---
    // Use dedicated attributes instead of packing into instanceMatrix
    // This fixes "AttributeNode: Vertex attribute 'instanceMatrix' not found" error
    const aSpawn = attribute('aSpawn', 'vec4');
    const aVelocity = attribute('aVelocity', 'vec4');
    const aColor = attribute('aColor', 'vec4');
    const aMisc = attribute('aMisc', 'vec4');

    // Map to logic variables
    const spawnPos = aSpawn.xyz;
    const birthTime = aSpawn.w;
    
    const velocity = aVelocity.xyz;
    const lifeSpan = aVelocity.w;

    const colorAttr = aColor.rgb;
    const sizeAttr = aColor.w;

    const rotAxis = aMisc.xyz;
    const gravityScale = aMisc.w;

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

    // Custom Attributes for TSL
    const spawnArray = new Float32Array(MAX_PARTICLES * 4);
    const velArray = new Float32Array(MAX_PARTICLES * 4);
    const colorArray = new Float32Array(MAX_PARTICLES * 4);
    const miscArray = new Float32Array(MAX_PARTICLES * 4);

    _impactMesh.geometry.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawnArray, 4));
    _impactMesh.geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(velArray, 4));
    _impactMesh.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colorArray, 4));
    _impactMesh.geometry.setAttribute('aMisc', new THREE.InstancedBufferAttribute(miscArray, 4));

    // Set usage
    (_impactMesh.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (_impactMesh.geometry.getAttribute('aVelocity') as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (_impactMesh.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (_impactMesh.geometry.getAttribute('aMisc') as THREE.InstancedBufferAttribute).setUsage(THREE.DynamicDrawUsage);
    
    // Disable raycasting as the geometry doesn't match the matrix
    _impactMesh.raycast = () => {};

    // Initialize Birth Times to -1000 (Dead)
    for (let i = 0; i < MAX_PARTICLES; i++) {
        spawnArray[i * 4 + 3] = -1000.0;
    }
    (_impactMesh.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute).needsUpdate = true;
    _impactMesh.instanceMatrix.needsUpdate = true; // Still needed for internal consistency

    return _impactMesh;
}

export function spawnImpact(pos: THREE.Vector3 | {x:number, y:number, z:number}, type: ImpactType = 'jump', options?: SpawnOptions) {
    if (!_impactMesh) return;

    const spawnAttr = _impactMesh.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute;
    const velAttr = _impactMesh.geometry.getAttribute('aVelocity') as THREE.InstancedBufferAttribute;
    const colorAttr = _impactMesh.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute;
    const miscAttr = _impactMesh.geometry.getAttribute('aMisc') as THREE.InstancedBufferAttribute;

    const spawnArray = spawnAttr.array as Float32Array;
    const velArray = velAttr.array as Float32Array;
    const colorArray = colorAttr.array as Float32Array;
    const miscArray = miscAttr.array as Float32Array;

    const config = IMPACT_CONFIG[type] || IMPACT_CONFIG.jump;
    const count = config.count;
    const now = (uTime.value !== undefined) ? uTime.value : performance.now() / 1000;

    const colorOverride = options ? options.color : undefined;
    const direction = options ? options.direction : undefined;

    for (let i = 0; i < count; i++) {
        const idx = _head;
        _head = (_head + 1) % MAX_PARTICLES;
        const offset = idx * 4;

        // Spawn Position (Randomized slightly)
        const ox = (Math.random() - 0.5) * 0.5;
        const oy = (Math.random() - 0.5) * 0.5;
        const oz = (Math.random() - 0.5) * 0.5;
        
        // Write aSpawn: SpawnPos (xyz), BirthTime (w)
        spawnArray[offset + 0] = pos.x + ox;
        spawnArray[offset + 1] = pos.y + oy;
        spawnArray[offset + 2] = pos.z + oz;
        spawnArray[offset + 3] = now;

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

        // Write aVelocity: Velocity (xyz), LifeSpan (w)
        velArray[offset + 0] = vx;
        velArray[offset + 1] = vy;
        velArray[offset + 2] = vz;
        velArray[offset + 3] = life;

        // Color
        let r=1, g=1, b=1;
        if (colorOverride) {
            r = colorOverride.r!; g = colorOverride.g!; b = colorOverride.b!;
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

        // Write aColor: Color (rgb), Size (w)
        colorArray[offset + 0] = r;
        colorArray[offset + 1] = g;
        colorArray[offset + 2] = b;
        colorArray[offset + 3] = size;

        // Rotation & Gravity
        // Write aMisc: RotAxis (xyz), GravityScale (w)
        miscArray[offset + 0] = Math.random()-0.5;
        miscArray[offset + 1] = Math.random()-0.5;
        miscArray[offset + 2] = Math.random()-0.5;
        miscArray[offset + 3] = gScale;
    }

    // Flag Update
    (spawnAttr as THREE.InstancedBufferAttribute).needsUpdate = true;
    (velAttr as THREE.InstancedBufferAttribute).needsUpdate = true;
    (colorAttr as THREE.InstancedBufferAttribute).needsUpdate = true;
    (miscAttr as THREE.InstancedBufferAttribute).needsUpdate = true;
}
