# Siphon Part I (Of the Siphon Quadrilogy)

A 3D world of rudimentary, but sharp graphically nature - featuring smooth, glossy shapes in a pastel candy-colored landscape.

## Features

- **WebGPU rendering** - Modern GPU API for high-performance 3D graphics
- **WebGL2 fallback** - Opt-in reference renderer for debugging, CI, and agent visual inspection (`?renderer=webgl`)
- **Smooth, glossy graphics** - Rounded organic shapes with specular highlights
- **Nature-themed candy world** - Trees, mushrooms with faces, and clouds
- **Pastel color palette** - Soft greens, pinks, purples, and oranges inspired by candy aesthetics
- **First-person controls** - Pointer lock mouse look, WASD movement, and movement abilities
- **Animated elements** - Mushrooms bounce and clouds drift across the sky
- **3D perspective** - Proper depth rendering with WebGPU
- **npm buildable** - Modern build system with Vite

## Visual Style

The world features:
- **Mushroom-style trees** with rounded caps and brown trunks
- **Smooth rocks** in pastel purple and pink tones
- **Colorful mushrooms** with soft caps
- **Floating clouds** in the cream-colored sky
- **Decorative spheres** scattered throughout
- **Glossy shading** with specular highlights for a polished look

Inspired by low-poly nature scenes with a candy twist!

> **Building visuals?** Start with [grok.md](./grok.md) (5-minute quick-start) and the
> [Candy Material Cookbook](./docs/CANDY_MATERIAL_COOKBOOK.md) — reusable glossy-material
> recipes, copy-paste TSL snippets, and an "adding a reactive plant" tutorial.

## How to Run

> **Note**: For detailed setup instructions including native module compilation with Emscripten, see [SETUP_GUIDE.md](./SETUP_GUIDE.md)

### Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

3. Open your browser to `http://localhost:5173`

   For WebGL2 debugging or CI screenshots, use `http://localhost:5173/?renderer=webgl`.
   See [docs/webgl-fallback.md](./docs/webgl-fallback.md) for full renderer toggle and porting notes.

### Production Build

Build the project for production:
```bash
npm run build
```

The built files will be in the `dist/` directory. You can preview the production build with:
```bash
npm run preview
```

### Requirements

- Node.js 16+ and npm
- A modern browser with WebGPU support (Chrome 113+, Edge 113+, or other browsers with WebGPU enabled)
- **WebGL2 fallback**: any browser with WebGL2 — use `?renderer=webgl` when WebGPU is unavailable or for visual debugging

## Controls

### First-person
- **Click / Mouse** - Enter pointer-lock and look around in first-person
- **W / A / S / D** - Move
- **Shift** - Sprint
- **Space** - Jump (double-jump supported)
- **E / F / Z** - Dash / Jitter Mine / Phase Shift
- **Esc** - Pause and release cursor

### Cinematic Explore / Wander
- **Tab (hold)** - Temporary orbit camera (release Tab to return to first-person)
- **Pause menu → Explore Mode** or **`?explore=1`** - Toggle persistent explore (saved in `localStorage`)
- **`?explore=hybrid`** - First-person with right-mouse orbit + WASD pan while orbiting
- **Drag / scroll** - Orbit and zoom while exploring
- **Enter / click** - Exit explore at current view (ground-snapped spawn)

## Technical Details

- Built with Three.js and WebGPU renderer (with opt-in WebGL2 fallback)
- Modern WebGPU API for next-generation graphics
- Advanced materials:
  - MeshPhysicalMaterial with clearcoat for candy surfaces
  - MeshStandardMaterial for ground and other elements
  - Transparent materials for clouds
- Procedurally generated geometry:
  - Smooth spheres for tree canopies and mushroom faces
  - Domed caps (hemisphere geometry) for mushroom caps
  - Cylinders for tree and mushroom stems
  - Rolling hills with sine wave displacement
- 30 trees, 20 animated mushrooms with faces, and 15 floating clouds
- 300x300 unit terrain with fog effects
- PointerLockControls for immersive first-person camera movement
- Vite build system for fast development and optimized production builds

Enjoy wandering through this memorable 3D candy nature world!
