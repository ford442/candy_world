// src/systems/adapters/LegacyParticleSystem.js
import * as THREE from 'three';
import { calcRainDropY, calcFloatingParticle } from '../../utils/wasm-loader.js';

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
        const rainNormals = new Float32Array(rainCount * 3);
        const rainVelocities = new Float32Array(rainCount);
        const rainOffsets = new Float32Array(rainCount);

        for (let i = 0; i < rainCount; i++) {
            rainPositions[i * 3] = (Math.random() - 0.5) * 100;
            rainPositions[i * 3 + 1] = 20 + Math.random() * 30;
            rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            rainNormals[i * 3] = 0; rainNormals[i * 3 + 1] = 1; rainNormals[i * 3 + 2] = 0;
            rainVelocities[i] = 5 + Math.random() * 5;
            rainOffsets[i] = Math.random() * 50;
        }

        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        rainGeo.setAttribute('normal', new THREE.BufferAttribute(rainNormals, 3));
        rainGeo.userData = { velocities: rainVelocities, offsets: rainOffsets };

        const rainMat = new THREE.PointsMaterial({
            color: 0x88CCFF,
            size: 0.3,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.percussionRain = new THREE.Points(rainGeo, rainMat);
        this.percussionRain.visible = false;
        scene.add(this.percussionRain);
    }

    initMist(scene) {
        const mistCount = 300;
        const mistGeo = new THREE.BufferGeometry();
        const mistPositions = new Float32Array(mistCount * 3);
        const mistNormals = new Float32Array(mistCount * 3);
        const mistOffsets = new Float32Array(mistCount);

        for (let i = 0; i < mistCount; i++) {
            mistPositions[i * 3] = (Math.random() - 0.5) * 80;
            mistPositions[i * 3 + 1] = Math.random() * 5;
            mistPositions[i * 3 + 2] = (Math.random() - 0.5) * 80;
            mistNormals[i * 3] = 0; mistNormals[i * 3 + 1] = 1; mistNormals[i * 3 + 2] = 0;
            mistOffsets[i] = i * 0.1;
        }

        mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPositions, 3));
        mistGeo.setAttribute('normal', new THREE.BufferAttribute(mistNormals, 3));
        mistGeo.userData = { offsets: mistOffsets }; // Storing offsets for updateMelodicMist logic

        const mistMat = new THREE.PointsMaterial({
            color: 0xAAFFAA,
            size: 0.15,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });

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

        const positions = this.percussionRain.geometry.attributes.position.array;
        const velocities = this.percussionRain.geometry.userData.velocities;
        const offsets = this.percussionRain.geometry.userData.offsets;

        this.percussionRain.material.size = 0.3 + bassIntensity * 0.5;
        this.percussionRain.material.opacity = 0.4 + intensity * 0.6;

        if (weatherType === 'mist') {
            this.percussionRain.material.color.setHex(0xE0F4FF);
        } else if (weatherType === 'drizzle') {
            this.percussionRain.material.color.setHex(0x9AB5C8);
        } else if (weatherType === 'thunderstorm' || weatherState === 'storm') {
            this.percussionRain.material.color.setHex(0x6090B0);
        } else {
            this.percussionRain.material.color.setHex(0x88CCFF);
        }

        for (let i = 0; i < positions.length / 3; i++) {
            const startY = 50 + offsets[i];
            const speed = velocities[i] * (1 + bassIntensity);
            const newY = calcRainDropY(startY, time, speed, 50);
            positions[i * 3 + 1] = newY;
            if (newY < 0) {
                positions[i * 3] = (Math.random() - 0.5) * 100;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
            }
        }
        this.percussionRain.geometry.attributes.position.needsUpdate = true;
    }

    updateMelodicMist(time, melodyVol, weatherState, weatherType) {
        if (!this.melodicMist) return;

        const shouldShow = melodyVol > 0.2 || (weatherType === 'mist' && weatherState === 'rain');
        this.melodicMist.visible = shouldShow;

        if (!shouldShow) return;

        const positions = this.melodicMist.geometry.attributes.position.array;
        // In the original code, 'offset' was calculated as i * 0.1 inside the loop.
        // We can replicate that or use userData if stored. The original code: const offset = i * 0.1;

        for (let i = 0; i < positions.length / 3; i++) {
            const offset = i * 0.1;
            positions[i * 3 + 1] = 1 + Math.sin(time + offset) * 2 * Math.max(melodyVol, 0.3);
            positions[i * 3] += Math.sin(time * 0.5 + offset) * 0.01;
            positions[i * 3 + 2] += Math.cos(time * 0.4 + offset) * 0.01;
        }

        this.melodicMist.material.opacity = 0.3 + melodyVol * 0.4;

        if (weatherType === 'mist') {
            this.melodicMist.material.color.setHex(0xDDFFDD);
            this.melodicMist.material.opacity = 0.6;
        } else {
            this.melodicMist.material.color.setHex(0xAAFFAA);
        }
        this.melodicMist.geometry.attributes.position.needsUpdate = true;
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
