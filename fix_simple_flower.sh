cat src/foliage/simple-flower-batcher.ts | sed -e 's/if (this._gpuPositions && isGpuFoliagePilotEnabled()) {/if (this._gpuPositions) {/g' > tmp.ts
mv tmp.ts src/foliage/simple-flower-batcher.ts
