with open('src/systems/batcher-lod.ts', 'r') as f:
    content = f.read()

content = content.replace("import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';", "import { safeRemoveAndDispose } from '../utils/dispose-utils.ts';\nimport { batchUpdateLodFactors_c } from '../utils/wasm-batch.ts';\nimport { isEmscriptenReady } from '../utils/wasm-loader.ts';")
with open('src/systems/batcher-lod.ts', 'w') as f:
    f.write(content)
