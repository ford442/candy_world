import re

with open('emscripten/exports.txt', 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    new_lines.append(line)
    if line.strip() == '_batchUpdateLODMatrices_c':
        new_lines.append('_batchUpdateLodFactors_c\n')

with open('emscripten/exports.txt', 'w') as f:
    f.writelines(new_lines)

with open('emscripten/build.sh', 'r') as f:
    content = f.read()

content = content.replace('["batchUpdateLODMatrices_c"]="lod_batch"', '["batchUpdateLODMatrices_c"]="lod_batch"\n    ["batchUpdateLodFactors_c"]="lod_batch"')

with open('emscripten/build.sh', 'w') as f:
    f.write(content)
