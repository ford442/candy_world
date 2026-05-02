import os

with open("src/foliage/types.ts", "r") as f:
    content = f.read()

new_interface = """
export interface FoliageGrowthOptions {
    spawnRadius: number;
    spawnChanceBase: number;
    maxOffspring: number;
    growthWindowMs: number;
    densityLimit: number;
}

"""

if "FoliageGrowthOptions" not in content:
    with open("src/foliage/types.ts", "a") as f:
        f.write("\n" + new_interface)
