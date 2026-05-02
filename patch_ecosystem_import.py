import os
import re

with open("src/systems/weather/weather-ecosystem.ts", "r") as f:
    content = f.read()

# Make sure cpuAnimatedFoliage is imported properly
if "import { cpuAnimatedFoliage } from '../../world/state.ts';" not in content:
    content = "import { cpuAnimatedFoliage } from '../../world/state.ts';\n" + content

with open("src/systems/weather/weather-ecosystem.ts", "w") as f:
    f.write(content)
