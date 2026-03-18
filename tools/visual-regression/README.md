# 🎮 Candy World Visual Regression Testing

A comprehensive visual regression testing and screenshot comparison system for candy_world. Automatically detect visual bugs and performance regressions by capturing and comparing screenshots across different builds.

## Features

- 📸 **Multi-viewpoint Capture**: Test spawn, lake, forest, night, particles, and weather scenes
- 🖥️ **Multi-resolution Support**: Mobile (375x667), Desktop (1920x1080), Ultrawide (3440x1440)
- ⚙️ **Quality Settings**: Low, Medium, High, Ultra presets for different test scenarios
- 🔍 **Pixel-perfect Comparison**: Detect even the smallest visual changes
- 📊 **Interactive HTML Reports**: Side-by-side comparisons with slider to reveal differences
- 🌿 **Git LFS Integration**: Efficient storage of large baseline screenshots
- 🚀 **Performance Profiling**: GPU frame time tracking and heatmap generation
- 🔧 **Branch Isolation**: Separate baselines per git branch

## Quick Start

### 1. Install Dependencies

```bash
cd tools/visual-regression
npm install

# Install Playwright browsers
npx playwright install chromium
```

### 2. Start the Game

```bash
# In the candy_world root directory
npm run dev
```

### 3. Run Tests

```bash
# Run full visual test suite
npm run test:visual

# Update baselines (after intentional visual changes)
npm run test:visual -- --update
```

## Viewpoints

| Viewpoint | Description | Wait Time |
|-----------|-------------|-----------|
| `spawn` | Player start position | 2s |
| `lake` | Water/refractive surfaces | 3s |
| `forest` | Dense foliage - tests LOD | 2.5s |
| `night` | Night scene - tests lighting | 3s |
| `particles` | Fireflies, pollen effects | 4s |
| `weather` | Rain/storm conditions | 3.5s |
| `sunset` | Atmospheric scattering | 2s |

## Quality Settings

| Setting | Render Scale | Antialias | Shadows | Particle Density |
|---------|-------------|-----------|---------|------------------|
| `low` | 0.5x | Off | Off | 25% |
| `medium` | 0.75x | On | On | 50% |
| `high` | 1.0x | On | On | 75% |
| `ultra` | 1.5x | On | On | 100% |

## Viewports

| Device | Resolution | Scale Factor |
|--------|-----------|--------------|
| `mobile` | 375x667 | 2x |
| `tablet` | 768x1024 | 2x |
| `desktop` | 1920x1080 | 1x |
| `ultrawide` | 3440x1440 | 1x |

## CLI Usage

```bash
npm run test:visual [options]

Options:
  --config, -c <path>       Config file path
  --url, -u <url>           Base URL (default: http://localhost:5173)
  --viewpoints, -v <list>   Comma-separated viewpoints
  --qualities, -q <list>    Comma-separated qualities
  --viewports, -p <list>    Comma-separated viewports
  --threshold, -t <float>   Diff threshold (default: 0.05)
  --update, -U              Update baselines
  --no-report               Skip report generation
  --performance, -perf      Capture performance profiles
  --help, -h                Show help
```

### Examples

```bash
# Run all tests
npm run test:visual

# Test specific viewpoints
npm run test:visual -- --viewpoints spawn,lake

# Test at ultra quality
npm run test:visual -- --qualities ultra

# Update baselines after intentional changes
npm run test:visual -- --update

# Include performance profiling
npm run test:visual -- --performance

# Custom threshold (5% instead of default 1%)
npm run test:visual -- --threshold 0.05
```

## Configuration File

Create a `visual-regression.config.json` in your project root:

```json
{
  "baseUrl": "http://localhost:5173",
  "outputDir": "./test/screenshots",
  "baselineDir": "./test/baselines",
  "viewpoints": ["spawn", "lake", "forest", "night"],
  "qualities": ["medium", "high"],
  "viewports": ["desktop"],
  "threshold": 0.05,
  "updateBaselines": false,
  "generateReport": true,
  "capturePerformance": false
}
```

## Baseline Management

### Initial Baseline Creation

```bash
# First time - create baselines
npm run test:visual -- --update
```

### Updating Baselines (Intentional Changes)

When you make intentional visual changes:

```bash
npm run test:visual -- --update
```

### Branch-based Isolation

Baselines are stored per git branch:
- `main` branch baselines in `test/baselines/main/`
- Feature branch baselines in `test/baselines/feature-branch/`

