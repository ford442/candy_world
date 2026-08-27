const fs = require('fs');
const file = 'src/foliage/gem-fruit-batcher.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
`        this._counts[type] = idx + 1;
        mesh.count = idx + 1;
        mesh.instanceMatrix.needsUpdate = true;
        phaseAttr.needsUpdate = true;
        armAttr.needsUpdate = true;
        return idx;`,
`        this._counts[type] = idx + 1;
        mesh.count = idx + 1;
        // ⚡ OPTIMIZATION: Removed needsUpdate=true inside the loop. Flagged externally.
        return idx;`);

fs.writeFileSync(file, code);
