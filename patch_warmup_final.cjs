const fs = require('fs');
const filepath = 'src/core/main/shader-warmup.ts';
let content = fs.readFileSync(filepath, 'utf-8');

content = content.replace(
    /        await StageLoader\.loadStage\('shaderWarmup', async \(\) => \{\n            if \(CONFIG\.safeMode \|\| isCIorHeadless\(\)\) \{\n                console\.warn\('\[Startup\] safeMode active — skipping shader warmup'\);\n                try \{\n                    \(window as any\)\.__sceneReady = true;\n                \} catch \(e\) \{\}\n                return;\n            \}/,
    `        await StageLoader.loadStage('shaderWarmup', async () => {
            if (CONFIG.safeMode || isCIorHeadless()) {
                console.warn('[Startup] safeMode active — skipping shader warmup');
                return;
            }`
);

fs.writeFileSync(filepath, content);
