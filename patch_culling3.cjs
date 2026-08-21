const fs = require('fs');
let content = fs.readFileSync('src/compute/gpu-culling-system.ts', 'utf8');

// There are duplicates of the offset buffer block. Let's replace the whole executeCullPass to be sure.
const functionRegex = /executeCullPass\(cameraPosition: \[number, number, number\], viewProjMatrix: Float32Array\): void \{([\s\S]*?)device\.queue\.submit\(\[encoder\.finish\(\)\]\);\n    \}/;

const executeCullPassContent = `executeCullPass(cameraPosition: [number, number, number], viewProjMatrix: Float32Array): void {
        if (!this.gpu.isReady() || !this.isInitialized || this.sphereCount === 0) return;
        const device = this.gpu.getDevice()!;

        // Upload camera data
        if (this.cameraBuffer) {
            // First 16 bytes: viewProjMatrix (we only need the frustum planes, which are calculated on CPU now)
            // But we need camera position for distance-based LOD
            const cameraData = new Float32Array([
                cameraPosition[0], cameraPosition[1], cameraPosition[2], 0, // vec3 pos + pad
            ]);
            this.gpu.writeUniformBuffer(this.cameraBuffer, cameraData);
        }

        const encoder = device.createCommandEncoder({ label: 'culling-encoder' });

        // Frustum cull pass
        const frustumPass = encoder.beginComputePass({ label: 'culling-frustum-pass' });
        frustumPass.setPipeline(this.frustumPipeline!);
        frustumPass.setBindGroup(0, this.frustumBindGroup!);

        // 64 threads per workgroup
        const workgroups = Math.ceil(this.sphereCount / 64);
        frustumPass.dispatchWorkgroups(workgroups);
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
        }

        // LOD select pass - reuse camera buffer with proper uniform layout
        const lodPass = encoder.beginComputePass({ label: 'culling-lod-pass' });
        lodPass.setPipeline(this.lodPipeline!);
        lodPass.setBindGroup(0, this.lodBindGroup!);

        // 256 threads per workgroup for LOD
        lodPass.dispatchWorkgroups(Math.ceil(this.sphereCount / 256));
        lodPass.end();

        // Dispatch chores: Prefix Sum -> Compact
        if (this.choresLib && this.scanBg && this.addBg && this.compactBg) {
            this.choresLib.encodePrefixSum(encoder, this.scanBg, this.addBg, this.sphereCount);
            this.choresLib.encodeCompact(encoder, this.compactBg, this.sphereCount);
        }

        // Submit
        device.queue.submit([encoder.finish()]);
    }`;

content = content.replace(functionRegex, executeCullPassContent);

fs.writeFileSync('src/compute/gpu-culling-system.ts', content);
