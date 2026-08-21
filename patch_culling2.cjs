const fs = require('fs');

let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

// There are duplicates somehow? Let's check.
// I will replace all block matching the chores class properties to empty string, and then add it back.
content = content.replace(/\n    \/\/ Chores \(Prefix Sum \+ Compact\)\n    private choresLib: GPUChoresLibrary \| null = null;\n    private offsetBuffer: GPUBuffer \| null = null;\n    private blockSumsBuffer: GPUBuffer \| null = null;\n    private countBuffer: GPUBuffer \| null = null;\n    private compactIndicesBuffer: GPUBuffer \| null = null;\n    private compactLodsBuffer: GPUBuffer \| null = null;\n    private scanBg: GPUBindGroup \| null = null;\n    private addBg: GPUBindGroup \| null = null;\n    private compactBg: GPUBindGroup \| null = null;/g, "");

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

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
