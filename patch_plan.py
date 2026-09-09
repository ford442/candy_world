import re

with open('plan.md', 'r') as f:
    content = f.read()

# Update plan.md to mark #1577 as Implemented ✅ and add it to Accomplished section
# Find the end of the Accomplished section
accomplished_header = "## Accomplished / Recent Progress"
if accomplished_header in content:
    idx = content.find(accomplished_header) + len(accomplished_header) + 1
    new_entry = """
- **Status: Implemented ✅** (#1577 Make the kinematic controller the single owner of player movement on both physics paths)
  - Implementation Details: Consolidated the WASM native path and JS fallback into a single unified character controller path in `physics-core.ts`. C++ now only handles raw integration and obstacle collision, while the TS controller handles all kinematic resolve (slope limit, step-up, coyote-time, air control) using a zero-allocation `resolveCharacterMovement` setup.
"""
    content = content[:idx] + new_entry + content[idx:]

with open('plan.md', 'w') as f:
    f.write(content)
