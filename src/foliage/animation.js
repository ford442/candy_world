export * from './animation.ts';

function freqToHue(freq) {
    if (!freq || freq < 50) return 0;
    const logF = Math.log2(freq / 55.0);
    return (logF * 0.1) % 1.0;
}

export function updateFoliageMaterials(audioData, isNight) {
    if (!audioData) return;

    if (isNight) {
        const channels = audioData.channelData;
        if (!channels || channels.length === 0) return;

        const updateMats = (mats, startCh) => {
            mats.forEach((mat, i) => {
                const chIndex = startCh + (i % 4);
                const ch = channels[Math.min(chIndex, channels.length - 1)];

                const trigger = ch?.trigger || 0;
                const volume = ch?.volume || 0;
                const freq = ch?.freq || 0;

                if (freq > 0) {
                    let targetHue = freqToHue(freq);
                    targetHue = (targetHue + i * 0.1) % 1.0;
                    const color = new THREE.Color().setHSL(targetHue, 1.0, 0.5);
                    mat.emissive.lerp(color, 0.3);
                } else {
                    mat.emissive.lerp(new THREE.Color(0x220044), 0.1);
                }

                const intensity = 0.2 + volume * 0.5 + trigger * 1.5;
                mat.emissiveIntensity = intensity;
            });
        };

        updateMats(foliageMaterials.flowerPetal, 1);
        updateMats(reactiveMaterials, 1);

        const melodyCh = channels[1];
        if (melodyCh && melodyCh.freq > 0) {
            let hue = freqToHue(melodyCh.freq);
            hue = (hue + 0.5) % 1.0;
            const centerColor = new THREE.Color().setHSL(hue, 1.0, 0.6);
            foliageMaterials.flowerCenter.emissive.lerp(centerColor, 0.2);
        } else {
            foliageMaterials.flowerCenter.emissive.lerp(new THREE.Color(0xFFFACD), 0.1);
        }
        foliageMaterials.flowerCenter.emissiveIntensity = 0.5 + audioData.kickTrigger * 2.0;

        const beamMat = foliageMaterials.lightBeam;
        const kick = audioData.kickTrigger;

        const pan = channels[1]?.pan || 0;
        const beamHue = 0.6 + pan * 0.1;
        beamMat.color.setHSL(beamHue, 0.8, 0.8);

        let effectActive = 0;
        for (let c of channels) if (c.activeEffect > 0) effectActive = 1;

        let opacity = kick * 0.4;
        if (effectActive) {
            opacity += Math.random() * 0.3;
        }
        beamMat.opacity = Math.max(0, Math.min(0.8, opacity));

        const chordVol = Math.max(channels[3]?.volume || 0, channels[4]?.volume || 0);
        const grassHue = 0.6 + chordVol * 0.1;
        foliageMaterials.grass.emissive.setHSL(grassHue, 0.8, 0.2);
        foliageMaterials.grass.emissiveIntensity = 0.2 + chordVol * 0.8;

    } else {
        const resetMats = (mats) => {
            mats.forEach(mat => {
                mat.emissive.setHex(0x000000);
                mat.emissiveIntensity = 0;
            });
        };

        resetMats(foliageMaterials.flowerPetal);
        resetMats(reactiveMaterials);

        foliageMaterials.flowerCenter.emissive.setHex(0x000000);
        foliageMaterials.flowerCenter.emissiveIntensity = 0;

        foliageMaterials.grass.emissive.setHex(0x000000);
        foliageMaterials.grass.emissiveIntensity = 0;

        foliageMaterials.lightBeam.opacity = 0;
    }
}

