const fs = require('fs');
let content = fs.readFileSync('src/foliage/tree-batcher.ts', 'utf-8');
content = content.replace('const BATCH_QUEUE_LIMIT = 500 * 6;', 'const BATCH_QUEUE_LIMIT = 3000 * 6;');
fs.writeFileSync('src/foliage/tree-batcher.ts', content);
