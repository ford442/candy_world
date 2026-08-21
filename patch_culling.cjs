const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

// The original file doesn't have initPipelines or initBuffers, it just creates them inside initialize()
// We need to inject the chores stuff at the end of initialize()

content = content.replace(
  /this\.isInitialized = true;\n        console\.log\(\`\[GPUCullingSystem\] Initialized for \$\{this\.config\.maxObjects\} objects\`\);\n    \}/,
  `
        const d = this.gpu.getDevice() as unknown as GPUDevice;
        if (d) {
            this.choresLib = new GPUChoresLibrary(d);
            await this.choresLib.initialize();

            const blocksCount = Math.ceil(this.config.maxObjects / 256);
            this.blockSumsBuffer = d.createBuffer({
                size: blocksCount * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                label: 'culling-block-sums'
            });

            this.countBuffer = d.createBuffer({
                size: 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                label: 'culling-count'
            });

            this.compactIndicesBuffer = d.createBuffer({
                size: Math.max(16, this.config.maxObjects * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                label: 'culling-compact-indices'
            });

            this.compactLodsBuffer = d.createBuffer({
                size: Math.max(16, this.config.maxObjects * 4),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                label: 'culling-compact-lods'
            });

            if ('trackGpuBufferBytes' in this.gpu && typeof (this.gpu as any).trackGpuBufferBytes === 'function') {
                (this.gpu as any).trackGpuBufferBytes(blocksCount * 4);
                (this.gpu as any).trackGpuBufferBytes(4);
                (this.gpu as any).trackGpuBufferBytes(Math.max(16, this.config.maxObjects * 4));
                (this.gpu as any).trackGpuBufferBytes(Math.max(16, this.config.maxObjects * 4));
            }
        }

        this.isInitialized = true;
        console.log(\`[GPUCullingSystem] Initialized for \${this.config.maxObjects} objects\`);
    }`
);

// We still need to replace imports and add chores state to the class
content = content.replace(
  /import \{ FRUSTUM_CULL_WGSL, LOD_SELECT_WGSL \} from '\.\/gpu-compute-shaders';/,
  `import { FRUSTUM_CULL_WGSL, LOD_SELECT_WGSL } from './gpu-compute-shaders.js';\nimport { GPUChoresLibrary } from './chores/gpu-chores.js';`
);

content = content.replace(
  /import \{ GPUComputeLibrary \} from '\.\/gpu-compute-library';/,
  `import { GPUComputeLibrary, GPUDevice } from './gpu-compute-library.js';`
);

content = content.replace(
  /private frustumBindGroup: GPUBindGroup \| null = null;\n    private lodBindGroup: GPUBindGroup \| null = null;/,
  `private frustumBindGroup: GPUBindGroup | null = null;
    private lodBindGroup: GPUBindGroup | null = null;

    // Chores (Prefix Sum + Compact)
    private choresLib: GPUChoresLibrary | null = null;
    private offsetBuffer: GPUBuffer | null = null;
    private blockSumsBuffer: GPUBuffer | null = null;
    private countBuffer: GPUBuffer | null = null;
    private compactIndicesBuffer: GPUBuffer | null = null;
    private compactLodsBuffer: GPUBuffer | null = null;
    private scanBg: GPUBindGroup | null = null;
    private addBg: GPUBindGroup | null = null;
    private compactBg: GPUBindGroup | null = null;`
);

// We need to inject the offsetBuffer creation inside executeCullPass
content = content.replace(
  /frustumPass\.dispatchWorkgroups\(workgroups\);\n        frustumPass\.end\(\);/,
  `frustumPass.dispatchWorkgroups(workgroups);
        frustumPass.end();

        if (!this.offsetBuffer && this.gpu.getDevice()) {
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
        }`
);

// Chores Dispatch
content = content.replace(
  /lodPass\.dispatchWorkgroups\(Math\.ceil\(this\.sphereCount \/ 256\)\);\n        lodPass\.end\(\);\n\n        \/\/ Submit/,
  `lodPass.dispatchWorkgroups(Math.ceil(this.sphereCount / 256));
        lodPass.end();

        // Dispatch chores: Prefix Sum -> Compact
        if (this.choresLib && this.scanBg && this.addBg && this.compactBg) {
            this.choresLib.encodePrefixSum(encoder, this.scanBg, this.addBg, this.sphereCount);
            this.choresLib.encodeCompact(encoder, this.compactBg, this.sphereCount);
        }

        // Submit`
);

// Readback results via compact buffers
content = content.replace(
  /const \[visibleData, lodData\] = await Promise\.all\(\[\n            this\.gpu\.readBufferU32\(this\.visibleBuffer, this\.sphereCount \* 4\),\n            this\.gpu\.readBufferU32\(this\.lodBuffer, this\.sphereCount \* 4\),\n        \]\);\n\n        \/\/ Compact results to only visible objects\n        const visible: number\[\] = \[\];\n        const lods: number\[\] = \[\];\n\n        for \(let i = 0; i < this\.sphereCount; i\+\+\) {\n            if \(visibleData\[i\] === 1\) {\n                visible\.push\(i\);\n                lods\.push\(lodData\[i\]\);\n            }\n        }\n\n        return \{\n            visibleIndices: new Uint32Array\(visible\),\n            lodLevels: new Uint32Array\(lods\),\n            visibleCount: visible\.length,\n        \};/,
  `const countArray = await this.gpu.readBufferU32(this.countBuffer!, 4);
        const visibleCount = countArray[0];

        let visibleIndicesData = new Uint32Array(0);
        let lodLevelsData = new Uint32Array(0);

        if (visibleCount > 0) {
            const [vData, lData] = await Promise.all([
                this.gpu.readBufferU32(this.compactIndicesBuffer!, visibleCount * 4),
                this.gpu.readBufferU32(this.compactLodsBuffer!, visibleCount * 4),
            ]);
            visibleIndicesData = vData as unknown as Uint32Array;
            lodLevelsData = lData as unknown as Uint32Array;
        }

        return {
            visibleIndices: visibleIndicesData as unknown as Uint32Array,
            lodLevels: lodLevelsData as unknown as Uint32Array,
            visibleCount: visibleCount,
        };`
);

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
