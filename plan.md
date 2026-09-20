1. **Optimize GPU readback stalls in `runGpuPlantPose` (`src/compute/gpu-plant-pose.ts`)**:
   - The current implementation creates a new `GPUBuffer`, calls `mapAsync`, and `await`s it every frame, causing a GPU-CPU sync stall and GC spike.
   - I will implement a pipelined readback with persistent ping-pong staging buffers.
   - We will map the current frame's buffer without awaiting, and read from the previous frame's buffer.
   - We must track `prevCount` to avoid reading out of bounds.

2. **Complete pre commit steps**
   - Complete pre commit steps to make sure proper testing, verifications, reviews and reflections are done.

3. **Submit PR**:
   - Submit with title `⚡ Bolt: Pipeline GPU readbacks`.
