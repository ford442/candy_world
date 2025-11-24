# candy_world

A 3D world of rudimentary, but sharp graphically nature.

## Features

- **Pure WebGL rendering** - No external dependencies, runs in any modern browser
- **Sharp, flat-shaded graphics** - Rudimentary geometric shapes with crisp lighting
- **Candy-themed world** - Colorful cubes and pyramids scattered across a landscape
- **First-person navigation** - WASD or Arrow keys to move, mouse to look around
- **Animated objects** - Candy shapes rotate slowly as you explore
- **3D perspective** - Proper depth rendering with WebGL

## How to Run

1. Open `index.html` in a modern web browser, or
2. Serve with a local web server:
   ```bash
   python3 -m http.server 8000
   ```
   Then navigate to `http://localhost:8000`

## Controls

- **WASD** or **Arrow Keys** - Move around the world
- **Mouse** - Look around (click canvas first to lock pointer)
- **Click canvas** - Start interaction and lock pointer

## Technical Details

- Built with raw WebGL (no libraries required)
- Vertex and fragment shaders for lighting
- Flat shading for sharp, faceted appearance
- 50 procedurally placed candy objects
- 200x200 unit ground plane
- Depth testing for proper 3D rendering

Enjoy wandering through the candy world!
