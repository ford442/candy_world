import * as THREE from 'three';

/**
 * Safely removes an object from the scene and thoroughly disposes of its
 * geometries, materials, and textures to prevent VRAM leaks.
 *
 * ⚡ OPTIMIZATION: Recursively traverses children to ensure complex objects
 * (like preview meshes) are completely freed from GPU memory.
 */
export function safeRemoveAndDispose(scene: THREE.Scene, obj: THREE.Object3D | undefined | null) {
    if (!obj) return;

    // Traverse and dispose all children
    obj.traverse((child: any) => {
        if (child.geometry) {
            child.geometry.dispose();
        }

        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach((m: any) => {
                    m.dispose();
                    if (m.map) m.map.dispose();
                });
            } else {
                child.material.dispose();
                if (child.material.map) child.material.map.dispose();
            }
        }

        // Special handling for InstancedMesh colors or custom dispose methods
        if (child.instanceColor && typeof child.instanceColor.dispose === 'function') {
            try { child.instanceColor.dispose(); } catch (e) {}
        }

        // Special handling for lights
        if (child.dispose && typeof child.dispose === 'function' && child instanceof THREE.Light) {
            child.dispose();
        }
    });

    // Remove from scene
    scene.remove(obj);
}
