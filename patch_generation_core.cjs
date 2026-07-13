const fs = require('fs');
let code = fs.readFileSync('src/world/generation-core.ts', 'utf8');

// Replace all occurrences of getUnifiedGroundHeight with sampleGroundY
code = code.replace(/getUnifiedGroundHeight/g, 'sampleGroundY');

// Replace the import
code = code.replace(
    /getUnifiedGroundHeight, isPositionValid, yieldControl, normalizeMapEntityType/,
    `isPositionValid, yieldControl, normalizeMapEntityType`
);
code = code.replace(
    /import { plantOnSurface } from '\.\/placement-utils\.ts';/,
    `import { plantOnSurface, sampleGroundY } from './placement-utils.ts';`
);

fs.writeFileSync('src/world/generation-core.ts', code);
