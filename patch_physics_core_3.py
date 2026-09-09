import re

with open('src/systems/physics/physics-core.ts', 'r') as f:
    content = f.read()

# Fix 1: Remove the duplicate import
content = content.replace(
    "    _scratchUp,\n    _lastInputState,\n} from './physics-types.ts';",
    "    _scratchUp,\n} from './physics-types.ts';"
)

# Fix 2: Move _characterGroundQuery declaration to avoid "used before declaration"
# Right now, it might have been inserted in the wrong place or something.
# Let's completely remove it first:
content = content.replace("const _characterGroundQuery = { sampleFootprint: sampleGroundFootprint, getGroundHeight };", "")

# We can put it after the ground-system import.
import_str = "import { reconcileGroundedEyeY, isInLakeBasin, getGroundHeight, sampleGroundFootprint } from '../ground-system.ts';"
object_str = "const _characterGroundQuery = { sampleFootprint: sampleGroundFootprint, getGroundHeight };"
content = content.replace(
    import_str,
    import_str + "\n\n" + object_str
)

with open('src/systems/physics/physics-core.ts', 'w') as f:
    f.write(content)
