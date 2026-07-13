const fs = require('fs');
let code = fs.readFileSync('src/world/generation-decorators.ts', 'utf8');

code = code.replace(
    /sampleGroundY, isPositionValid, normalizeMapEntityType,/,
    `isPositionValid, normalizeMapEntityType,`
);

fs.writeFileSync('src/world/generation-decorators.ts', code);
