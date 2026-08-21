const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');
content = content.replace(
  /let visibleIndicesData: Uint32Array = new Uint32Array\(0\);\n        let lodLevelsData: Uint32Array = new Uint32Array\(0\);/,
  `let visibleIndicesData = new Uint32Array(0);
        let lodLevelsData = new Uint32Array(0);`
);

content = content.replace(
  /return \{\n            visibleIndices: visibleIndicesData as unknown as Uint32Array<ArrayBuffer>,\n            lodLevels: lodLevelsData as unknown as Uint32Array<ArrayBuffer>,\n            visibleCount: visibleCount,\n        \};/,
  `return {
            visibleIndices: visibleIndicesData,
            lodLevels: lodLevelsData,
            visibleCount: visibleCount,
        };`
);
fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
