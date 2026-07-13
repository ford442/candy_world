const fs = require('fs');

// 1. mushroom-batcher.ts
let p1 = 'src/foliage/mushroom-batcher.ts';
let c1 = fs.readFileSync(p1, 'utf8');
c1 = c1.replace(
    'scaleEmissiveByLod',
    'scaleEmissiveByLod,\n    applyStandardDeformationWithLod'
);
c1 = c1.replace(
    /const winded = defPos\.add\(calculateWindSwayWithLod\(defPos\)\);\n            m\.positionNode = applyPlayerInteractionWithLod\(winded\);/g,
    'm.positionNode = applyStandardDeformationWithLod(defPos);'
);
fs.writeFileSync(p1, c1);

// 2. luminous-plant-batcher.ts
let p2 = 'src/foliage/luminous-plant-batcher.ts';
let c2 = fs.readFileSync(p2, 'utf8');
c2 = c2.replace(
    'scaleEmissiveByLod',
    'scaleEmissiveByLod,\n    applyStandardDeformationWithLod'
);
c2 = c2.replace(
    'const winded = animatedBase.add(calculateWindSwayWithLod(positionLocal));\n        mat.positionNode = applyPlayerInteractionWithLod(winded);',
    'mat.positionNode = applyStandardDeformationWithLod(animatedBase);'
);
fs.writeFileSync(p2, c2);
