const fs = require('fs');

// 1. flowers.ts
let p1 = 'src/foliage/flowers.ts';
let c1 = fs.readFileSync(p1, 'utf8');
c1 = c1.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction,\n    applyStandardDeformation,'
);
c1 = c1.replace(
    'const posWind = animatedPos.add(calculateWindSway(animatedPos));\n            const posFinal = applyPlayerInteraction(posWind);\n            mat.positionNode = posFinal;',
    'const posFinal = applyStandardDeformation(animatedPos);\n            mat.positionNode = posFinal;'
);
fs.writeFileSync(p1, c1);

// 2. simple-flower-batcher.ts
let p2 = 'src/foliage/simple-flower-batcher.ts';
let c2 = fs.readFileSync(p2, 'utf8');
c2 = c2.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction,\n    applyStandardDeformation,'
);
c2 = c2.replace(
    'const posWind = posBloom.add(calculateWindSway(posBloom));\n        const posFinal = applyPlayerInteraction(posWind);',
    'const posFinal = applyStandardDeformation(posBloom);'
);
fs.writeFileSync(p2, c2);

// 3. wisteria-cluster.ts
let p3 = 'src/foliage/wisteria-cluster.ts';
let c3 = fs.readFileSync(p3, 'utf8');
c3 = c3.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction, applyStandardDeformation,'
);
c3 = c3.replace(
    'const posWind = posSwayed.add(calculateWindSway(posSwayed));\n        const posFinal = applyPlayerInteraction(posWind);\n        mat.positionNode = posFinal;',
    'const posFinal = applyStandardDeformation(posSwayed);\n        mat.positionNode = posFinal;'
);
fs.writeFileSync(p3, c3);

// 4. dandelion-batcher.ts
let p4 = 'src/foliage/dandelion-batcher.ts';
let c4 = fs.readFileSync(p4, 'utf8');
c4 = c4.replace(
    'applyPlayerInteraction,',
    'applyPlayerInteraction,\n    applyStandardDeformation,'
);
c4 = c4.replace(
    'const posSwayed = posPuffed.add(calculateWindSway(posPuffed));\n            const posFinal = applyPlayerInteraction(posSwayed);',
    'const posFinal = applyStandardDeformation(posPuffed);'
);
fs.writeFileSync(p4, c4);
