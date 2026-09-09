import re

with open('src/systems/physics/physics-updates.ts', 'r') as f:
    content = f.read()

# 1. Remove resolveCharacterMovement import
content = content.replace(
    "import { resolveCharacterMovement } from './character-controller.ts';\n",
    ""
)

# 2. Remove sampleGroundFootprint and getGroundHeight imports, as well as reconcileGroundedEyeY from ground-system.ts
content = content.replace(
    "    reconcileGroundedEyeY,\n    sampleGroundFootprint,\n    sampleGroundNormal,\n} from '../ground-system.ts';",
    "    sampleGroundNormal,\n} from '../ground-system.ts';"
)
content = content.replace(
    "    getGroundHeight,\n    reconcileGroundedEyeY,\n",
    ""
)

# 3. Remove _scratchCamRight, _scratchTargetVel, _scratchUp, _lastInputState from physics-types imports
content = content.replace(
    "    _scratchCamRight,\n    _scratchTargetVel,\n    _scratchUp,\n    _lastInputState,\n",
    ""
)

# 4. Find and remove updateJSFallbackMovement
start_marker = "/**\n * JavaScript fallback movement (used for Lake Basin)."
start_idx = content.find(start_marker)
end_marker = "/**\n * Vine attachment detection and handler."
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + content[end_idx:]

with open('src/systems/physics/physics-updates.ts', 'w') as f:
    f.write(content)
