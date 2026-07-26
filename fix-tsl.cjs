const fs = require('fs');
let content = fs.readFileSync('src/foliage/wisteria-cluster.ts', 'utf-8');
content = `import type { ShaderNodeObject, Node } from 'three/tsl';\n` + content;
fs.writeFileSync('src/foliage/wisteria-cluster.ts', content);
