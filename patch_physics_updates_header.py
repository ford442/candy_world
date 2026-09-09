import re

with open('src/systems/physics/physics-updates.ts', 'r') as f:
    content = f.read()

content = content.replace(" * - updateJSFallbackMovement(): JavaScript physics fallback\n", "")

with open('src/systems/physics/physics-updates.ts', 'w') as f:
    f.write(content)
