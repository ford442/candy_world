# Copilot Instructions for Candy World

## Project Overview

Candy World is a 3D interactive experience featuring a pastel candy-colored landscape with smooth, glossy shapes. The project creates a nature-themed world with trees, mushrooms, clouds, and other organic elements rendered using modern WebGPU technology.

## Technology Stack

- **Rendering**: Three.js with WebGPU renderer
- **Build System**: Vite (v7.2.4)
- **Language**: JavaScript (ES modules)
- **WebAssembly**: AssemblyScript for performance-critical physics calculations
- **Browser Requirements**: Chrome 113+, Edge 113+, or browsers with WebGPU enabled

## Project Architecture

### Core Files

- **`main.js`**: Main entry point, scene setup, camera, lighting, player controls, and animation loop
- **`foliage.js`**: Functions for creating and animating vegetation (grass, flowers, trees, shrubs, vines, etc.)
- **`sky.js`**: Sky gradient creation using TSL (Three.js Shading Language)
- **`index.html`**: HTML structure with import maps for Three.js modules
- **`assembly/index.ts`**: AssemblyScript module for collision detection

### Module Organization

- Foliage creation functions follow a factory pattern (e.g., `createFlower()`, `createTree()`)
- Each element has configurable options for color, size, and shape
- Animation is handled through userData properties on meshes
- Materials use `MeshStandardMaterial` and `MeshPhysicalMaterial` with clearcoat for candy aesthetics

## Development Workflow

### Starting Development

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (http://localhost:5173)
```

### Building for Production

```bash
npm run build        # Build to dist/ directory
npm run preview      # Preview production build
```

### WebAssembly Module

```bash
npm run build:wasm   # Compile AssemblyScript to WASM
```

## Code Conventions

### Styling and Materials

- Use pastel colors for the candy aesthetic (e.g., `0xFF69B4`, `0x87CEFA`, `0x98FB98`)
- Prefer `MeshPhysicalMaterial` with `clearcoat` for glossy candy surfaces
- Use `MeshStandardMaterial` for ground and matte elements
- Keep roughness low (0.2-0.4) for shiny surfaces, high (0.8) for matte clay-like surfaces

### Geometry Creation

- Create reusable geometry with functions that accept configuration objects
- Anchor objects at their base by translating geometry after creation
- Use `computeVertexNormals()` after modifying geometry
- Enable `castShadow` and `receiveShadow` for objects

### Animation

- Store animation metadata in `mesh.userData` (e.g., `animationType`, `animationOffset`)
- Use `Math.random()` offsets to desynchronize animations
- Keep animations subtle with sine/cosine waves

### WebGPU and TSL

- Use Three.js Shading Language (TSL) nodes from `three/tsl` for shader code
- Import WebGPU-specific materials from `three/webgpu`
- Check WebGPU availability before initializing renderer

### Scene Organization

- Use `THREE.Group` to organize related objects
- Add fog for depth (`THREE.Fog`)
- Use `HemisphereLight` for ambient lighting with sky/ground colors
- Include directional light for sun effects

## File Structure Guidelines

- Keep utility functions modular in separate files
- Export factory functions for creating game objects
- Use ES modules (`import`/`export`)
- Maintain separation between rendering (`main.js`), content creation (`foliage.js`), and utilities (`sky.js`)

## Common Tasks

### Adding New Foliage Types

1. Create a factory function in `foliage.js` (e.g., `createNewPlant()`)
2. Define materials with appropriate colors and properties
3. Create geometry using Three.js primitives or custom shapes
4. Add animation metadata to `userData` if needed
5. Export the function and import it in `main.js`

### Modifying Colors

- Update the `CONFIG.colors` object in `main.js` for global colors (defined properties: `sky`, `ground`, `fog`, `light`, `ambient`)
- Currently active properties: `sky` (scene background), `ground` (hemisphere light), `fog` (fog color), `light` (directional light)
- Modify material creation functions in `foliage.js` for specific elements
- Maintain the pastel candy color palette

### Performance Optimization

- Reuse geometries and materials when creating multiple instances
- Use instanced rendering for repeated elements (via grass system)
- Limit scene complexity (current: 30 trees, 20 mushrooms, 15 clouds)
- Consider AssemblyScript for physics-heavy computations

## Testing

Currently, this project has no automated testing infrastructure. Testing is done manually by:
1. Running the dev server
2. Visually inspecting the scene
3. Testing controls and interactions

## Common Pitfalls

- **WebGPU Support**: Always check `WebGPU.isAvailable()` before using WebGPU features
- **Import Paths**: Use the import map defined in `index.html` for Three.js modules
- **Geometry Translation**: Remember to translate geometry to anchor objects at their base
- **TSL Syntax**: TSL nodes require method chaining (e.g., `.add()`, `.normalize()`)
- **WebGPU Renderer**: Use `renderer.setAnimationLoop(animate)` for animation loops with WebGPU renderer, and `await renderer.renderAsync(scene, camera)` within async animation functions

## Performance Considerations

- Target 60 FPS on systems with WebGPU support
- Terrain size is 300x300 units - avoid making it larger
- Fog range (20-100) helps with draw distance culling
- Use `renderer.setAnimationLoop(animate)` for animations (WebGPU renderer handles timing internally)

## Visual Style Guidelines

- Maintain smooth, rounded, organic shapes
- Use glossy shading with specular highlights
- Keep color palette soft and pastel
- Add subtle animations for life and movement
- Balance between simplicity and visual interest
