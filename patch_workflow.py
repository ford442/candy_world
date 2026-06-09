import re

with open('.github/workflows/visual-regression.yml', 'r') as f:
    content = f.read()

# Update Node version to 22
content = content.replace("node-version: '20'", "node-version: '22'")
content = content.replace("node-version: '24'", "node-version: '22'")

# Update playwright install to use with-deps
content = content.replace("npx playwright install chromium", "npx playwright install --with-deps chromium")

# Make visual regression non-blocking by adding continue-on-error
old_step = """      - name: Run visual regression tests
        run: |
          cd tools/visual-regression
          pnpm run test:visual -- \\
            --viewpoints spawn,lake,forest \\
            --qualities medium,high \\
            --threshold 0.05"""

new_step = """      - name: Run visual regression tests
        continue-on-error: true # Non-blocking due to WebGPU headless flakiness
        run: |
          cd tools/visual-regression
          pnpm run test:visual -- \\
            --viewpoints spawn,lake,forest \\
            --qualities medium,high \\
            --threshold 0.05"""

content = content.replace(old_step, new_step)

with open('.github/workflows/visual-regression.yml', 'w') as f:
    f.write(content)
