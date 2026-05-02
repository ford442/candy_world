import os

with open("src/world/generation.ts", "r") as f:
    content = f.read()

# Add FoliageGrowthOptions import
if "FoliageGrowthOptions" not in content:
    content = content.replace("import { createMushroom } from '../foliage/mushrooms.ts';", "import { createMushroom } from '../foliage/mushrooms.ts';\nimport { FoliageGrowthOptions } from '../foliage/types.ts';")

# Add helper function for spawning nearby
new_function = """

export function spawnNearbyFoliage(parentPlant: THREE.Object3D, type: string, options: FoliageGrowthOptions, weatherSystem: WeatherSystem | null = null): void {
    if (animatedFoliage.length > 3000) return; // Hard cap

    const maxAttempts = 5;
    for (let i = 0; i < options.maxOffspring; i++) {
        if (Math.random() > options.spawnChanceBase) continue;

        let valid = false;
        let nx = 0, nz = 0;

        for (let a = 0; a < maxAttempts; a++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = (Math.random() * 0.5 + 0.5) * options.spawnRadius;
            nx = parentPlant.position.x + Math.cos(angle) * dist;
            nz = parentPlant.position.z + Math.sin(angle) * dist;

            if (isPositionValid(nx, nz, 1.0)) {
                // Check local density
                let localCount = 0;
                // Use a simple distance check against a subset or the WASM grid if available
                for (const plant of cpuAnimatedFoliage) {
                    if (!plant || !plant.position) continue;
                    const dx = plant.position.x - nx;
                    const dz = plant.position.z - nz;
                    if (dx*dx + dz*dz < options.spawnRadius * options.spawnRadius) {
                        localCount++;
                    }
                }

                if (localCount < options.densityLimit) {
                    valid = true;
                    break;
                }
            }
        }

        if (valid) {
            const groundY = getUnifiedGroundHeight(nx, nz);
            let obj: THREE.Object3D | null = null;

            if (type === 'flower') {
                obj = createFlower();
            } else if (type === 'mushroom') {
                obj = createMushroom({ size: 'regular', scale: 0.8 });
            }

            if (obj) {
                obj.position.set(nx, groundY, nz);
                obj.userData.age = 0;
                obj.userData.lastSpawnTime = Date.now();
                safeAddFoliage(obj, false, 0.5, weatherSystem);

                // If it's a batcher-registered object, it will be added to the batcher.
                // However, safeAddFoliage might push it to arrays that get batched.
                // The weather ecosystem will handle registering mushrooms.
            }
        }
    }
}
"""

if "spawnNearbyFoliage" not in content:
    content = content + new_function

with open("src/world/generation.ts", "w") as f:
    f.write(content)
