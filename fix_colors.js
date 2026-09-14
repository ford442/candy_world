import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/systems/music-reactivity-bindings.ts', 'utf8');
content = content.replace(/import \{ noteColorMap \} from '\.\.\/core\/config\.ts';\n/, "import { CONFIG } from '../core/config.ts';\n");

// wait, is it already importing CONFIG?
if (content.includes('import { CONFIG }')) {
   // if already there, don't duplicate
}
// We also need to fix `noteColorMap` accesses if it was using it directly.
// The original code used `CONFIG.noteColorMap`. The import `import { noteColorMap }` was a mistake. Let's just remove it.
content = content.replace(/import \{ noteColorMap \} from '\.\.\/core\/config\.ts';\n/, "");
writeFileSync('src/systems/music-reactivity-bindings.ts', content);
