import * as THREE from 'three';
import { foliageClouds } from '../world/state.js'; // The list of active clouds
import { createCandyMaterial } from '../foliage/common.js';

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

export function updateBlaster(dt, scene) {
    for (let i = PROJECTILES.length - 1; i >= 0; i--) {
        const p = PROJECTILES[i];
        
        // Move
        p.position.addScaledVector(p.userData.velocity, dt);
        p.userData.life -= dt;

        let hit = false;

        // Check Collision with Clouds
        // We iterate backwards through clouds so we can safely remove them from the list if needed
        for (let j = foliageClouds.length - 1; j >= 0; j--) {
            const cloud = foliageClouds[j];
            
            // Simple Sphere Collision
            // Clouds are scaled groups, so we approximate their radius
            const cloudRadius = 3.0 * (cloud.scale.x || 1.0);
            const distSq = p.position.distanceToSquared(cloud.position);

            if (distSq < (cloudRadius * cloudRadius)) {
                // HIT!
                hit = true;
                knockDownCloud(cloud);
                break; 
            }
        }

        // Cleanup
        if (hit || p.userData.life <= 0) {
            scene.remove(p);
            PROJECTILES.splice(i, 1);
        }
    }
}

function knockDownCloud(cloud) {
    if (cloud.userData.isFalling) return; // Already hit

    cloud.userData.isFalling = true;
    cloud.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5, // Random spin/drift
        -5.0,                      // Initial drop speed
        (Math.random() - 0.5) * 5
    );
    
    // Flash white to indicate hit
    cloud.traverse(c => {
        if (c.isMesh) {
            if (c.material) {
                c.material.emissive.setHex(0xFFFFFF);
                c.material.emissiveIntensity = 2.0;
            }
        }
    });
}