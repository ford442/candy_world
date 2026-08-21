const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

// There are duplicates of the offsetBuffer initialization block. I'll remove one.
const doubleBufferBlock = `        if (!this.offsetBuffer && this.gpu.getDevice()) {
            this.offsetBuffer = this.gpu.getDevice()!.createBuffer({
                size: this.config.maxObjects * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                label: 'culling-offsets'
            });
            if ('trackGpuBufferBytes' in this.gpu && typeof (this.gpu as any).trackGpuBufferBytes === 'function') {
                (this.gpu as any).trackGpuBufferBytes(this.config.maxObjects * 4);
            }

            if (this.choresLib && this.indirectBuffer) {
                this.scanBg = this.choresLib.createPrefixSumBindGroup(this.visibleBuffer!, this.offsetBuffer, this.blockSumsBuffer!);
                this.addBg = this.choresLib.createPrefixSumAddBindGroup(this.offsetBuffer, this.blockSumsBuffer!);
                this.compactBg = this.choresLib.createCompactBindGroup(
                    this.visibleBuffer!,
                    this.lodBuffer!,
                    this.offsetBuffer,
                    this.compactIndicesBuffer!,
                    this.compactLodsBuffer!,
                    this.countBuffer!,
                    this.indirectBuffer
                );
            }
        }`;

// Replace 2 instances of the block with 1.
const splitContent = content.split(doubleBufferBlock);
if (splitContent.length > 2) {
    // Rejoin keeping only the first one
    content = splitContent[0] + doubleBufferBlock + splitContent.slice(2).join('');
}

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
