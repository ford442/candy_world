const fs = require('fs');
const path = 'src/systems/physics/physics-core.ts';
let code = fs.readFileSync(path, 'utf8');

const target1 = `    private cells: Map<string, any[]>;`;
const replace1 = `    private cells: Map<number, any[]>;`;

const target2 = `    private getHash(x: number, z: number): string {
        return \`\${Math.floor(x / this.cellSize)},\${Math.floor(z / this.cellSize)}\`;
    }`;
const replace2 = `    private getHash(x: number, z: number): number {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        // Pack into a single numeric key (assuming coordinates don't exceed +/- 32767 chunks)
        // using 16 bits for x and 16 bits for z
        return ((cx & 0xFFFF) << 16) | (cz & 0xFFFF);
    }`;

const target3 = `        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = \`\${cx},\${cz}\`;
                const cell = this.cells.get(hash);`;
const replace3 = `        for (let cx = minX; cx <= maxX; cx++) {
            for (let cz = minZ; cz <= maxZ; cz++) {
                const hash = ((cx & 0xFFFF) << 16) | (cz & 0xFFFF);
                const cell = this.cells.get(hash);`;

if (code.includes(target1) && code.includes(target2) && code.includes(target3)) {
    code = code.replace(target1, replace1).replace(target2, replace2).replace(target3, replace3);
    fs.writeFileSync(path, code);
    console.log('Replaced block in ' + path);
} else {
    console.log('Target block not found in ' + path);
}
