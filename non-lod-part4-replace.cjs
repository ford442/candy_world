const fs = require('fs');

// 1. foliage-materials.ts
let p1 = 'src/foliage/foliage-materials.ts';
let c1 = fs.readFileSync(p1, 'utf8');
c1 = c1.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction,\n    applyStandardDeformation,'
);
c1 = c1.replace(
    'const withPush = applyPlayerInteraction(positionLocal);\n        mat.positionNode = withPush.add(calculateWindSway(positionLocal));',
    'mat.positionNode = applyStandardDeformation(positionLocal);'
);
c1 = c1.replace(
    'const withPush = applyPlayerInteraction(positionLocal);\n        mat.positionNode = withPush.add(calculateWindSway(positionLocal));',
    'mat.positionNode = applyStandardDeformation(positionLocal);'
);
c1 = c1.replace(
    'mat.positionNode = applyPlayerInteraction(newPos);',
    'mat.positionNode = applyStandardDeformation(newPos);'
);
fs.writeFileSync(p1, c1);

// 2. berries.ts
let p2 = 'src/foliage/berries.ts';
let c2 = fs.readFileSync(p2, 'utf8');
c2 = c2.replace(
    'applyPlayerInteraction',
    'applyPlayerInteraction, applyStandardDeformation'
);
c2 = c2.replace(
    'const posWind = posScaled.add(calculateWindSway(posScaled));\n    material.positionNode = applyPlayerInteraction(posWind);',
    'material.positionNode = applyStandardDeformation(posScaled);'
);
fs.writeFileSync(p2, c2);

// 3. trees.ts
let p3 = 'src/foliage/trees.ts';
let c3 = fs.readFileSync(p3, 'utf8');
c3 = c3.replace(
    'applyPlayerInteraction',
    'applyPlayerInteraction, applyStandardDeformation'
);
c3 = c3.replace(
    /mat\.positionNode = applyPlayerInteraction\(positionLocal\.add\(calculateWindSway\(positionLocal\)\)\);/g,
    'mat.positionNode = applyStandardDeformation(positionLocal);'
);
fs.writeFileSync(p3, c3);
