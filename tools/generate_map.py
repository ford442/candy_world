import json
import random
import math

OUTPUT_FILE = "assets/map.json"
MAP_RADIUS = 150
CLUSTER_COUNT = 30  # How many clusters of flora
ITEMS_PER_CLUSTER = 8 # Average items per cluster
GRASS_COUNT = 3000  # Explicit grass blades

# Types supported by src/world/generation.js
TYPES = [
    "mushroom",
    "flower",
    "subwoofer_lotus",
    "accordion_palm",
    "fiber_optic_willow",
    "floating_orb",
    "swingable_vine",
    "prism_rose_bush",
    "starflower",
    "vibrato_violet",
    "tremolo_tulip",
    "kick_drum_geyser",
    "arpeggio_fern",
    "portamento_pine",
    "cymbal_dandelion",
    "snare_trap",
    "bubble_willow",
    "helix_plant",
    "balloon_bush",
    "wisteria_cluster"
]

def generate_map():
    items = []

    print(f"Generating map with {CLUSTER_COUNT} clusters and {GRASS_COUNT} grass...")

    # 1. Clusters
    # We place clusters in a loose grid/spiral to ensure coverage but natural feel
    for i in range(CLUSTER_COUNT):
        # Pick a random type
        type_name = random.choice(TYPES)

        # Pick a random center, avoiding 0,0 slightly
        angle = random.uniform(0, 2 * math.pi)
        dist = random.uniform(10, MAP_RADIUS * 0.9)
        center_x = math.cos(angle) * dist
        center_z = math.sin(angle) * dist

        # Decide counts
        count = random.randint(3, 12)
        if "tree" in type_name or "palm" in type_name or "pine" in type_name:
            count = random.randint(2, 5) # Fewer large trees

        for _ in range(count):
            # Offset from cluster center
            r = random.uniform(0, 5) # 5 unit radius cluster
            theta = random.uniform(0, 2 * math.pi)
            x = center_x + math.cos(theta) * r
            z = center_z + math.sin(theta) * r

            item = {
                "type": type_name,
                "position": [x, 0, z],
                "scale": random.uniform(0.8, 1.2)
            }

            # Variants
            if type_name == "mushroom":
                item["variant"] = "regular" if random.random() > 0.2 else "giant"
                if item["variant"] == "giant":
                     item["scale"] *= 1.5
            elif type_name == "flower":
                item["variant"] = "regular" if random.random() > 0.5 else "glowing"

            # Height adjustments for floaters
            if type_name == "cloud":
                 item["position"][1] = random.uniform(40, 70)

            items.append(item)

    # 2. Global Clouds (Scatter high up)
    for _ in range(25):
        x = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        z = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        y = random.uniform(50, 80)
        items.append({
            "type": "cloud",
            "position": [x, y, z],
            "size": random.uniform(1.5, 2.5)
        })

    # 3. Grass (Scatter)
    for _ in range(GRASS_COUNT):
        x = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        z = random.uniform(-MAP_RADIUS, MAP_RADIUS)

        # Optional: Biased towards clusters?
        # For now, uniform scatter is fine, or perlin-noise-like clumping.
        # Simple uniform for now as requested.

        items.append({
            "type": "grass",
            "position": [x, 0, z],
            "scale": random.uniform(0.7, 1.3)
        })

    # Save
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(items, f, indent=2)

    print(f"Map saved to {OUTPUT_FILE} with {len(items)} items.")

if __name__ == "__main__":
    generate_map()
