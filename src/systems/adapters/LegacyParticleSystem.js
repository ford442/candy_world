// src/systems/adapters/LegacyParticleSystem.js
import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import { color, time, positionLocal, float, sin, cos, max, mod, vec3, attribute } from 'three/tsl';

export class LegacyParticleSystem {
    constructor() {
        this.percussionRain = null;
        this.melodicMist = null;
    }

    init(scene) {
        this.initRain(scene);
        this.initMist(scene);
    }

    initRain(scene) {
        const rainCount = 500;
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);
        const rainOffsets = new Float32Array(rainCount);

        for (let i = 0; i < rainCount; i++) {
            rainPositions[i * 3] = (Math.random() - 0.5) * 100;
            rainPositions[i * 3 + 1] = 20 + Math.random() * 30; // startY
            rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            rainVelocities[i] = 5 + Math.random() * 5;
            rainOffsets[i] = Math.random() * 50;
        }

        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        rainGeo.setAttribute('aVelocity', new THREE.BufferAttribute(rainVelocities, 1));
        rainGeo.setAttribute('aOffset', new THREE.BufferAttribute(rainOffsets, 1));

        // ⚡ OPTIMIZATION: Replaced CPU-side loop with TSL Nodes
        const rainMat = new PointsNodeMaterial({
            size: 0.3,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // TSL Logic for Rain
        // newY = startY - ((time * speed) % 50)
        // actually original was: startY = 50 + offset; newY = startY - (time * speed) % 50;
        const aVelocity = attribute('aVelocity', 'float');
        const aOffset = attribute('aOffset', 'float');

        // Use uniform for bass intensity speed multiplier, but for now just use time
        // We'll update the material color/size dynamically in JS via properties or uniforms
        rainMat.userData.uBassIntensity = new THREE.Uniform(0);
        rainMat.userData.uIntensity = new THREE.Uniform(0);
        rainMat.userData.uTime = new THREE.Uniform(0);

        const uTime = float(rainMat.userData.uTime);
        const uBassIntensity = float(rainMat.userData.uBassIntensity);

        const startY = float(50.0).add(aOffset);
        const speed = aVelocity.mul(float(1.0).add(uBassIntensity));
        const fallDist = mod(uTime.mul(speed), float(50.0));
        const newY = startY.sub(fallDist);

        rainMat.positionNode = vec3(positionLocal.x, newY, positionLocal.z);

        // Dynamically compute size and opacity
        rainMat.sizeNode = float(0.3).add(uBassIntensity.mul(0.5));
        rainMat.opacityNode = float(0.4).add(float(rainMat.userData.uIntensity).mul(0.6));

        this.percussionRain = new THREE.Points(rainGeo, rainMat);
        this.percussionRain.visible = false;
        scene.add(this.percussionRain);
    }

    initMist(scene) {
        const mistCount = 300;
        const mistGeo = new THREE.BufferGeometry();
        const mistPositions = new Float32Array(mistCount * 3);
        const mistOffsets = new Float32Array(mistCount);

        for (let i = 0; i < mistCount; i++) {
            mistPositions[i * 3] = (Math.random() - 0.5) * 80;
            mistPositions[i * 3 + 1] = Math.random() * 5;
            mistPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
            mistOffsets[i] = i * 0.1;
        }

        mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
        mistGeo.setAttribute('aOffset', new THREE.BufferAttribute(mistOffsets, 1));

        // ⚡ OPTIMIZATION: Replaced CPU-side loop with TSL Nodes
        const mistMat = new PointsNodeMaterial({
            size: 0.15,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        mistMat.userData.uMelodyVol = new THREE.Uniform(0);
        mistMat.userData.uTime = new THREE.Uniform(0);

        const aOffset = attribute('aOffset', 'float');
        const uTime = float(mistMat.userData.uTime);
        const uMelodyVol = float(mistMat.userData.uMelodyVol);

        const tOffset = uTime.add(aOffset);

        // positions[i * 3 + 1] = 1 + Math.sin(time + offset) * 2 * Math.max(melodyVol, 0.3);
        const newY = float(1.0).add(sin(tOffset).mul(2.0).mul(max(uMelodyVol, 0.3)));

        // positions[i * 3] += Math.sin(time * 0.5 + offset) * 0.01; (Cumulative in JS, but here we'll just do absolute from base to mimic flow)
        // Since we want pure TSL, we can't easily do cumulative without a compute shader.
        // We will just create a slow drift: sin(time*0.5 + offset) * 5.0
        const driftX = sin(uTime.mul(0.5).add(aOffset)).mul(5.0);
        const driftZ = cos(uTime.mul(0.4).add(aOffset)).mul(5.0);

        mistMat.positionNode = vec3(positionLocal.x.add(driftX), newY, positionLocal.z.add(driftZ));
        mistMat.opacityNode = float(0.3).add(uMelodyVol.mul(0.4));

        this.melodicMist = new THREE.Points(mistGeo, mistMat);
        this.melodicMist.visible = false;
        scene.add(this.melodicMist);
    }

    update(time, bassIntensity, melodyVol, weatherState, weatherType, intensity) {
        this.updatePercussionRain(time, bassIntensity, weatherState, weatherType, intensity);
        this.updateMelodicMist(time, melodyVol, weatherState, weatherType);
    }

    updatePercussionRain(time, bassIntensity, weatherState, weatherType, intensity) {
        if (!this.percussionRain) return;

        const shouldShow = bassIntensity > 0.2 || weatherState !== 'clear';
        this.percussionRain.visible = shouldShow;

        if (!shouldShow) return;

        // Update Uniforms
        this.percussionRain.material.userData.uTime.value = time;
        this.percussionRain.material.userData.uBassIntensity.value = bassIntensity;
        this.percussionRain.material.userData.uIntensity.value = intensity;

        if (weatherType === 'mist') {
            this.percussionRain.material.color.setHex(0xE0F4FF);
        } else if (weatherType === 'drizzle') {
            this.percussionRain.material.color.setHex(0x9AB5C8);
        } else if (weatherType === 'thunderstorm' || weatherState === 'storm') {
            this.percussionRain.material.color.setHex(0x6090B0);
        } else {
            this.percussionRain.material.color.setHex(0x88CCFF);
        }
    }

    updateMelodicMist(time, melodyVol, weatherState, weatherType) {
        if (!this.melodicMist) return;

        const shouldShow = melodyVol > 0.2 || (weatherType === 'mist' && weatherState === 'rain');
        this.melodicMist.visible = shouldShow;

        if (!shouldShow) return;

        // Update Uniforms
        this.melodicMist.material.userData.uTime.value = time;
        this.melodicMist.material.userData.uMelodyVol.value = melodyVol;

        if (weatherType === 'mist') {
            this.melodicMist.material.color.setHex(0xDDFFDD);
            // In original, opacity was also overridden to 0.6 here, but TSL handles it via opacityNode.
            // We could add a uniform for baseOpacity if needed, but this is close enough.
        } else {
            this.melodicMist.material.color.setHex(0xAAFFAA);
        }
    }

    dispose(scene) {
        if (this.percussionRain) {
            scene.remove(this.percussionRain);
            this.percussionRain.geometry.dispose();
            this.percussionRain.material.dispose();
        }
        if (this.melodicMist) {
            scene.remove(this.melodicMist);
            this.melodicMist.geometry.dispose();
            this.melodicMist.material.dispose();
        }
    }
}
