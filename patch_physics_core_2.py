import re

with open('src/systems/physics/physics-core.ts', 'r') as f:
    content = f.read()

# Fix 1: Import _lastInputState
content = content.replace(
    "    _scratchUp,\n} from './physics-types.ts';",
    "    _scratchUp,\n    _lastInputState,\n} from './physics-types.ts';"
)

# Fix 2: Move the object creation out of the hot path
# Find where to insert the object
import_str = "import { resolveCharacterMovement } from './character-controller.ts';"
object_str = "const _characterGroundQuery = { sampleFootprint: sampleGroundFootprint, getGroundHeight };"
content = content.replace(
    import_str,
    import_str + "\n\n" + object_str
)

# Replace the object creation in resolveCharacterMovement
content = content.replace(
    "{ sampleFootprint: sampleGroundFootprint, getGroundHeight }",
    "_characterGroundQuery"
)

with open('src/systems/physics/physics-core.ts', 'w') as f:
    f.write(content)
