const fs = require('fs');
const filepath = 'src/core/main/shader-warmup.ts';
let content = fs.readFileSync(filepath, 'utf-8');

content = content.replace(
    /            if \(CONFIG\.safeMode \|\| isCIorHeadless\(\)\) \{\n                console\.warn\('\[Startup\] safeMode active — skipping shader warmup'\);\n                return;\n            \}/,
    `            if (CONFIG.safeMode || isCIorHeadless()) {
                console.warn('[Startup] safeMode active — skipping shader warmup');
                try {
                    (window as any).__sceneReady = true;
                } catch (e) {}
                return;
            }`
);

fs.writeFileSync(filepath, content);
