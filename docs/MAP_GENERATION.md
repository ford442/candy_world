# Map Generation System

The Candy World Map Generator is a procedural content generation system that creates varied, replayable worlds using a multi-stage pipeline.

## Overview

The generator replaces the hand-crafted `map.json` (3,223 entities) with procedurally generated worlds based on:
- **Seed-based randomness** for reproducible results
- **Biome system** with natural transitions
- **Blue noise distribution** for organic entity placement
- **A* pathfinding** for roads and rivers
- **POI network** for gameplay interest points

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Map Generation Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Biome      │───▶│    POI       │───▶│    Path      │      │
│  │  Generator   │    │  Generator   │    │  Generator   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         ▼                   ▼                   ▼               │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              Entity Generator (Poisson Disc)         │       │
│  └─────────────────────────────────────────────────────┘       │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              Validation & Preview                    │       │
│  └─────────────────────────────────────────────────────┘       │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────┐       │
│  │              Output (map.json + preview.svg)         │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Module Reference

### 1. Biome Generator (`biome-generator.ts`)

Defines and generates the six biomes of Candy World:

| Biome | Color | Elevation | Key Features |
|-------|-------|-----------|--------------|
| **Meadow** | 🟢 `#90EE90` | 0-5 | Grass, flowers, mushrooms, peaceful |
| **Forest** | 🌲 `#228B22` | 0-8 | Dense trees, ferns, rose bushes |
| **Lake** | 🔵 `#4169E1` | -2 to 2 | Water features, lotus, palms |
| **Mountain** | 🏔️ `#8B7355` | 8-25 | Geysers, pine trees, viewpoints |
| **Cave** | 🟣 `#4B0082` | -10 to 0 | Dark, mushrooms, glowing orbs |
| **Neon Corruption** | 🩷 `#FF1493` | 0-10 | Glitch aesthetic, strange plants |

#### Noise Functions

The biome generator uses multi-layered noise:

```typescript
// Base terrain - domain warped FBM
const baseElevation = noise.domainWarp(x * 0.01, z * 0.01, 0.3, 5);

// Mountains - ridged multifractal
const mountainNoise = noise.ridgedMF(x * 0.005, z * 0.005, 6, 0.5, 2);

// Moisture and temperature for biome selection
const moisture = noise.fbm(x * 0.008, z * 0.008, 4);
const temperature = noise.fbm(x * 0.006, z * 0.006, 3);
```

#### Biome Selection Logic

```
IF elevation < -2: Lake
ELSE IF elevation > 15: Mountain
ELSE IF elevation < -5 AND moisture > 0.6: Cave
ELSE IF temperature > 0.7 AND moisture < 0.3: NeonCorruption
ELSE IF moisture > 0.6: Forest
ELSE: Meadow
```

### 2. Poisson Disc Sampler (`poisson-disc-sampler.ts`)

Implements blue noise distribution for natural-looking entity placement:

#### Key Properties
- **No clustering**: Minimum distance guarantees
- **No grid patterns**: Stochastic placement
- **Variable density**: Per-biome and per-entity-type

#### Algorithm
```
1. Place random seed point
2. Add to active list
3. While active list not empty:
   a. Pick random active point
   b. Try to place k new points in annulus around it
   c. If successful, add new points to active list
   d. If failed after k attempts, remove from active list
```

#### Entity Templates

Each entity type has placement rules:

```typescript
{
    type: 'portamento_pine',
    minRadius: 4,        // Minimum spacing
    maxRadius: 8,        // Maximum spacing
    scaleRange: [0.8, 1.5],
    elevationAdapt: true, // Adjust Y to terrain
    biomes: ['forest', 'mountain']
}
```

### 3. Path Generator (`path-generator.ts`)

Creates roads and rivers using A* pathfinding with terrain awareness.

#### Road Pathfinding
- **Cost function**: Prefers flat terrain, avoids water
- **Slope penalty**: `cost += slope * 10`
- **Water penalty**: `cost += 100` for underwater

#### River Pathfinding
- **Cost function**: Prefers downhill, meandering
- **Elevation bonus**: `cost -= elevation * 0.5`
- **Meander noise**: Perlin noise for organic curves

