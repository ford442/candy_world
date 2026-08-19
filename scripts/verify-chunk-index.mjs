import { readFileSync } from 'node:fs';
import path from 'node:path';

const mapPath = path.resolve('assets/map.json');
const chunksPath = path.resolve('assets/map-chunks.json');

const mapData = JSON.parse(readFileSync(mapPath, 'utf8'));
const mapLength = mapData.entities ? mapData.entities.length : 0;

const chunksData = JSON.parse(readFileSync(chunksPath, 'utf8'));
const indexedLength = chunksData.__meta__ ? chunksData.__meta__.sourceEntityCount : 0;

if (mapLength !== indexedLength) {
    console.error(`Chunk index is out of date! map.json has ${mapLength} entities, but map-chunks.json has sourceEntityCount ${indexedLength}. Run 'npm run generate:chunk-index' to fix.`);
    process.exit(1);
}

console.log(`Chunk index verified. ${mapLength} entities match.`);