export function animateFoliage(foliageObject, time, audioData, isDay) {
    const offset = foliageObject.userData.animationOffset || 0;
    const type = foliageObject.userData.animationType || 'sway';
    const plantType = foliageObject.userData.type;

    let groove = 0;
    let kick = 0;
    let beatPhase = 0;
    let bassVol = 0;
    let leadVol = 0;
    let chordVol = 0;

    if (audioData) {
        groove = audioData.grooveAmount || 0;
        kick = audioData.kickTrigger || 0;
        beatPhase = audioData.beatPhase || 0;
        if (audioData.channelData) {
            bassVol = audioData.channelData[0]?.volume || 0;
            leadVol = Math.max(audioData.channelData[1]?.volume || 0, audioData.channelData[2]?.volume || 0);
            chordVol = Math.max(audioData.channelData[3]?.volume || 0, audioData.channelData[4]?.volume || 0);
        }
    }

    const isNightDancer = (type === 'glowPulse' || plantType === 'starflower' || type === 'spin');
    let isActive = false;
    if (isNightDancer) {
        isActive = !isDay;
    } else {
        isActive = isDay;
    }

    let baseIntensity = isActive ? (1.0 + groove * 8.0) : 0.2;
    let squash = 1.0;
    let spin = 0.0;
    let wave = 0.0;

    if (isActive) {
        if (plantType === 'tree' || plantType === 'mushroom') squash = 1.0 + bassVol * 0.3;
        if (plantType === 'flower' || plantType === 'orb' || plantType === 'starflower') spin = leadVol * 5.0;
        if (plantType === 'grass' || plantType === 'vine' || plantType === 'shrub') wave = chordVol * 2.0;
    }

    const animTime = time + (beatPhase * 2.0);
    const intensity = baseIntensity + wave;

    if (foliageObject.userData.originalY === undefined) {
        foliageObject.userData.originalY = foliageObject.position.y;
    }
    const originalY = foliageObject.userData.originalY;

    foliageObject.children.forEach(child => {
        if (child.userData.isBeam) {
            child.rotation.y += 0.05 + spin * 0.01;
            const targetScale = 1.0 + kick * 2.0;
            child.scale.setScalar(targetScale);

            if (!isDay && child.material && child.material !== foliageMaterials.lightBeam) {
                let beamOpacity = kick * 0.6;
                if (Math.random() > 0.8) beamOpacity += 0.2;
                child.material.opacity = beamOpacity;
            } else if (isDay) {
                child.material.opacity = 0;
            }
        }
        if (child.userData.isWash) {
            const washScale = 1.0 + Math.sin(time * 2) * 0.2 + kick;
            child.scale.setScalar(washScale);

            if (!isDay && child.material && child.material !== foliageMaterials.lightBeam) {
                let washOpacity = 0.2 + kick * 0.3;
                child.material.opacity = washOpacity;
            } else if (isDay) {
                child.material.opacity = 0;
            }
        }
    });

    if (plantType === 'tree' || plantType === 'mushroom') {
        if (squash > 1.01) foliageObject.scale.set(squash, 1.0 / squash, squash);
        else foliageObject.scale.set(1, 1, 1);
    }

    if (spin > 0) foliageObject.rotation.y += spin * 0.1;

    if (type === 'sway' || type === 'gentleSway' || type === 'vineSway' || type === 'spin') {
        const t = animTime + offset;
        if (type === 'vineSway') {
            foliageObject.children.forEach((segment, i) => {
                segment.rotation.z = Math.sin(t * 2 + i * 0.5) * 0.2 * intensity;
            });
        } else {
            const tFinal = (plantType === 'tree') ? animTime : (time + offset);
            const speed = (plantType === 'tree') ? 1.0 : 2.0;

            if (type === 'spin') {
                foliageObject.rotation.y += 0.02 * intensity;
                foliageObject.rotation.z = Math.cos(time * 0.5 + offset) * 0.05 * intensity;
            } else {
                foliageObject.rotation.z = Math.sin(tFinal * speed + offset) * 0.05 * intensity;
                foliageObject.rotation.x = Math.cos(tFinal * speed * 0.8 + offset) * 0.05 * intensity;
            }
        }
    } else if (type === 'bounce') {
        foliageObject.position.y = originalY + Math.sin(animTime * 3 + offset) * 0.1 * intensity;
        if (isActive && kick > 0.1) foliageObject.position.y += kick * 0.2;

    } else if (type === 'glowPulse') {
        // handled by material update mostly
    } else if (type === 'float') {
        foliageObject.position.y = originalY + Math.sin(time * 1.5 + offset) * 0.2;
        if (!isDay && kick > 0.1) foliageObject.scale.setScalar(1.0 + kick * 0.2);

    } else if (type === 'spring') {
        foliageObject.scale.y = 1.0 + Math.sin(time * 3 + offset) * 0.1 * intensity + (kick * 0.5);

    } else if (type === 'rain') {
        const rain = foliageObject.children[1];
        if (rain) {
            const positions = rain.geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                let y = positions.getY(i);
                y -= 0.1 + (kick * 0.2);
                if (y < -2) y = 0;
                positions.setY(i, y);
            }
            positions.needsUpdate = true;
        }
    }
}