#### Path Smoothing
Catmull-Rom splines create smooth curves:
```typescript
const smoothedPoint = catmullRom(p0, p1, p2, p3, t, tension);
```

#### Structure Detection
- **Bridges**: Roads crossing water (elevation < -1)
- **Tunnels**: Roads through mountains (elevation > 20)

### 4. Interest Point Generator (`interest-point-generator.ts`)

Places gameplay-relevant locations with accessibility guarantees.

#### POI Types

| Type | Icon | Description | Constraints |
|------|------|-------------|-------------|
| Spawn Point | ⭐ | Player start | Must be accessible, flat |
| Musical Shrine | 🎵 | Music puzzles | Flat terrain, special biomes |
| Puzzle Location | ❓ | Environmental puzzles | Interesting terrain |
| Scenic Viewpoint | 👁️ | Vista points | High elevation |
| Landmark | ⚡ | Notable features | Anywhere significant |

#### Placement Rules
```typescript
{
    type: 'musical_shrine',
    minElevation: 2,
    maxElevation: 20,
    preferredBiomes: ['meadow', 'forest', 'mountain'],
    avoidBiomes: ['lake', 'neonCorruption'],
    minDistanceFromOthers: 30,
    maxCount: 5
}
```

#### Connectivity
- POIs form a minimum spanning tree
- Spawn point is always connected
- High-importance POIs connect first

### 5. Validation (`validation.ts`)

Ensures generated maps are valid and performant.

#### Checks Performed

| Check | Description | Severity |
|-------|-------------|----------|
| Ground collision | Entities below terrain | Error |
| Overlapping colliders | Entities too close | Error |
| Out of bounds | Outside map limits | Error |
| Budget exceeded | Too many entities | Error |
| Unreachable POIs | Can't reach from spawn | Error |
| High density | Clusters detected | Warning |
| Low connectivity | Isolated POIs | Warning |

#### Performance Budgets
- **Max entities**: 10,000 (default: 5,000)
- **Max POIs**: 20 (default: 12)
- **Max paths**: 50
- **Estimated memory**: < 50MB

### 6. SVG Preview (`svg-preview.ts`)

Generates 2D top-down visualization of the map.

#### Layers
1. **Biome base**: Colored regions with opacity blending
2. **Paths**: Roads (brown), rivers (blue), bridges (tan)
3. **Entities**: Colored circles by type
4. **POIs**: Icons with labels and connection lines
5. **Legend**: Interactive map key

## CLI Usage

### Basic Generation

```bash
# Generate with random seed
npm run generate:map

# Generate with specific seed
npm run generate:map -- --seed 12345

# Large map with multiple biomes
npm run generate:map -- --size 1000 --biomes meadow,forest,lake,mountain

# Dense, smaller map
npm run generate:map -- --size 300 --density 1.2 --poi-count 15
```

### Full Options

```bash
npm run generate:map \
  --seed 12345 \
  --size 500 \
  --biomes meadow,forest,lake \
  --poi-count 12 \
  --density 0.8 \
  --max-entities 5000 \
  --output ./assets/map_custom.json
```

### Output

```
🗺️  Starting map generation with seed 12345...
📍 Generating Points of Interest...
🛤️  Generating paths...
🌿 Generating entities...
✅ Validating map...
🎨 Generating preview...
🖼️  Preview saved to tools/map-generator/preview.svg
✨ Map generation complete in 2456ms
💾 Map saved to ./assets/map_generated.json
   Entities: 2847
   Paths: 14
   POIs: 12
   Biomes: meadow, forest, lake
   Valid: ✅
```

## API Usage

### TypeScript/JavaScript

```typescript
import { MapGenerator } from './tools/map-generator/index.ts';

const generator = new MapGenerator({
    seed: 12345,
    size: 500,
    biomes: ['meadow', 'forest', 'lake'],
    poiCount: 12,
    entityDensity: 0.8,
    maxEntities: 5000
});

const map = await generator.generate();

// Access generated data
console.log(map.metadata);
console.log(map.entities);
console.log(map.paths);
console.log(map.pois);
console.log(map.validation);

// Save to file
await generator.saveToFile('./assets/map.json');
```

### Individual Modules

