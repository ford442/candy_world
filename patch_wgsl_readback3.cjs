const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

content = content.replace(
  /let visibleIndicesData = new Uint32Array\(0\);\n        let lodLevelsData = new Uint32Array\(0\);/,
  `let visibleIndicesData = new Uint32Array(0) as unknown as any;
        let lodLevelsData = new Uint32Array(0) as unknown as any;`
);

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
