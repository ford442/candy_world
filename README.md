# candy_world

A 3D world of rudimentary, but sharp graphically nature - featuring smooth, glossy shapes in a pastel candy-colored landscape.

## Features

- **WebGPU rendering** - Modern GPU API for high-performance 3D graphics
- **Smooth, glossy graphics** - Rounded organic shapes with specular highlights
- **Nature-themed candy world** - Trees, mushrooms with faces, and clouds
- **Pastel color palette** - Soft greens, pinks, purples, and oranges inspired by candy aesthetics
- **Orbit camera controls** - Mouse to look around and scroll to zoom
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

## How to Run

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

## Controls

- **Mouse Drag** - Look around the world (Left Click + Drag)
- **Mouse Wheel** - Zoom in/out

## Technical Details

- Built with Three.js and WebGPU renderer
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
- OrbitControls for smooth camera movement
- Vite build system for fast development and optimized production builds

Enjoy wandering through this memorable 3D candy nature world!