```typescript
import { BiomeGenerator, BIOMES } from './biome-generator.ts';
import { PoissonDiscSampler, DEFAULT_ENTITY_TEMPLATES } from './poisson-disc-sampler.ts';
import { PathGenerator } from './path-generator.ts';
import { POIGenerator } from './interest-point-generator.ts';
import { MapValidator } from './validation.ts';
import { SVGPreviewGenerator } from './svg-preview.ts';

// Use modules independently for custom generation
```

## Output Format

### map.json Structure

```json
{
    "metadata": {
        "seed": 12345,
        "version": "1.0",
        "biomes": ["meadow", "forest", "lake"],
        "bounds": {
            "min": [-250, -250],
            "max": [250, 250]
        },
        "entityCount": 2847,
        "pathCount": 14,
        "poiCount": 12,
        "generationTime": 2456
    },
    "entities": [
        {
            "type": "mushroom",
            "position": [25.0, 0.5, 12.5],
            "scale": 1.2,
            "variant": "regular",
            "note": "C",
            "noteIndex": 0,
            "hasFace": false
        }
    ],
    "paths": [
        {
            "type": "road",
            "points": [{"x": 0, "y": 0, "z": 0}, ...],
            "width": 3,
            "startPOI": "spawn_point_main",
            "endPOI": "musical_shrine_0"
        }
    ],
    "pois": [
        {
            "id": "musical_shrine_0",
            "type": "musical_shrine",
            "name": "Harmony Shrine",
            "position": {"x": 100, "y": 5, "z": 50},
            "radius": 8,
            "importance": 9,
            "biome": "meadow",
            "connections": ["spawn_point_main"],
            "metadata": {...}
        }
    ],
    "validation": {
        "isValid": true,
        "errors": [],
        "warnings": [],
        "stats": {...}
    }
}
```

## Performance Considerations

### Generation Time
- **Small (300x300)**: ~500ms
- **Medium (500x500)**: ~2-3s
- **Large (1000x1000)**: ~8-12s
- **Huge (2000x2000)**: ~30-45s

### Optimization Tips

1. **Reduce maxEntities** for faster generation
2. **Limit biomes** to reduce noise calculations
3. **Use larger sampleResolution** in SVG preview
4. **Disable preview** with `--no-preview`

### Stress Testing

```bash
# Generate huge maps for testing
npm run generate:map -- --size 2000 --max-entities 20000 --no-preview

# Generate many maps for A/B testing
for seed in {1..10}; do
    npm run generate:map -- --seed $seed --output "./test/map_$seed.json"
done
```

## Extending the System

### Adding New Biomes

```typescript
// biome-generator.ts
BIOMES.desert = {
    name: 'Desert',
    color: '#F4A460',
    secondaryColor: '#DEB887',
    noiseScale: 0.025,
    noiseThreshold: 0.4,
    entityWeights: {
        cactus: 20,
        tumbleweed: 10,
        // ...
    },
    densityMultiplier: 0.5,
    elevationRange: [2, 15],
    decorationChance: 0.2
};
```

### Adding New Entity Types

```typescript
// poisson-disc-sampler.ts
DEFAULT_ENTITY_TEMPLATES.push({
    type: 'crystal_formation',
    minRadius: 2,
    maxRadius: 4,
    scaleRange: [0.5, 1.5],
    elevationAdapt: true,
    biomes: ['cave', 'neonCorruption']
});
```

### Custom Validation Rules

```typescript
// validation.ts
this.validateCustomRule(entities, (entity) => {
    if (entity.type === 'rare_item' && entity.scale > 2) {
        return { valid: false, error: 'Rare items cannot be giant' };
    }
    return { valid: true };
});
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Too few entities | Low density | Increase `--density` or `--size` |
| POIs unreachable | Terrain blocking | Adjust elevation range or increase path width |
| Overlapping entities | Small minRadius | Increase `minRadius` in templates |
| Generation too slow | Large map + high density | Reduce `--max-entities` or use `--no-preview` |
| Biomes not appearing | Threshold too high | Adjust `noiseThreshold` in biome definition |

### Debug Mode

Enable detailed logging:

```typescript
const generator = new MapGenerator({
    ...options,
    debug: true
});
```

## Version History

| Version | Changes |
|---------|---------|
| 1.0 | Initial release with 6 biomes, A* pathfinding, Poisson disc sampling |

---

*Generated by the Candy World Map Generator*
