const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

content = content.replace(
  /\[visibleIndicesData, lodLevelsData\] = await Promise\.all\(\[\n                this\.gpu\.readBufferU32\(this\.compactIndicesBuffer!, visibleCount \* 4\),\n                this\.gpu\.readBufferU32\(this\.compactLodsBuffer!, visibleCount \* 4\),\n            \]\);/,
  `const [vData, lData] = await Promise.all([
                this.gpu.readBufferU32(this.compactIndicesBuffer!, visibleCount * 4),
                this.gpu.readBufferU32(this.compactLodsBuffer!, visibleCount * 4),
            ]);
            visibleIndicesData = vData as unknown as Uint32Array;
            lodLevelsData = lData as unknown as Uint32Array;`
);

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
