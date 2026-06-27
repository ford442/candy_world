const fs = require('fs');

// 1. subwoofer-lotus-batcher.ts
let p1 = 'src/foliage/subwoofer-lotus-batcher.ts';
let c1 = fs.readFileSync(p1, 'utf8');

c1 = c1.replace(
    /applyPlayerInteraction\n/g,
    'applyPlayerInteraction,\n    applyStandardDeformation\n'
);

c1 = c1.replace(
    'padMat.positionNode = applyPlayerInteraction(positionLocal.add(calculateWindSway(positionLocal)));',
    'padMat.positionNode = applyStandardDeformation(positionLocal);'
);

c1 = c1.replace(
    'mat.positionNode = applyPlayerInteraction(newPos.add(calculateWindSway(newPos)));',
    'mat.positionNode = applyStandardDeformation(newPos);'
);

c1 = c1.replace(
    'centerMat.positionNode = applyPlayerInteraction(positionLocal.add(calculateWindSway(positionLocal)));',
    'centerMat.positionNode = applyStandardDeformation(positionLocal);'
);

fs.writeFileSync(p1, c1);

// 2. kick-drum-geyser-batcher.ts
let p2 = 'src/foliage/kick-drum-geyser-batcher.ts';
let c2 = fs.readFileSync(p2, 'utf8');

c2 = c2.replace(
    /applyPlayerInteraction,\n/g,
    'applyPlayerInteraction,\n    applyStandardDeformation,\n'
);

c2 = c2.replace(
    'plumeMat.positionNode = applyPlayerInteraction(plumePos.add(calculateWindSway(plumePos)));',
    'plumeMat.positionNode = applyStandardDeformation(plumePos);'
);

fs.writeFileSync(p2, c2);

// 3. glass-mushroom-batcher.ts
let p3 = 'src/foliage/glass-mushroom-batcher.ts';
let c3 = fs.readFileSync(p3, 'utf8');

c3 = c3.replace(
    /applyPlayerInteraction,\n/g,
    'applyPlayerInteraction,\n    applyStandardDeformation,\n'
);

c3 = c3.replace(
    'mat.positionNode = applyPlayerInteraction(displaced.add(calculateWindSway(displaced)));',
    'mat.positionNode = applyStandardDeformation(displaced);'
);

fs.writeFileSync(p3, c3);
