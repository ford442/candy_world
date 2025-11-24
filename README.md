# candy_world

A 3D world of rudimentary, but sharp graphically nature - featuring smooth, glossy shapes in a pastel candy-colored landscape.

## Features

- **Pure WebGL rendering** - No external dependencies, runs in any modern browser
- **Smooth, glossy graphics** - Rounded organic shapes with specular highlights
- **Nature-themed candy world** - Trees, mushrooms, rocks, flowers, and clouds
- **Pastel color palette** - Soft greens, pinks, purples, and oranges inspired by candy aesthetics
- **First-person navigation** - WASD or Arrow keys to move, mouse to look around
- **Animated elements** - Some objects rotate gently as you explore
- **3D perspective** - Proper depth rendering with WebGL

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

1. Open `index.html` in a modern web browser, or
2. Serve with a local web server:
   ```bash
   python3 -m http.server 8000
   ```
   Then navigate to `http://localhost:8000`

## Controls

- **WASD** or **Arrow Keys** - Move around the world
- **Mouse** - Look around (click canvas first to lock pointer)
- **Click canvas** - Start exploring and lock pointer

## Technical Details

- Built with raw WebGL (no external libraries required)
- Custom vertex and fragment shaders with:
  - Smooth Phong-style lighting
  - Specular highlights for glossiness
  - Rim lighting for extra polish
- Procedurally generated geometry:
  - Smooth spheres (16 segments for detail)
  - Domed caps (hemisphere geometry)
  - Smooth cylinders for trunks
- 100+ objects including trees, mushrooms, rocks, flowers, and clouds
- 200x200 unit ground plane
- Depth testing for proper 3D rendering

Enjoy wandering through this memorable 3D candy nature world!
