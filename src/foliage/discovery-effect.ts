import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
    time, color, positionLocal, vec3, attribute, float,
    mix, sin, cos, positionWorld, abs, step
} from 'three/tsl';

/**
 * Creates a magical, audio-reactive particle burst effect triggered upon rare flora discovery.
 * Utilizes TSL to offload physics and animation logic (expansion, fading, twinkling) to the GPU.
 */
export function createDiscoveryEffect() {
    const MAX_PARTICLES = 200;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(MAX_PARTICLES * 3);
    const velocities = new Float32Array(MAX_PARTICLES * 3);
    const phases = new Float32Array(MAX_PARTICLES); // For twinkle offset
    const spawnTimes = new Float32Array(MAX_PARTICLES); // To track particle life
    const sizes = new Float32Array(MAX_PARTICLES);

    for (let i = 0; i < MAX_PARTICLES; i++) {
        // Initialize at origin (will be repositioned dynamically on trigger)
        positions[i * 3] = 0;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = 0;

        // Spherical velocity distribution
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const speed = 2.0 + Math.random() * 3.0; // Explosion outward speed

        velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
        velocities[i * 3 + 1] = Math.cos(phi) * speed;
        velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;

        phases[i] = Math.random() * Math.PI * 2;
        spawnTimes[i] = -999.0; // Initialize as inactive (spawn time far in past)
        sizes[i] = 0.5 + Math.random() * 1.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute('aSpawnTime', new THREE.BufferAttribute(spawnTimes, 1));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    // Create the Node Material for the particle burst
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    // --- TSL Logic ---

    // TSL Attributes mapping
    const aVelocity = attribute('aVelocity', 'vec3');
    const aPhase = attribute('aPhase', 'float');
    const aSpawnTime = attribute('aSpawnTime', 'float');
    const aSize = attribute('aSize', 'float');

    // Calculate age of each particle based on current time
    const age = time.sub(aSpawnTime);

    // Life duration for particles is ~2.0 seconds
    const maxLife = float(2.0);

    // Normalize age between 0.0 and 1.0. If age < 0, it means it's inactive (or hasn't spawned)
    const normalizedAge = age.div(maxLife);

    // Physics Simulation (GPU Side):
    // Position = Initial_Position + Velocity * age * drag
    // Here we apply a simple linear expansion that slows down over time (simulated drag)
    const expansionCurve = age.sub(age.pow(2.0).mul(0.2)); // Slows down
    const offset = aVelocity.mul(expansionCurve);

    // Final vertex position
    material.positionNode = positionLocal.add(offset);

    // Size: Starts large, shrinks as it gets older
    // Base size multiplied by fade curve
    const sizeMultiplier = float(1.0).sub(normalizedAge);
    // Multiply by the original base size for the particle
    material.sizeNode = aSize.mul(20.0).mul(sizeMultiplier);

    // Color Logic: Magical Cyan/Pink shift and twinkle
    // Shift color over particle life from Cyan (0x00FFFF) to Pink (0xFF69B4)
    const colorCyan = color(0x00ffff);
    const colorPink = color(0xff69b4);

    // Twinkle effect using sin combined with the phase attribute
    const twinkle = sin(time.mul(10.0).add(aPhase)).mul(0.5).add(0.5); // 0.0 to 1.0

    // Mix color over age
    const baseColor = mix(colorCyan, colorPink, normalizedAge);

    // Fade out completely when age > maxLife
    // Ensure visibility is 0 if not yet triggered (age < 0) or dead (age > 1.0)
    // We can use a step function or smoothstep for fading.
    // Opacity peaks instantly, then fades out over maxLife
    const opacity = float(1.0).sub(normalizedAge).mul(twinkle);
    // Clamp to 0 if outside active window
    const isActive = step(float(0.0), normalizedAge).mul(step(normalizedAge, float(1.0)));

    material.colorNode = baseColor.mul(opacity).mul(isActive);

    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false; // Always render when triggered

    // Trigger mechanism
    const trigger = (position: THREE.Vector3, currentTime: number) => {
        // Update all particles to spawn at the new position and time
        const posAttr = geometry.attributes.position as THREE.BufferAttribute;
        const spawnTimeAttr = geometry.attributes.aSpawnTime as THREE.BufferAttribute;

        for (let i = 0; i < MAX_PARTICLES; i++) {
            posAttr.setXYZ(i, position.x, position.y, position.z);
            spawnTimeAttr.setX(i, currentTime);
        }

        posAttr.needsUpdate = true;
        spawnTimeAttr.needsUpdate = true;
    };

    return { mesh, trigger };
}
