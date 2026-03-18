# Candy World Map Generator

Procedural map generation system for Candy World. Creates varied, replayable worlds with biome-based terrain, organic entity placement, and connected points of interest.

## Quick Start

```bash
# Generate a map with random seed
npx tsx tools/map-generator/cli.ts

# Generate with specific parameters
npx tsx tools/map-generator/cli.ts --seed 12345 --size 500 --biomes meadow,forest,lake

# Run tests
npx tsx tools/map-generator/test.ts
```

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Biome Generator │────▶│   POI Generator  │────▶│  Path Generator │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                                               │
         │                                               ▼
         │                        ┌──────────────────────────────┐
         │                        │     Entity Generator         │
         │                        │   (Poisson Disc Sampling)    │
         │                        └──────────────────────────────┘
         │                                      │
         ▼                                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    Validation & Preview                       │
└──────────────────────────────────────────────────────────────┘
```

## Modules

### 1. Biome Generator (`biome-generator.ts`)
Six biomes with Perlin noise-based distribution:
- **Meadow** - Grass, flowers, peaceful
- **Forest** - Dense trees, ferns
- **Lake** - Water features
- **Mountain** - High elevation, geysers
- **Cave** - Underground, glowing features
- **Neon Corruption** - Glitch aesthetic

### 2. Poisson Disc Sampler (`poisson-disc-sampler.ts`)
Blue noise distribution for natural entity placement:
- No clustering
- Variable density per biome
- 20+ entity types with placement rules

### 3. Path Generator (`path-generator.ts`)
A* pathfinding for roads and rivers:
- Elevation-aware routing
- Bridge and tunnel detection
- Bezier smoothing

### 4. Interest Point Generator (`interest-point-generator.ts`)
Gameplay locations:
- Musical shrines
- Puzzle locations
- Scenic viewpoints
- Landmarks
- Spawn point (always accessible)

### 5. Validation (`validation.ts`)
Map quality checks:
- Ground collision detection
- Overlap prevention
- POI accessibility
- Performance budgets

### 6. SVG Preview (`svg-preview.ts`)
2D visualization with layers:
- Biome regions
- Paths (roads, rivers, bridges)
- Entities
- POIs with connections

## CLI Options

```
--seed, -s <number>        Random seed (default: random)
--size, -S <number>        Map size (default: 500)
--biomes, -b <list>        Comma-separated biomes (default: meadow,forest)
--output, -o <path>        Output file (default: ./assets/map_generated.json)
--poi-count, -p <number>   Number of POIs (default: 12)
--density, -d <number>     Entity density 0-1 (default: 0.8)
--max-entities, -m <n>     Max entities (default: 5000)
--no-preview               Skip SVG preview
--help, -h                 Show help
```

## Examples

```bash
# Small, dense forest
npx tsx tools/map-generator/cli.ts --size 300 --biomes forest --density 1.2

# Large world with all biomes
npx tsx tools/map-generator/cli.ts --size 1000 --biomes meadow,forest,lake,mountain,cave

# Mountain-focused adventure map
npx tsx tools/map-generator/cli.ts --seed 42 --biomes mountain,cave --poi-count 20

# Stress test
npx tsx tools/map-generator/cli.ts --size 2000 --max-entities 20000 --no-preview
```

## Output

### Files Generated
- `assets/map_generated.json` - The generated map
- `tools/map-generator/preview.svg` - Visual preview

### Map Structure

```json
{
  "metadata": {
    "seed": 12345,
    "version": "1.0",
    "biomes": ["meadow", "forest", "lake"],
    "bounds": { "min": [-250, -250], "max": [250, 250] },
    "entityCount": 2847,
    "pathCount": 14,
    "poiCount": 12,
    "generationTime": 2456
  },
  "entities": [...],
  "paths": [...],
  "pois": [...],
  "validation": { "isValid": true, ... }
}
```

## API Usage

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
await generator.saveToFile('./assets/map.json');
```

## Performance

| Map Size | Entities | Generation Time |
|----------|----------|-----------------|
| 300x300  | ~800     | ~500ms          |
| 500x500  | ~2500    | ~2s             |
| 1000x1000| ~8000    | ~8s             |
| 2000x2000| ~25000   | ~35s            |

## Testing

```bash
# Run all module tests
npx tsx tools/map-generator/test.ts

# Generate and validate multiple seeds
for seed in {1..10}; do
  npx tsx tools/map-generator/cli.ts --seed $seed --no-preview
done
```

## Documentation

See `/docs/MAP_GENERATION.md` for detailed algorithm documentation.

## Extending

### Add a New Biome

```typescript
// biome-generator.ts
BIOMES.desert = {
  name: 'Desert',
  color: '#F4A460',
  entityWeights: { cactus: 20, ... },
  densityMultiplier: 0.5,
  elevationRange: [2, 15]
};
```

### Add a New Entity

```typescript
// poisson-disc-sampler.ts
DEFAULT_ENTITY_TEMPLATES.push({
  type: 'crystal',
  minRadius: 2,
  maxRadius: 4,
  scaleRange: [0.5, 1.5],
  biomes: ['cave']
});
```

## License

Part of Candy World project.
