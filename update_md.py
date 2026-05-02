with open("IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md", "r") as f:
    lines = f.readlines()

new_lines = []
in_next_steps = False
for line in lines:
    if line.startswith("## Next Steps"):
        in_next_steps = True
        new_lines.append(line)
        continue
    if in_next_steps:
        # Stop at the end of the file or next header
        if line.startswith("## ") and not line.startswith("## Next Steps"):
            in_next_steps = False
            new_lines.append(line)
        else:
            # We skip adding the current next steps, to replace them.
            pass
    else:
        new_lines.append(line)

new_steps = """
1. **Foliage Growth & Rain-Driven Spreading**
   - Foliage can spread into empty areas during/after rain according to local spawning rules.
"""

with open("IMPLEMENTATION_PLAN_MUSICAL_ECOSYSTEM.md", "w") as f:
    for line in new_lines:
        f.write(line)
    f.write(new_steps)
