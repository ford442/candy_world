# grok.md — Grok AI Assistant Guide for candy_world

> Read this first when working on this repo.

## Project Overview
**candy_world** (Siphon Part I of the Siphon Quadrilogy) is a beautiful, music-reactive first-person 3D fantasy world built with WebGPU. It features smooth glossy candy-colored nature (mushroom trees, floating clouds, pastel rocks) with a strong emphasis on visual polish and atmosphere.

- **Core Vibe**: Low-poly nature meets candy aesthetics — glossy, soft, dreamy.
- **Live Demo**: https://go.1ink.us/candy-world/v0.9/index.html
- **Focus**: WebGPU rendering, organic shapes, specular highlights, animation, and future music reactivity.

## Technology Stack
- **Rendering**: Three.js + WebGPU renderer (MeshPhysicalMaterial with clearcoat for candy surfaces)
- **Build**: Vite + TypeScript
- **Controls**: Pointer-lock first-person (click to lock, mouse look, WASD + abilities)
- **Key Features**: Procedurally generated geometry, animated mushrooms, floating clouds, fog, rolling hills

## Key Files & Structure
- `index.html` / main entry
- Scene setup, materials, and procedural generation in main TS files
- `SETUP_GUIDE.md` for native module / Emscripten notes (if applicable)

## Development
```bash
npm install
npm run dev
```
Open http://localhost:5173. Requires a modern browser with WebGPU support (Chrome 113+ / Edge 113+ recommended).

## Grok Guidelines
- **Visual Polish First**: Prioritize glossy materials, good lighting, specular highlights, and smooth animations.
- **Performance**: Keep 60fps on mid-range hardware. Watch draw calls and geometry complexity.
- **Music Reactivity**: When adding features, think about how elements can respond to audio (future Siphon Quadrilogy goal).
- **Atmosphere over Realism**: Embrace the candy-dream aesthetic — soft pastels, rounded shapes, playful details.
- **Future-Proof**: Design so new elements (more trees, creatures, weather) can be added easily.

## Common Tasks
- Add new procedural elements (rocks, flowers, creatures)
- Improve lighting / post-processing
- Enhance animations or add particle effects
- Optimize for lower-end devices
- Prepare for music-reactive extensions

This world already feels magical — let's make it even more immersive and alive. Ready when you are! 🍭✨