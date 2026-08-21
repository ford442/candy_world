const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');
content = content.replace(
  /visibleIndices: visibleIndicesData,/,
  `visibleIndices: visibleIndicesData as unknown as Uint32Array,`
);
content = content.replace(
  /lodLevels: lodLevelsData,/,
  `lodLevels: lodLevelsData as unknown as Uint32Array,`
);
fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
