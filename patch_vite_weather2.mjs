import fs from 'fs';
let content = fs.readFileSync('vite.config.js', 'utf8');

if (content.includes("return 'app';")) {
   content = content.replace(
     /if \(\s*id\.includes\('\/src\/core\/'\)\s*\|\|\s*id\.includes\('\/src\/foliage\/'\)\s*\|\|\s*id\.includes\('\/src\/particles\/'\)\s*\|\|\s*id\.includes\('\/src\/rendering\/'\)\s*\|\|\s*id\.includes\('\/src\/systems\/'\)\s*\|\|\s*id\.includes\('\/src\/ui\/'\)\s*\|\|\s*id\.includes\('\/src\/utils\/'\)\s*\|\|\s*id\.includes\('\/src\/world\/'\)\s*\|\|\s*id\.includes\('\/src\/debug\/'\)\s*\|\|\s*id\.includes\('\/src\/compute\/'\)\s*\) \{\s*return 'app';\s*\}/s,
    `if (id.includes('/src/systems/weather/') || id.includes('/src/particles/') || id.includes('/src/compute/')) { return 'weather'; }\n          if (
            id.includes('/src/core/') ||
            id.includes('/src/foliage/') ||
            id.includes('/src/rendering/') ||
            id.includes('/src/systems/') ||
            id.includes('/src/ui/') ||
            id.includes('/src/utils/') ||
            id.includes('/src/world/') ||
            id.includes('/src/debug/')
          ) {
            return 'app';
          }`
   );
}

fs.writeFileSync('vite.config.js', content);
