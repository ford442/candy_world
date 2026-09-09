import re

with open('src/systems/physics/physics-core.ts', 'r') as f:
    content = f.read()

content = content.replace("const _characterGroundQuery = _characterGroundQuery;", "")

with open('src/systems/physics/physics-core.ts', 'w') as f:
    f.write(content)
