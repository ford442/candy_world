const fs = require('fs');
const path = 'src/systems/physics/physics-core.ts';
let code = fs.readFileSync(path, 'utf8');

const target1 = `    findNearby(x: number, z: number, radius: number): any[] {
        _globalQueryId++;
        this._queryResult.length = 0;

        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minZ = Math.floor((z - radius) / this.cellSize);
        const maxZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = \`\${cx},\${cz}\`;
                const cell = this.cells.get(hash);`;

const replace1 = `    findNearby(x: number, z: number, radius: number): any[] {
        _globalQueryId++;
        this._queryResult.length = 0;

        const minX = Math.floor((x - radius) / this.cellSize);
        const maxX = Math.floor((x + radius) / this.cellSize);
        const minZ = Math.floor((z - radius) / this.cellSize);
        const maxZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = this.getHash(cx * this.cellSize, cz * this.cellSize); // use standard getHash for consistency but it's string, we want numeric in the future
                const cell = this.cells.get(hash);`;

// Let's first inspect getHash and see what it does. Wait, the problem described is that string allocation is bad.
