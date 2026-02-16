export function createCymbalDandelion(options: CymbalDandelionOptions = {}) {
    const { scale = 1.0 } = options;
    const group = new THREE.Group();

    // ⚡ OPTIMIZATION: Logic Object only (visuals are batched)
    // Hit Volume for interaction
    // Stem Height 1.5, Head at 1.5
    const hitGeo = new THREE.CylinderGeometry(0.2 * scale, 0.2 * scale, 1.8 * scale);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.y = 0.9 * scale;
    group.add(hitMesh);

    group.userData.animationType = 'batchedCymbal'; // Use batched type to avoid CPU animation
    group.userData.type = 'flower';
    group.userData.interactionText = "Harvest Seeds";

    // Callback for generation system to invoke after setting position
    group.userData.onPlacement = () => {
        dandelionBatcher.register(group, options);
    };

    const reactiveGroup = attachReactivity(group);
    const interactive = makeInteractive(reactiveGroup);

    // Override interaction logic for harvesting
    const originalInteract = group.userData.onInteract;
    group.userData.onInteract = () => {
        if (!group.userData.harvested) {
            dandelionBatcher.harvest(group.userData.batchIndex);
            unlockSystem.harvest('chime_shard', 3, 'Chime Shards');

            // Visual FX
            const headOffset = new THREE.Vector3(0, 1.5 * scale, 0);
            headOffset.applyQuaternion(group.quaternion);
            const headPos = group.position.clone().add(headOffset);
            spawnImpact(headPos, 'spore', 0xFFD700);

            // Audio
            if ((window as any).AudioSystem && (window as any).AudioSystem.playSound) {
                (window as any).AudioSystem.playSound('pickup', { position: group.position, pitch: 2.0 });
            }

            group.userData.harvested = true;
            group.userData.interactionText = "Harvested";
        }

        if (originalInteract) originalInteract();
    };

    return interactive;
}