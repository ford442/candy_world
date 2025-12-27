import json
import random
import math

OUTPUT_FILE = "assets/map.json"
MAP_RADIUS = 150
GRASS_COUNT = 3000

# Lists of types
RHYTHM_TYPES = [
    "kick_drum_geyser",
    "snare_trap",
    "cymbal_dandelion",
    "subwoofer_lotus",
    "accordion_palm"
]

MELODY_TYPES = [
    "arpeggio_fern",
    "vibrato_violet",
    "tremolo_tulip",
    "prism_rose_bush",
    "portamento_pine"
]

SCATTER_TYPES = [
    "bubble_willow",
    "fiber_optic_willow",
    "balloon_bush",
    "helix_plant",
    "wisteria_cluster",
    "floating_orb",
    "cloud"
]

FILLER_TYPES = [
    "mushroom",
    "flower",
    "starflower"
]

def get_random_position(min_dist, max_dist):
    angle = random.uniform(0, 2 * math.pi)
    dist = random.uniform(min_dist, max_dist)
    x = math.cos(angle) * dist
    z = math.sin(angle) * dist
    return x, z

def generate_map():
    items = []

    print("Generating map...")

    # --- 1. Fairy Ring (Hardcoded) ---
    # Center: (60, -40), Radius: 12, Count: 6 Giant Mushrooms
    print("Generating Fairy Ring...")
    ring_center_x = 60
    ring_center_z = -40
    ring_radius = 12
    ring_count = 6

    for i in range(ring_count):
        angle = (i / ring_count) * 2 * math.pi
        x = ring_center_x + math.cos(angle) * ring_radius
        z = ring_center_z + math.sin(angle) * ring_radius

        items.append({
            "type": "mushroom",
            "position": [x, 0, z],
            "scale": 1.5, # Base scale
            "variant": "giant",
            "hasFace": True
        })

    # --- 2. Clusters (Rhythm & Melody) ---
    # Aiming for ~80-100 items here
    num_clusters = 12
    items_per_cluster_avg = 8

    print(f"Generating {num_clusters} clusters...")

    for _ in range(num_clusters):
        # Determine Cluster Type
        is_rhythm = random.random() < 0.5
        types_list = RHYTHM_TYPES if is_rhythm else MELODY_TYPES

        # Cluster Center (Ensure away from 0,0)
        cx, cz = get_random_position(30, MAP_RADIUS * 0.8) # Min dist 30 to be safe

        count = random.randint(5, 12)

        for _ in range(count):
            type_name = random.choice(types_list)

            # Scatter around cluster center
            r = random.uniform(0, 8)
            theta = random.uniform(0, 2 * math.pi)
            x = cx + math.cos(theta) * r
            z = cz + math.sin(theta) * r

            # Check global safety (though 30 base + 8 radius > 20, let's be safe)
            if x*x + z*z < 20*20:
                continue

            scale = random.uniform(0.8, 1.2)

            # Specific tweaks
            y = 0

            items.append({
                "type": type_name,
                "position": [x, y, z],
                "scale": scale
            })


    # --- 3. Global Scatter ---
    # ~50 items
    print("Generating Scatter items...")
    for _ in range(50):
        type_name = random.choice(SCATTER_TYPES)

        valid = False
        while not valid:
            x, z = get_random_position(20, MAP_RADIUS)
            if x*x + z*z >= 20*20:
                valid = True

        y = 0
        scale = random.uniform(0.9, 1.5)

        if type_name == "cloud":
            y = random.uniform(40, 70)
            scale = random.uniform(1.5, 2.5) # Size param in JS
            items.append({
                "type": type_name,
                "position": [x, y, z],
                "size": scale # JS uses 'size' for cloud
            })
        elif type_name == "floating_orb":
             items.append({
                "type": type_name,
                "position": [x, 0, z], # JS adds height
                "scale": scale
            })
        else:
            items.append({
                "type": type_name,
                "position": [x, y, z],
                "scale": scale
            })

    # --- 4. Filler ---
    # ~50 items
    print("Generating Filler items...")
    for _ in range(50):
        type_name = random.choice(FILLER_TYPES)

        valid = False
        while not valid:
            x, z = get_random_position(20, MAP_RADIUS)
            if x*x + z*z >= 20*20:
                valid = True

        item = {
            "type": type_name,
            "position": [x, 0, z],
            "scale": random.uniform(0.7, 1.2)
        }

        if type_name == "flower":
            # 20% chance for glowing flower
            if random.random() < 0.2:
                item["variant"] = "glowing"
        elif type_name == "mushroom":
            # Mostly regular, small chance of giant/face managed here or in JS?
            # User instructions said Filler: mushroom.
            # I'll default to regular, maybe 10% giant for variety.
            item["variant"] = "regular" if random.random() > 0.1 else "giant"

        items.append(item)


    # --- 5. Grass ---
    print(f"Generating {GRASS_COUNT} grass blades...")
    for _ in range(GRASS_COUNT):
        x, z = get_random_position(0, MAP_RADIUS)
        # Grass can be anywhere? Or should it also respect safe zone?
        # User said "Safe Zone: No *major* objects within 20 units".
        # Usually grass is fine near start, makes it look grounded.
        # But to be clean, I'll keep it out of the strict 5 unit circle maybe,
        # but the request was specific to "major objects".
        # I will let grass be everywhere.

        items.append({
            "type": "grass",
            "position": [x, 0, z],
            "scale": random.uniform(0.7, 1.3)
        })

    # Summary
    major_count = len([i for i in items if i["type"] != "grass"])
    print(f"Total Major Objects: {major_count}")
    print(f"Total Items: {len(items)}")

    with open(OUTPUT_FILE, 'w') as f:
        json.dump(items, f, indent=2)
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    generate_map()