Falls back to `main` baselines if branch-specific ones don't exist.

### Baseline Statistics

```bash
npm run baseline -- stats
```

### Cleanup Old Baselines

```bash
# Preview what will be removed
npm run baseline -- cleanup --dry-run

# Actually remove old baselines
npm run baseline -- cleanup
```

## Report Features

The generated HTML report includes:

- **Summary Statistics**: Pass/fail counts, average/max diff percentages
- **Side-by-side Comparison**: Before/after images
- **Interactive Slider**: Drag to reveal differences
- **Diff Overlay**: Highlighted pixel changes
- **Perceptual Diff**: Separate metric ignoring anti-aliasing
- **PDF Export**: Print-friendly layout

Open `test/screenshots/report/index.html` to view.

## Performance Profiling

Capture GPU metrics alongside screenshots:

```bash
npm run test:visual -- --performance
```

Generates:
- Screenshot with FPS overlay
- Frame time timeline graph
- Pixel cost heatmap (experimental)
- Draw call statistics

## File Naming Convention

Screenshots are saved with structured naming:

```
viewpoint-quality-resolution-timestamp.png

Example:
spawn-high-desktop-2024-03-18T10-30-00-000Z.png
lake-ultra-ultrawide-2024-03-18T10-30-05-123Z.png
```

## Directory Structure

```
test/
├── screenshots/
│   ├── spawn/
│   │   ├── high/
│   │   │   ├── spawn-high-desktop-2024-03-18T10-30-00-000Z.png
│   │   │   └── ...
│   │   └── ...
│   ├── diffs/           # Generated diff images
│   ├── report/          # HTML report
│   └── performance/     # Performance profiles
└── baselines/
    ├── main/            # Main branch baselines
    │   ├── spawn-high-desktop.png
    │   └── ...
    ├── feature-x/       # Feature branch baselines
    └── index.json       # Baseline metadata
```

## Git LFS Setup

Large PNG files are tracked with Git LFS:

```bash
# Initialize Git LFS
git lfs install

# Track baseline files
git lfs track "test/baselines/**/*.png"

# Commit .gitattributes
git add .gitattributes
git commit -m "Track baselines with Git LFS"
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Visual Regression Tests

on: [push, pull_request]

jobs:
  visual-regression:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          lfs: true
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: |
          npm install
          cd tools/visual-regression && npm install
          npx playwright install chromium
      
      - name: Start dev server
        run: npm run dev &
      
      - name: Wait for server
        run: npx wait-on http://localhost:5173
      
      - name: Run visual tests
        run: cd tools/visual-regression && npm run test:visual
      
      - name: Upload report
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: visual-regression-report
          path: test/screenshots/report/
```

## Troubleshooting

### Screenshots are inconsistent

- Increase `waitForStable` time in viewpoint config
- Check for non-deterministic animations
- Ensure consistent random seed in game

### Tests fail due to anti-aliasing differences

- Use perceptual diff (enabled by default)
- Increase threshold slightly: `--threshold 0.1`

### Baselines not found

```bash
# Check baseline index
npm run baseline -- stats

# Re-create baselines
npm run test:visual -- --update
```

### WebGPU not available

The system falls back to WebGL if WebGPU is unavailable. For accurate performance profiling, use a browser with WebGPU support (Chrome Canary, Edge Dev).

## API Reference

### ScreenshotCapture

```typescript
import { ScreenshotCapture } from './src/screenshot-capture.js';

const capture = new ScreenshotCapture('http://localhost:5173');
await capture.init(viewport);
await capture.navigate({ viewpoint, quality, viewport, outputDir });
const path = await capture.capture(options);
await capture.close();
```

### ScreenshotComparator

```typescript
import { ScreenshotComparator } from './src/screenshot-compare.js';

const comparator = new ScreenshotComparator();
const result = await comparator.compare(
  baselinePath,
  currentPath,
  outputDir,
  { threshold: 0.05, includeAA: false }
);
```

### BaselineManager

```typescript
import { BaselineManager } from './src/baseline-manager.js';

const manager = new BaselineManager({ baselineDir: './test/baselines' });
await manager.init();
await manager.addBaseline(screenshotPath, { viewpoint, quality, viewport });
const baseline = await manager.getBaseline(viewpoint, quality, viewport);
```

## Contributing

When adding new viewpoints:

1. Add viewpoint config to `src/screenshot-capture.ts`
2. Document in README
3. Update example config
4. Create baselines for the new viewpoint

## License

Part of candy_world project.
