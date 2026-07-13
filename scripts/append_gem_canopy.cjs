const fs = require('fs');

const path = 'assets/map.json';
const mapData = JSON.parse(fs.readFileSync(path, 'utf8'));

if (!mapData.metadata.biomes.includes('gem_canopy')) {
    mapData.metadata.biomes.push('gem_canopy');
}

const startX = 75;
const startZ = -115;
const endX = 125;
const endZ = -45;
const corridorWidth = 14;
const treeCount = 24;

const dx = endX - startX;
const dz = endZ - startZ;
const len = Math.sqrt(dx * dx + dz * dz) || 1;
const perpX = -dz / len;
const perpZ = dx / len;

// Seed a determinisic RNG to avoid random generation changing on rebuilds
function seededRandom(seed) {
    let s = seed;
    return function() {
        s = Math.sin(s) * 10000;
        return s - Math.floor(s);
    };
}
const rng = seededRandom(1337);

let added = 0;
for (let i = 0; i < treeCount; i++) {
    const t = treeCount > 1 ? i / (treeCount - 1) : 0;
    const side = i % 2 === 0 ? 1 : -1;
    const lateral = (corridorWidth * 0.5 + rng() * 2.5) * side;
    const x = startX + dx * t + perpX * lateral + (rng() - 0.5) * 2;
    const z = startZ + dz * t + perpZ * lateral + (rng() - 0.5) * 2;

    const y = 5.0; // Estimate or let the engine sample it via unified height map logic later
    const height = 4.2 + rng() * 1.8;
    const rotation = Math.atan2(dx, dz) + (rng() - 0.5) * 0.35;

    mapData.entities.push({
        type: 'gem_canopy_tree',
        position: [x, y, z],
        scale: height / 4.5,
        rotation: rotation
    });
    added++;
}

mapData.metadata.entityCount += added;

fs.writeFileSync(path, JSON.stringify(mapData, null, 2));
console.log(`Added ${added} gem_canopy_trees to map.json`);
