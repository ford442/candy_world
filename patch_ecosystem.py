import os

with open("src/systems/weather/weather-ecosystem.ts", "r") as f:
    content = f.read()

# Make sure spawnNearbyFoliage and FoliageGrowthOptions are imported
if "spawnNearbyFoliage" not in content:
    content = content.replace("import { createMushroom } from '../../foliage/mushrooms.ts';", "import { createMushroom } from '../../foliage/mushrooms.ts';\nimport { FoliageGrowthOptions } from '../../foliage/types.ts';\nimport { spawnNearbyFoliage } from '../../world/generation.ts';")
    content = content.replace("import { foliageClouds, getGroundHeight } from '../../world/state.ts';", "import { foliageClouds, getGroundHeight, cpuAnimatedFoliage } from '../../world/state.ts';")

new_handle_spawning = """
    /**
     * Handle spawning logic based on favorability scores
     */
    handleSpawning(time: number, fungiScore: number, lanternScore: number, globalLight: number, onSpawnFoliage: ((object: any, isNew: boolean, duration: number) => void) | null, isRaining: boolean): void {
        if (time - this._lastSpawnCheck < this._spawnThrottle) return;
        this._lastSpawnCheck = time;

        if (fungiScore > 0.8) {
            if (Math.random() < 0.4) this.spawnFoliage('mushroom', true, onSpawnFoliage);
        }
        if (lanternScore > 0.6) {
            if (Math.random() < 0.3) this.spawnFoliage('lantern', false, onSpawnFoliage);
        }
        if (globalLight > 0.7 && fungiScore < 0.3) {
             if (Math.random() < 0.2) this.spawnFoliage('flower', false, onSpawnFoliage);
        }

        // Feature: Rain-Driven Spreading
        if (isRaining && Math.random() < 0.2) {
            const growthOptions: FoliageGrowthOptions = {
                spawnRadius: 10,
                spawnChanceBase: 0.3,
                maxOffspring: 2,
                growthWindowMs: 5000,
                densityLimit: 5
            };

            // Pick a random adult plant from cpuAnimatedFoliage to spread
            if (cpuAnimatedFoliage && cpuAnimatedFoliage.length > 0) {
                const adultIndex = Math.floor(Math.random() * cpuAnimatedFoliage.length);
                const adultPlant = cpuAnimatedFoliage[adultIndex];

                // Only spread mushrooms or flowers
                if (adultPlant && adultPlant.userData && (adultPlant.userData.type === 'mushroom' || adultPlant.userData.isFlower)) {
                     // Throttle per-plant spreading
                     const lastSpawn = adultPlant.userData.lastSpawnTime || 0;
                     if (Date.now() - lastSpawn > growthOptions.growthWindowMs) {
                         const typeToSpawn = adultPlant.userData.type === 'mushroom' ? 'mushroom' : 'flower';
                         spawnNearbyFoliage(adultPlant, typeToSpawn, growthOptions, this.weatherSystem);
                         adultPlant.userData.lastSpawnTime = Date.now();
                     }
                }
            }
        }
    }
"""

import re
content = re.sub(r'    /\*\*\n     \* Handle spawning logic based on favorability scores\n     \*/\n    handleSpawning\([\s\S]*?(?=    /\*\*\n     \* Spawn a single foliage object)', new_handle_spawning, content)

with open("src/systems/weather/weather-ecosystem.ts", "w") as f:
    f.write(content)
