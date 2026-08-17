#!/bin/bash
# Apply the previous fixes but to the current codebase

# src/core/main/start-screen.ts
sed -i 's/value: '\''low'\'' }/value: '\''low'\'' as GraphicsLevel }/g' src/core/main/start-screen.ts
sed -i 's/value: '\''medium'\'' }/value: '\''medium'\'' as GraphicsLevel }/g' src/core/main/start-screen.ts
sed -i 's/value: '\''high'\'' }/value: '\''high'\'' as GraphicsLevel }/g' src/core/main/start-screen.ts
sed -i 's/value: '\''small'\'' }/value: '\''small'\'' as MapSize }/g' src/core/main/start-screen.ts
sed -i 's/value: '\''medium'\'' }/value: '\''medium'\'' as MapSize }/g' src/core/main/start-screen.ts
sed -i 's/value: '\''large'\'' }/value: '\''large'\'' as MapSize }/g' src/core/main/start-screen.ts

# src/world/cloud-placer.ts
sed -i 's/\/\/ @ts-expect-error/\/\/ @ts-expect-error - Vite handles import.meta.env, tsc doesn'\''t know it/g' src/world/cloud-placer.ts

# src/core/input/input.ts
sed -i 's/\/\/ @ts-expect-error/\/\/ @ts-expect-error - Vite handles import.meta.env, tsc doesn'\''t know it/g' src/core/input/input.ts

# src/systems/deferred-loader.ts
sed -i 's/recordSpawnAttempt/recordAttempt/g' src/systems/deferred-loader.ts

# src/rendering/shader-warmup.ts
sed -i 's/const previousTarget = renderer.getRenderTarget();/const previousTarget = (renderer as any).getRenderTarget();/g' src/rendering/shader-warmup.ts
sed -i 's/renderer.setRenderTarget(renderTarget);/(renderer as any).setRenderTarget(renderTarget);/g' src/rendering/shader-warmup.ts
sed -i 's/renderer.setRenderTarget(previousTarget);/(renderer as any).setRenderTarget(previousTarget);/g' src/rendering/shader-warmup.ts
sed -i 's/const originalTarget = renderer.getRenderTarget();/const originalTarget = (renderer as any).getRenderTarget();/g' src/rendering/shader-warmup.ts
sed -i 's/renderer.setRenderTarget(originalTarget);/(renderer as any).setRenderTarget(originalTarget);/g' src/rendering/shader-warmup.ts
