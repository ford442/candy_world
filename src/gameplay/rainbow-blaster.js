import * as THREE from 'three';
import { foliageClouds } from '../world/state.ts'; // The list of active clouds
import { createCandyMaterial } from '../foliage/common.ts';
import { getCelestialState } from '../core/cycle.ts'; // Import cycle check

const PROJECTILES = [];
const SPEED = 60.0;
const RADIUS = 0.5;

// Reusable Geometry/Material
const projectileGeo = new THREE.SphereGeometry(RADIUS, 8, 8);
const projectileMat = createCandyMaterial(0xFFFFFF, 1.0); // Base white, we'll color it per shot

export function fireRainbow(scene, origin, direction) {
    const mesh = new THREE.Mesh(projectileGeo, projectileMat.clone());
    
    // Rainbow Colors!
    const time = performance.now() / 1000;
    const hue = (time * 0.5) % 1.0;
    mesh.material.color.setHSL(hue, 1.0, 0.5);
    mesh.material.emissive.setHSL(hue, 1.0, 0.8);
    mesh.material.emissiveIntensity = 2.0;

    mesh.position.copy(origin);
    mesh.userData.velocity = direction.clone().normalize().multiplyScalar(SPEED);
    mesh.userData.life = 3.0; // Seconds before disappearing

    scene.add(mesh);
    PROJECTILES.push(mesh);

    // Sound effect hook (optional)
    // playSound('pew'); 
}

export function updateBlaster(dt, scene, weatherSystem, currentTime) {
    const celestial = getCelestialState(currentTime);
    const isDay = celestial.sunIntensity > 0.5;

    for (let i = PROJECTILES.length - 1; i >= 0; i--) {
        const p = PROJECTILES[i];
        
        // Move
        p.position.addScaledVector(p.userData.velocity, dt);
        p.userData.life -= dt;

        let hit = false;

        // Check Collision with Clouds
        for (let j = foliageClouds.length - 1; j >= 0; j--) {
            const cloud = foliageClouds[j];
            const cloudRadius = 3.0 * (cloud.scale.x || 1.0);
            const distSq = p.position.distanceToSquared(cloud.position);

            if (distSq < (cloudRadius * cloudRadius)) {
                hit = true;
                
                // --- NEW: Trigger Different Effects based on Time ---
                if (isDay) {
                    knockDownCloudMist(cloud, scene); // Day: Evaporate into Mist
                } else {
                    knockDownCloudDeluge(cloud, scene); // Night: Heavy Rain Burst
                }

                // Notify Weather System to reduce rain density
                if (weatherSystem && weatherSystem.notifyCloudShot) {
                    weatherSystem.notifyCloudShot(isDay);
                }
                // ----------------------------------------------------
                break; 
            }
        }

        if (hit || p.userData.life <= 0) {
            scene.remove(p);
            PROJECTILES.splice(i, 1);
        }
    }
    
    // Update Burst Effects (Simple particle cleanup)
    updateBursts(dt, scene);
}

// --- NEW: Visual Effects for Cloud Destruction ---

const BURSTS = [];

function createBurst(scene, position, color, type) {
    const count = 15;
    const geo = new THREE.BufferGeometry();
    const posArray = new Float32Array(count * 3);
    const normArray = new Float32Array(count * 3);
    const velArray = [];
    
    for(let i=0; i<count; i++) {
        posArray[i*3] = position.x + (Math.random()-0.5)*2;
        posArray[i*3+1] = position.y + (Math.random()-0.5)*2;
        posArray[i*3+2] = position.z + (Math.random()-0.5)*2;
        
        // Dummy Normal
        normArray[i*3] = 0; normArray[i*3+1] = 1; normArray[i*3+2] = 0;

        if (type === 'mist') {
            // Float up/out
            velArray.push(new THREE.Vector3((Math.random()-0.5)*2, Math.random()*2, (Math.random()-0.5)*2));
        } else {
            // Rain down hard
            velArray.push(new THREE.Vector3((Math.random()-0.5)*1, -10 - Math.random()*5, (Math.random()-0.5)*1));
        }
    }
    
    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
    
    const mat = new THREE.PointsMaterial({
        color: color,
        size: type === 'mist' ? 1.5 : 0.5,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending
    });
    
    const points = new THREE.Points(geo, mat);
    points.userData = { velocities: velArray, life: 1.5, type: type };
    
    scene.add(points);
    BURSTS.push(points);
}

function updateBursts(dt, scene) {
    for (let i = BURSTS.length - 1; i >= 0; i--) {
        const b = BURSTS[i];
        b.userData.life -= dt;
        
        const pos = b.geometry.attributes.position.array;
        const vels = b.userData.velocities;
        
        for(let k=0; k<vels.length; k++) {
            pos[k*3] += vels[k].x * dt;
            pos[k*3+1] += vels[k].y * dt;
            pos[k*3+2] += vels[k].z * dt;
        }
        b.geometry.attributes.position.needsUpdate = true;
        b.material.opacity = b.userData.life; // Fade out

        if (b.userData.life <= 0) {
            scene.remove(b);
            b.geometry.dispose();
            b.material.dispose();
            BURSTS.splice(i, 1);
        }
    }
}

function knockDownCloudMist(cloud, scene) {
    if (cloud.userData.isFalling) return;
    cloud.userData.isFalling = true; // Mark as "dead" so we don't hit it again
    
    // Visual: Flash then shrinking/fading up
    cloud.userData.velocity = new THREE.Vector3(0, 5.0, 0); // Float UP (Evaporate)
    
    // Create Mist Burst
    createBurst(scene, cloud.position, 0xFFFFFF, 'mist');
    
    // Scale down rapidly in update loop (handled by clouds.js logic mostly, but we can override velocity)
    cloud.traverse(c => {
        if (c.isMesh && c.material) {
            c.material.transparent = true;
            c.material.opacity = 0.5; // Ghostly
        }
    });
}

function knockDownCloudDeluge(cloud, scene) {
    if (cloud.userData.isFalling) return;
    cloud.userData.isFalling = true;

    // Visual: Heavy Drop
    cloud.userData.velocity = new THREE.Vector3(0, -20.0, 0); // Slam down
    
    // Create Rain Burst
    createBurst(scene, cloud.position, 0x0000FF, 'rain');

    cloud.traverse(c => {
        if (c.isMesh && c.material) {
            c.material.color.setHex(0x000088); // Turn dark blue
            c.material.emissive.setHex(0x0000FF);
        }
    });
}