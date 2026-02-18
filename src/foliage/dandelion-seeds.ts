import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
    attribute, float, sin, cos, positionLocal, normalLocal,
    exp, rotate, normalize, vec4, vec3, smoothstep, step,
    mix, color
} from 'three/tsl';
import { uTime, uAudioHigh, uWindSpeed, uWindDirection, createSugarSparkle } from './common.ts';

const MAX_SEEDS = 2000;
let _seedMesh: THREE.InstancedMesh | null = null;
let _spawnAttr: THREE.InstancedBufferAttribute | null = null;
let _velAttr: THREE.InstancedBufferAttribute | null = null;
let _miscAttr: THREE.InstancedBufferAttribute | null = null;
let _head = 0;

// Colors
const COLOR_STALK = new THREE.Color(0xFFFFFF); // White
const COLOR_TIP = new THREE.Color(0xFFD700);   // Gold

export function createDandelionSeedSystem(): THREE.InstancedMesh {
    if (_seedMesh) return _seedMesh;

    // --- 1. Geometry Construction (Stalk + Tip) ---
    // Reusing logic from DandelionBatcher to match visuals

    // A. Stalk
    const stalkGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.4, 3);
    stalkGeo.translate(0, 0.2, 0); // Pivot at bottom

    // B. Tip
    const tipGeo = new THREE.SphereGeometry(0.04, 6, 6);
    tipGeo.translate(0, 0.4, 0); // Tip at end of stalk

    // Add 'color' attribute to distinguish parts
    const stalkCount = stalkGeo.attributes.position.count;
    const tipCount = tipGeo.attributes.position.count;

    const stalkColors = new Float32Array(stalkCount * 3);
    for(let i=0; i<stalkCount; i++) {
        stalkColors[i*3] = COLOR_STALK.r;
        stalkColors[i*3+1] = COLOR_STALK.g;
        stalkColors[i*3+2] = COLOR_STALK.b;
    }
    stalkGeo.setAttribute('color', new THREE.BufferAttribute(stalkColors, 3));

    const tipColors = new Float32Array(tipCount * 3);
    for(let i=0; i<tipCount; i++) {
        tipColors[i*3] = COLOR_TIP.r;
        tipColors[i*3+1] = COLOR_TIP.g;
        tipColors[i*3+2] = COLOR_TIP.b;
    }
    tipGeo.setAttribute('color', new THREE.BufferAttribute(tipColors, 3));

    const geometry = mergeGeometries([stalkGeo, tipGeo]);
    geometry.computeBoundingSphere();


    // --- 2. TSL Material ---

    const mat = new MeshStandardNodeMaterial({
        vertexColors: true,
        roughness: 0.8,
        metalness: 0.0,
        transparent: true,
        depthWrite: false,
    });

    // Attributes
    const aSpawn = attribute('aSpawn', 'vec4');     // xyz: spawnPos, w: birthTime
    const aVelocity = attribute('aVelocity', 'vec4'); // xyz: velocity, w: lifeSpan
    const aMisc = attribute('aMisc', 'vec4');       // xyz: rotationAxis, w: randomPhase

    const spawnPos = aSpawn.xyz;
    const birthTime = aSpawn.w;

    const velocity = aVelocity.xyz;
    const lifeSpan = aVelocity.w;

    const rotAxis = aMisc.xyz;
    const randomPhase = aMisc.w;

    // Time & Age
    const age = uTime.sub(birthTime);
    const lifeProgress = age.div(lifeSpan);
    const isAlive = lifeProgress.greaterThan(0.0).and(lifeProgress.lessThan(1.0));

    // Physics: Floating
    // 1. Initial burst with drag
    const drag = float(1.5);
    const burstDist = velocity.mul(float(1.0).sub(exp(age.mul(drag).negate()))).div(drag);

    // 2. Wind Drift (starts affecting after initial burst slows down)
    const windInfluence = smoothstep(0.5, 2.0, age);
    const windDrift = uWindDirection.mul(uWindSpeed).mul(age.mul(windInfluence));

    // 3. Floating Sway (Sine wave up/down/side)
    const swayFreq = float(2.0);
    const swayAmp = float(0.2);
    const sway = vec3(
        sin(age.mul(swayFreq).add(randomPhase)).mul(swayAmp),
        cos(age.mul(swayFreq.mul(0.7)).add(randomPhase)).mul(swayAmp),
        sin(age.mul(swayFreq.mul(1.3)).add(randomPhase)).mul(swayAmp)
    );

    // 4. Gravity (Very slight downward drift, or updraft)
    const gravity = vec3(0.0, -0.2, 0.0);
    const gravityDrop = gravity.mul(age);

    const particleWorldPos = spawnPos.add(burstDist).add(windDrift).add(sway).add(gravityDrop);


    // Rotation: Tumbling
    const tumbleSpeed = float(2.0);
    const tumbleAngle = age.mul(tumbleSpeed).add(randomPhase);
    const rotatedLocal = rotate(positionLocal, normalize(rotAxis), tumbleAngle);

    // Apply Position
    mat.positionNode = particleWorldPos.add(rotatedLocal);

    // Color & Opacity
    const vColor = attribute('color', 'vec3');

    // Sparkle on Gold Tip
    // Detect Gold Tip: Red > 0.5 AND Blue < 0.1
    // Stalk: R=1, G=1, B=1
    // Tip: R=1, G=0.84, B=0
    // Low Blue check works
    const isGold = float(1.0).sub(step(0.1, vColor.b));

    const sparkle = createSugarSparkle(normalLocal, float(40.0), float(0.5), float(2.0));
    const emission = vColor.mul(sparkle).mul(isGold);

    mat.colorNode = vColor;
    mat.emissiveNode = emission;

    // Fade Out
    const opacity = float(1.0).sub(smoothstep(0.7, 1.0, lifeProgress));
    mat.opacityNode = opacity.mul(isAlive);


    // --- 3. Mesh Setup ---

    _seedMesh = new THREE.InstancedMesh(geometry, mat, MAX_SEEDS);
    _seedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    _seedMesh.count = MAX_SEEDS;
    _seedMesh.frustumCulled = false;
    _seedMesh.castShadow = false;
    _seedMesh.receiveShadow = false;
    _seedMesh.userData.isDandelionSeedSystem = true;

    // Custom Attributes
    const spawnArray = new Float32Array(MAX_SEEDS * 4);
    const velArray = new Float32Array(MAX_SEEDS * 4);
    const miscArray = new Float32Array(MAX_SEEDS * 4);

    _seedMesh.geometry.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(spawnArray, 4));
    _seedMesh.geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(velArray, 4));
    _seedMesh.geometry.setAttribute('aMisc', new THREE.InstancedBufferAttribute(miscArray, 4));

    _spawnAttr = _seedMesh.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute;
    _velAttr = _seedMesh.geometry.getAttribute('aVelocity') as THREE.InstancedBufferAttribute;
    _miscAttr = _seedMesh.geometry.getAttribute('aMisc') as THREE.InstancedBufferAttribute;

    _spawnAttr.setUsage(THREE.DynamicDrawUsage);
    _velAttr.setUsage(THREE.DynamicDrawUsage);
    _miscAttr.setUsage(THREE.DynamicDrawUsage);

    // Init to dead
    for(let i=0; i<MAX_SEEDS; i++) {
        spawnArray[i*4+3] = -1000.0;
    }
    _spawnAttr.needsUpdate = true;
    _velAttr.needsUpdate = true;
    _miscAttr.needsUpdate = true;
    // Dummy matrix update
    _seedMesh.instanceMatrix.needsUpdate = true;

    return _seedMesh;
}

