import * as THREE from 'three';
import { 
    color, time, uv, float, vec2, mix, sin, cos, step,   // ← added cos + step
    uniform, UniformNode, normalWorld, Fn, storage, 
    instanceIndex, vec3, positionLocal, max, length, min, abs 
} from 'three/tsl';
import { MeshStandardNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import { registerReactiveMaterial, attachReactivity, CandyPresets, uAudioHigh, uTime, createJuicyRimLight } from './index.ts';
/**
 * Creates a bioluminescent waterfall connecting two points.
 * @param {THREE.Vector3} startPos - Top position
 * @param {THREE.Vector3} endPos - Bottom position
 * @param {number} width - Width of the waterfall
 */
export function createWaterfall(startPos: THREE.Vector3, endPos: THREE.Vector3, width: number = 5.0): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Waterfall';
    const height = startPos.y - endPos.y;
    const midY = (startPos.y + endPos.y) / 2;

    // Cylinder (flat open ends)
    const geo = new THREE.CylinderGeometry(width, width * 1.5, height, 32, 16, true);

    // === SeaJelly material with bioluminescent flow ===
    const mat = CandyPresets.SeaJelly(0x00FFFF, {
        transmission: 0.9,
        thickness: 1.2,
        roughness: 0.1,
        ior: 1.33,
        subsurfaceStrength: 0.5,
        subsurfaceColor: 0xCCFFFF,
        animateMoisture: true,
        thicknessDistortion: 0.6,
        side: THREE.DoubleSide
    });

    const speed = 2.0;
    const flowUV = uv().add(vec2(0, time.mul(speed).negate()));

    const ripple1 = sin(flowUV.y.mul(15.0).add(flowUV.x.mul(5.0))).mul(0.5).add(0.5);
    const ripple2 = sin(flowUV.y.mul(25.0).sub(flowUV.x.mul(10.0)).add(time)).mul(0.5).add(0.5);
    const foam = ripple1.mul(ripple2);

    const uPulseIntensity = uniform(0.0);
    const uBaseEmission = float(0.2);

    const gradient = mix(color(0xFF00FF), color(0x00FFFF), uv().y);
    mat.colorNode = mix(mat.colorNode, gradient, 0.5);

    const rim = createJuicyRimLight(gradient, float(2.0), float(3.0), normalWorld);

    const emission = gradient.mul(uBaseEmission.add(uPulseIntensity)).mul(foam.add(0.2));
    const highIntensity = uAudioHigh.pow(float(1.5)).mul(1.5);
    mat.emissiveNode = emission.add(rim).add(gradient.mul(highIntensity));

    const currentRoughness = mat.roughnessNode || float(mat.roughness);
    mat.roughnessNode = currentRoughness.add(foam.mul(0.5));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(startPos.x, midY, startPos.z);
    mesh.userData.uPulseIntensity = uPulseIntensity;

    registerReactiveMaterial(mat);
    group.add(mesh);

    // === GPU Compute Splashes (Phase 4) ===
    const splashCount = 128;
    const positionBuffer = new StorageBufferAttribute(splashCount, 3);
    const velocityBuffer = new StorageBufferAttribute(splashCount, 3);

    // Initial particle positions/velocities
    for (let i = 0; i < splashCount; i++) {
        const x = startPos.x + (Math.random() - 0.5) * width;
        const y = endPos.y;
        const z = startPos.z + (Math.random() - 0.5) * width;
        positionBuffer.setXYZ(i, x, y, z);
        velocityBuffer.setXYZ(i,
            (Math.random() - 0.5) * 2.0,
            Math.random() * 8.0 + 2.0,
            (Math.random() - 0.5) * 2.0
        );
    }

    const positionStorage = storage(positionBuffer, 'vec3', splashCount);
    const velocityStorage = storage(velocityBuffer, 'vec3', splashCount);
    const baseFloorY = float(endPos.y);

    const computeSplashes = Fn(() => {
        const p = positionStorage.element(instanceIndex);
        const v = velocityStorage.element(instanceIndex);

        const dt = float(0.016);
        const gravity = vec3(0.0, -20.0, 0.0);

        // Audio-reactive impulse (only on strong beats)
        const audioImpulse = max(float(0.0), uPulseIntensity.sub(0.5)).mul(25.0);
        const randSeed = p.x.mul(10.0).add(p.z.mul(10.0)).add(time.mul(100.0));
        const impulseVar = sin(randSeed).mul(0.5).add(0.5);

        const appliedImpulse = vec3(
            sin(randSeed.mul(2.0)).mul(audioImpulse).mul(0.5),
            audioImpulse.mul(impulseVar),
            cos(randSeed.mul(3.0)).mul(audioImpulse).mul(0.5)
        );

        const acceleration = gravity.add(appliedImpulse);
        const newVel = v.add(acceleration.mul(dt));
        const nextPos = p.add(newVel.mul(dt));

        // Floor collision + respawn
        const bouncedVelY = abs(newVel.y).mul(0.4);
        const isTooSlow = step(bouncedVelY, 1.0);

        const respawnX = float(startPos.x).add(sin(randSeed).mul(width * 0.5));
        const respawnZ = float(startPos.z).add(cos(randSeed).mul(width * 0.5));
        const respawnVel = vec3(
            sin(randSeed.mul(5.0)).mul(1.0),
            abs(cos(randSeed.mul(4.0))).mul(8.0).add(2.0),
            cos(randSeed.mul(6.0)).mul(1.0)
        );

        const bouncePos = vec3(nextPos.x, baseFloorY, nextPos.z);
        const bounceVel = vec3(newVel.x, bouncedVelY, newVel.z);
        const respawnPos = vec3(respawnX, baseFloorY, respawnZ);

        const chosenPos = mix(bouncePos, respawnPos, isTooSlow);
        const chosenVel = mix(bounceVel, respawnVel, isTooSlow);

        const isBelowFloor = step(nextPos.y, baseFloorY);
        const finalPos = mix(nextPos, chosenPos, isBelowFloor);
        const finalVel = mix(newVel, chosenVel, isBelowFloor);

        p.assign(finalPos);
        v.assign(finalVel);
    });

    const computeNode = computeSplashes().compute(splashCount);

    // Splash visuals (Sugar preset + GPU positioning)
    const splashGeo = new THREE.SphereGeometry(width * 0.15, 8, 8);
    const splashMat = CandyPresets.Sugar(0xCCFFFF, {
        roughness: 0.35,
        metalness: 0.0,
        transparent: true,
        opacity: 0.9
    });

    const instancePos = positionStorage.element(instanceIndex);
    const instanceVel = velocityStorage.element(instanceIndex);
    const speedScale = length(instanceVel);
    const stretchFactor = min(speedScale.mul(0.12).add(1.0), 2.5);
    const squashFactor = float(1.0).div(stretchFactor.sqrt());
    const scaledVertex = positionLocal.mul(vec3(squashFactor, stretchFactor, squashFactor));

    splashMat.positionNode = instancePos.add(scaledVertex);

    const splashGlowColor = mix(color(0x00FFFF), color(0xFF00FF), uPulseIntensity);
    splashMat.emissiveNode = splashGlowColor.mul(uPulseIntensity.add(0.4));

    const splashInstanced = new THREE.InstancedMesh(splashGeo, splashMat, splashCount);
    splashInstanced.frustumCulled = false;
    splashInstanced.castShadow = true;
    splashInstanced.receiveShadow = true;
    splashInstanced.userData.computeNode = computeNode;

    group.add(splashInstanced);

    // === Reactivity & tagging ===
    group.userData.type = 'waterfall';
    group.userData.computeNode = computeNode;

    attachReactivity(group, { minLight: 0.0, maxLight: 1.0, type: 'flora' });

    (group as any).reactToNote = (note: any, colorVal: any, velocity: number) => {
        // Strong visual pulse + splash explosion on high-velocity notes
        const targetPulse = 0.6 + (velocity * 2.2);
        (mesh.userData.uPulseIntensity as UniformNode<number>).value = Math.max(
            (mesh.userData.uPulseIntensity as UniformNode<number>).value,
            targetPulse
        );
    };

    (group as any).onAnimate = (delta: number, time: number) => {
        // Only decay the pulse (physics is now fully GPU-driven)
        const pulse = mesh.userData.uPulseIntensity as UniformNode<number>;
        if (pulse.value > 0.01) {
            pulse.value = THREE.MathUtils.lerp(pulse.value, 0.0, delta * 6.0);
        }
    };

    return group;
}