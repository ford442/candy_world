const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

content = content.replace(
  /if \(this\.gpu\.trackGpuBufferBytes\) \{\n                this\.gpu\.trackGpuBufferBytes\(blocksCount \* 4\);\n                this\.gpu\.trackGpuBufferBytes\(4\);\n                this\.gpu\.trackGpuBufferBytes\(Math\.max\(16, this\.config\.maxObjects \* 4\)\);\n                this\.gpu\.trackGpuBufferBytes\(Math\.max\(16, this\.config\.maxObjects \* 4\)\);\n            \}/,
  `if ('trackGpuBufferBytes' in this.gpu && typeof this.gpu.trackGpuBufferBytes === 'function') {
                (this.gpu as any).trackGpuBufferBytes(blocksCount * 4);
                (this.gpu as any).trackGpuBufferBytes(4);
                (this.gpu as any).trackGpuBufferBytes(Math.max(16, this.config.maxObjects * 4));
                (this.gpu as any).trackGpuBufferBytes(Math.max(16, this.config.maxObjects * 4));
            }`
);

content = content.replace(
  /if \(this\.gpu\.trackGpuBufferBytes\) \{\n                this\.gpu\.trackGpuBufferBytes\(this\.config\.maxObjects \* 4\);\n            \}/,
  `if ('trackGpuBufferBytes' in this.gpu && typeof this.gpu.trackGpuBufferBytes === 'function') {
                (this.gpu as any).trackGpuBufferBytes(this.config.maxObjects * 4);
            }`
);

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
