import json
import random
import math

OUTPUT_FILE = "assets/map.json"
MAP_RADIUS = 150
START_SAFE_RADIUS = 15  # Clear area around 0,0
SHOWCASE_RADIUS = 20    # Where to place one of each type
GIANT_MUSHROOM_CLUSTER_CENTER = (40, 0, 40)
GIANT_MUSHROOM_CLUSTER_RADIUS = 15

# All available types
TYPES = [
    "grass", "mushroom", "flower", "cloud",
    "subwoofer_lotus", "accordion_palm", "fiber_optic_willow",
    "floating_orb", "swingable_vine", "prism_rose_bush",
    "starflower", "vibrato_violet", "tremolo_tulip",
    "kick_drum_geyser", "arpeggio_fern", "portamento_pine",
    "cymbal_dandelion", "snare_trap", "bubble_willow",
    "helix_plant", "balloon_bush", "wisteria_cluster"
]

# Types that should be scattered globally
SCATTER_TYPES = [t for t in TYPES if t != "cloud"] # Clouds handled separately or sparsely

def generate_map():
    items = []

    # 1. Showcase Ring (One of each type near start)
    print("Generating Showcase Ring...")
    showcase_types = [t for t in TYPES if t != "grass"] # Grass is boring
    angle_step = (2 * math.pi) / len(showcase_types)
    for i, type_name in enumerate(showcase_types):
        angle = i * angle_step
        dist = 12 + random.uniform(-2, 2)
        x = math.cos(angle) * dist
        z = math.sin(angle) * dist

        item = {
            "type": type_name,
            "position": [x, 0, z],
            "scale": 1.0
        }

        # Variants for basic types
        if type_name == "mushroom":
            item["variant"] = "regular"
        elif type_name == "flower":
            item["variant"] = "glowing"

        items.append(item)

    # 2. Giant Mushroom Stand
    print("Generating Giant Mushroom Stand...")
    for _ in range(15):
        angle = random.uniform(0, 2 * math.pi)
        dist = random.uniform(0, GIANT_MUSHROOM_CLUSTER_RADIUS)
        x = GIANT_MUSHROOM_CLUSTER_CENTER[0] + math.cos(angle) * dist
        z = GIANT_MUSHROOM_CLUSTER_CENTER[2] + math.sin(angle) * dist

        items.append({
            "type": "mushroom",
            "variant": "giant",
            "position": [x, 0, z],
            "scale": random.uniform(1.2, 1.8)
        })

    # 3. Global Scatter
    print("Scattering foliage...")
    # Add Clouds high up
    for _ in range(20):
        x = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        z = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        y = random.uniform(40, 60)
        items.append({
            "type": "cloud",
            "position": [x, y, z],
            "size": random.uniform(1.2, 2.0)
        })

    # Add Foliage
    for _ in range(800): # Total count
        x = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        z = random.uniform(-MAP_RADIUS, MAP_RADIUS)
        dist_sq = x*x + z*z

        # Avoid start area
        if dist_sq < START_SAFE_RADIUS**2:
            continue

        # Avoid Mushroom Cluster slightly
        dx = x - GIANT_MUSHROOM_CLUSTER_CENTER[0]
        dz = z - GIANT_MUSHROOM_CLUSTER_CENTER[2]
        if dx*dx + dz*dz < (GIANT_MUSHROOM_CLUSTER_RADIUS - 5)**2:
            continue

        type_name = random.choice(SCATTER_TYPES)
        scale = random.uniform(0.8, 1.2)

        # Weighting: More grass/flowers, fewer complex trees
        r = random.random()
        if r < 0.4: type_name = "grass"
        elif r < 0.6: type_name = "flower"
        elif r < 0.7: type_name = "mushroom"

        item = {
            "type": type_name,
            "position": [x, 0, z],
            "scale": scale
        }

        if type_name == "flower":
            item["variant"] = random.choice(["regular", "glowing"])
        elif type_name == "mushroom":
            item["variant"] = random.choice(["regular", "regular", "giant"]) # Mostly regular

        items.append(item)

    # Save
    with open(OUTPUT_FILE, 'w') as f:
        json.dump(items, f, indent=2)

    print(f"Map saved to {OUTPUT_FILE} with {len(items)} items.")

if __name__ == "__main__":
    generate_map()
