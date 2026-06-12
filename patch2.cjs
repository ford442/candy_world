const fs = require('fs');
let text = fs.readFileSync('src/utils/startup-profiler.ts', 'utf8');

text = text.replace(
`        device.createShaderModule = (desc: GPUShaderModuleDescriptor) => {
          if (isEnabled) {
            const start = performance.now();
            const result = originalCreateShaderModule.call(device, desc);
            const end = performance.now();
            webgpuMetrics.shaderCompilations++;
            webgpuMetrics.shaderCompileTime += (end - start);
          }
          return result;
        };`,
`        device.createShaderModule = (desc: GPUShaderModuleDescriptor) => {
          if (isEnabled) {
            const start = performance.now();
            const result = originalCreateShaderModule.call(device, desc);
            const end = performance.now();
            webgpuMetrics.shaderCompilations++;
            webgpuMetrics.shaderCompileTime += (end - start);
            return result;
          }
          return originalCreateShaderModule.call(device, desc);
        };`
);

fs.writeFileSync('src/utils/startup-profiler.ts', text);
