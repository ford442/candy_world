with open('src/utils/wasm-loader-types.ts', 'r') as f:
    content = f.read()
content = content.replace('_batchUpdateLODMatrices_c?: (...args: number[]) => void;', '_batchUpdateLODMatrices_c?: (...args: number[]) => void;\n    _batchUpdateLodFactors_c?: (...args: number[]) => void;')
with open('src/utils/wasm-loader-types.ts', 'w') as f:
    f.write(content)

with open('src/utils/wasm-loader.ts', 'r') as f:
    content = f.read()
content = content.replace('batchUpdateLODMatrices_c,', 'batchUpdateLODMatrices_c,\n    batchUpdateLodFactors_c,')
with open('src/utils/wasm-loader.ts', 'w') as f:
    f.write(content)

with open('src/utils/wasm-batch.ts', 'r') as f:
    content = f.read()
content = content.replace('batchUpdateLODMatrices_c,', 'batchUpdateLODMatrices_c,\n    batchUpdateLodFactors_c,')
with open('src/utils/wasm-batch.ts', 'w') as f:
    f.write(content)