export function spawnDandelionExplosion(
    center: THREE.Vector3,
    count: number = 24
) {
    if (!_seedMesh || !_spawnAttr || !_velAttr || !_miscAttr) return;

    const spawnArray = _spawnAttr.array as Float32Array;
    const velArray = _velAttr.array as Float32Array;
    const miscArray = _miscAttr.array as Float32Array;

    const now = ((uTime as any).value !== undefined) ? (uTime as any).value : performance.now() / 1000;

    for(let i=0; i<count; i++) {
        const idx = _head;
        _head = (_head + 1) % MAX_SEEDS;
        const offset = idx * 4;

        // Spread out start position slightly (radius of head)
        // Dandelion head radius approx 0.2
        const r = 0.2 * Math.cbrt(Math.random()); // Uniform sphere distribution
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        const dx = r * Math.sin(phi) * Math.cos(theta);
        const dy = r * Math.sin(phi) * Math.sin(theta);
        const dz = r * Math.cos(phi);

        spawnArray[offset + 0] = center.x + dx;
        spawnArray[offset + 1] = center.y + dy;
        spawnArray[offset + 2] = center.z + dz;
        spawnArray[offset + 3] = now;

        // Velocity: Explode outward from center
        // Add some randomness
        const speed = 2.0 + Math.random() * 3.0;
        const dir = new THREE.Vector3(dx, dy, dz).normalize();

        velArray[offset + 0] = dir.x * speed;
        velArray[offset + 1] = dir.y * speed;
        velArray[offset + 2] = dir.z * speed;
        velArray[offset + 3] = 4.0 + Math.random() * 4.0; // Life span (4-8s)

        // Misc: Rotation Axis & Phase
        miscArray[offset + 0] = Math.random() - 0.5;
        miscArray[offset + 1] = Math.random() - 0.5;
        miscArray[offset + 2] = Math.random() - 0.5;
        miscArray[offset + 3] = Math.random() * Math.PI * 2;
    }

    _spawnAttr.needsUpdate = true;
    _velAttr.needsUpdate = true;
    _miscAttr.needsUpdate = true;
}
