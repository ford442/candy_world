# 🌳 Tree Shaking Audit Report

**Overall Tree-Shaking Score: 52%**

| Metric | Value |
|--------|-------|
| Total Files | 226 |
| Total Exports | 1559 |
| Unused Exports | 747 (47.9%) |
| Potential Savings | 1.05 MB |

## 📁 Files with Unused Exports

### utils/wasm-loader-core.ts

- **Tree-Shaking Score:** 58%
- **Unused Exports:** 39/93

| Export | Type | Line |
|--------|------|------|
| `sharedF32` | let | 43 |
| `wasmUpdateFoliageBatch` | let | 50 |
| `wasmDampVelocity` | let | 67 |
| `wasmBatchDistanceCalc` | let | 68 |
| `wasmBatchFrustumTest` | let | 69 |
| `wasmBatchLODSelect` | let | 70 |
| `cppBatchShiverSimd` | let | 107 |
| `cppBatchSpringSimd` | let | 108 |
| `cppBatchFloatSimd` | let | 109 |
| `cppBatchCloudBobSimd` | let | 110 |
| ... and 29 more | | |

### workers/worker-types.ts

- **Tree-Shaking Score:** 0%
- **Unused Exports:** 38/38

| Export | Type | Line |
|--------|------|------|
| `PhysicsRequestType` | type | 12 |
| `BasePhysicsRequest` | interface | 18 |
| `GroundHeightRequest` | interface | 23 |
| `CollisionCheckRequest` | interface | 29 |
| `BatchGroundHeightRequest` | interface | 40 |
| `PhysicsRequest` | type | 45 |
| `BasePhysicsResponse` | interface | 52 |
| `GroundHeightResponse` | interface | 59 |
| `CollisionCheckResponse` | interface | 64 |
| `BatchGroundHeightResponse` | interface | 70 |
| ... and 28 more | | |

### utils/wasm-loader-wrapper.ts

- **Tree-Shaking Score:** 32%
- **Unused Exports:** 23/34

| Export | Type | Line |
|--------|------|------|
| `AnimationType` | const | 5 |
| `lerp` | function | 18 |
| `lerpColor` | function | 19 |
| `uploadAnimationData` | function | 27 |
| `batchDistanceCull` | function | 31 |
| `calcBounceY` | function | 43 |
| `calcSwayRotZ` | function | 44 |
| `calcWobble` | function | 45 |
| `checkCollision` | function | 47 |
| `calcAccordionStretch` | function | 50 |
| ... and 13 more | | |

### systems/accessibility.ts

- **Tree-Shaking Score:** 13%
- **Unused Exports:** 21/24

| Export | Type | Line |
|--------|------|------|
| `ColorBlindType` | type | 19 |
| `UIScale` | type | 20 |
| `VerbosityLevel` | type | 21 |
| `CrosshairStyle` | type | 22 |
| `Keybinding` | interface | 24 |
| `InputSettings` | interface | 32 |
| `VisualSettings` | interface | 43 |
| `CognitiveSettings` | interface | 59 |
| `AuditorySettings` | interface | 70 |
| `ScreenReaderSettings` | interface | 83 |
| ... and 11 more | | |

### utils/wasm-animations.ts

- **Tree-Shaking Score:** 5%
- **Unused Exports:** 21/22

| Export | Type | Line |
|--------|------|------|
| `WobbleResult` | interface | 27 |
| `AccordionResult` | interface | 35 |
| `FiberResult` | interface | 43 |
| `ShiverResult` | interface | 51 |
| `SpiralResult` | interface | 59 |
| `PrismResult` | interface | 68 |
| `ArpeggioResult` | interface | 78 |
| `ParticleResult` | interface | 86 |
| `calcBounceY` | function | 118 |
| `calcSwayRotZ` | function | 139 |
| ... and 11 more | | |

### ui/announcer.ts

- **Tree-Shaking Score:** 9%
- **Unused Exports:** 20/22

| Export | Type | Line |
|--------|------|------|
| `AnnouncementPriority` | type | 15 |
| `Announcement` | interface | 17 |
| `AnnouncerOptions` | interface | 24 |
| `GameEventType` | type | 35 |
| `GameEvent` | interface | 47 |
| `Announcer` | class | 125 |
| `getAnnouncer` | function | 517 |
| `initAnnouncer` | function | 524 |
| `announceNow` | function | 539 |
| `announcePolite` | function | 543 |
| ... and 10 more | | |

### foliage/trees.ts

- **Tree-Shaking Score:** 31%
- **Unused Exports:** 18/26

| Export | Type | Line |
|--------|------|------|
| `TreeOptions` | interface | 11 |
| `ShrubOptions` | interface | 15 |
| `VineOptions` | interface | 19 |
| `LeafOptions` | interface | 24 |
| `BubbleWillowOptions` | interface | 28 |
| `HelixPlantOptions` | interface | 32 |
| `BalloonBushOptions` | interface | 36 |
| `AccordionPalmOptions` | interface | 40 |
| `FiberOpticWillowOptions` | interface | 44 |
| `SwingableVineOptions` | interface | 48 |
| ... and 8 more | | |

### utils/wasm-physics.ts

- **Tree-Shaking Score:** 45%
- **Unused Exports:** 18/33

| Export | Type | Line |
|--------|------|------|
| `PlayerStateResult` | interface | 56 |
| `initObstacleUploadBridge` | function | 79 |
| `checkCollision` | function | 377 |
| `valueNoise2D` | function | 488 |
| `fbm` | function | 502 |
| `fastInvSqrt` | function | 519 |
| `fastDistance` | function | 535 |
| `hash` | function | 548 |
| `getGroundHeightBatch` | function | 571 |
| `batchGroundHeight` | function | 637 |
| ... and 8 more | | |

### utils/wasm-batch-animation.ts

- **Tree-Shaking Score:** 27%
- **Unused Exports:** 16/22

| Export | Type | Line |
|--------|------|------|
| `batchShiver_c` | function | 58 |
| `batchSpring_c` | function | 71 |
| `batchFloat_c` | function | 84 |
| `batchCloudBob_c` | function | 97 |
| `deformWave_c` | function | 114 |
| `deformJiggle_c` | function | 127 |
| `deformWobble_c` | function | 140 |
| `batchUpdateLODMatrices_c` | function | 162 |
| `batchScaleMatrices_c` | function | 186 |
| `batchFadeColors_c` | function | 197 |
| ... and 6 more | | |

### particles/compute-integration.ts

- **Tree-Shaking Score:** 29%
- **Unused Exports:** 15/21

| Export | Type | Line |
|--------|------|------|
| `getParticleMetrics` | function | 28 |
| `getAllParticleMetrics` | function | 32 |
| `IntegratedFireflyOptions` | interface | 40 |
| `IntegratedPollenOptions` | interface | 103 |
| `IntegratedSparksOptions` | interface | 164 |
| `IntegratedBerriesOptions` | interface | 171 |
| `IntegratedRainOptions` | interface | 178 |
| `createIntegratedBerries` | function | 247 |
| `disposeIntegratedSystem` | function | 393 |
| `disposeAllIntegratedSystems` | function | 404 |
| ... and 5 more | | |

### systems/region-manager.ts

- **Tree-Shaking Score:** 22%
- **Unused Exports:** 14/18

| Export | Type | Line |
|--------|------|------|
| `CellBounds` | interface | 49 |
| `CellWithBounds` | interface | 59 |
| `RegionConfig` | interface | 64 |
| `RegionStats` | interface | 75 |
| `LODTransition` | interface | 88 |
| `SpatialQueryResult` | interface | 96 |
| `DEFAULT_REGION_CONFIG` | const | 106 |
| `getCellKey` | function | 121 |
| `parseCellKey` | function | 132 |
| `worldToCell` | function | 140 |
| ... and 4 more | | |

### systems/weather.core.ts

- **Tree-Shaking Score:** 7%
- **Unused Exports:** 13/14

| Export | Type | Line |
|--------|------|------|
| `CelestialState` | interface | 18 |
| `SeasonalState` | interface | 26 |
| `LightLevelData` | interface | 32 |
| `FavorabilityData` | interface | 38 |
| `WeatherBias` | interface | 44 |
| `calculateGlobalLightLevel` | function | 56 |
| `calculateFavorability` | function | 76 |
| `calculateMushroomGrowthRate` | function | 104 |
| `calculateWeatherStateTransition` | function | 131 |
| `calculateFogDensity` | function | 196 |
| ... and 3 more | | |

### systems/discovery-persistence.ts

- **Tree-Shaking Score:** 8%
- **Unused Exports:** 12/13

| Export | Type | Line |
|--------|------|------|
| `PersistedDiscovery` | interface | 18 |
| `DiscoveryExport` | interface | 39 |
| `ImportResult` | interface | 62 |
| `DiscoveryStats` | interface | 72 |
| `DiscoveryPersistence` | class | 95 |
| `exportDiscoveries` | function | 676 |
| `importDiscoveries` | function | 685 |
| `clearLocalDiscoveries` | function | 692 |
| `getDiscoveryStats` | function | 699 |
| `isPersistenceAvailable` | function | 706 |
| ... and 2 more | | |

### utils/wasm-batch-math.ts

- **Tree-Shaking Score:** 0%
- **Unused Exports:** 12/12

| Export | Type | Line |
|--------|------|------|
| `batchHslToRgb` | function | 80 |
| `batchSphereCull` | function | 132 |
| `batchLerp` | function | 167 |
| `batchValueNoiseSimd4` | function | 195 |
| `batchFbmSimd4` | function | 234 |
| `batchGroundHeightSimd` | function | 271 |
| `batchValueNoiseOmp` | function | 313 |
| `batchFbmOmp` | function | 352 |
| `batchDistSq3DOmp` | function | 394 |
| `fastSin` | function | 448 |
| ... and 2 more | | |

### compute/gpu-foliage-animator.ts

- **Tree-Shaking Score:** 0%
- **Unused Exports:** 11/11

| Export | Type | Line |
|--------|------|------|
| `FoliageInstanceData` | interface | 29 |
| `FoliageAudioState` | interface | 47 |
| `AnimationType` | enum | 62 |
| `FoliageAnimationOutput` | interface | 81 |
| `FOLIAGE_ANIMATION_WGSL` | const | 117 |
| `GPUFoliageAnimator` | class | 361 |
| `updateInstancedMeshFromAnimator` | function | 687 |
| `createGPUFoliageAnimator` | function | 740 |
| `createFoliageInstanceData` | function | 758 |
| `FoliageAnimatorCapabilities` | interface | 794 |
| ... and 1 more | | |

### foliage/animation-nodes.ts

- **Tree-Shaking Score:** 15%
- **Unused Exports:** 11/13

| Export | Type | Line |
|--------|------|------|
| `gentleSwayNode` | const | 26 |
| `bounceNode` | const | 34 |
| `shiverNode` | const | 41 |
| `springNode` | const | 49 |
| `vineSwayNode` | const | 57 |
| `hopNode` | const | 65 |
| `wobbleNode` | const | 72 |
| `accordionNode` | const | 79 |
| `spiralWaveNode` | const | 86 |
| `fiberWhipNode` | const | 94 |
| ... and 1 more | | |

### particles/particle_config.ts

- **Tree-Shaking Score:** 15%
- **Unused Exports:** 11/13

| Export | Type | Line |
|--------|------|------|
| `ParticleSystemTypeValue` | type | 20 |
| `ParticleBounds` | interface | 25 |
| `ShimmerParticleConfig` | interface | 34 |
| `BubbleStreamConfig` | interface | 52 |
| `PollenCloudConfig` | interface | 68 |
| `LeafConfettiConfig` | interface | 84 |
| `PulseRingConfig` | interface | 100 |
| `ParticleAudioState` | interface | 130 |
| `IParticleSystem` | interface | 160 |
| `ParticleSystemFactory` | type | 183 |
| ... and 1 more | | |

### rendering/materials.ts

- **Tree-Shaking Score:** 21%
- **Unused Exports:** 11/14

| Export | Type | Line |
|--------|------|------|
| `uAudioPulse` | const | 66 |
| `uAudioColor` | const | 72 |
| `createGlowingCandyMaterial` | function | 148 |
| `createPetalMaterial` | function | 185 |
| `createIridescentMaterial` | function | 219 |
| `createJellyMaterial` | function | 234 |
| `createFrostedMaterial` | function | 249 |
| `createSwirledMaterial` | function | 264 |
| `createAudioReactiveMaterial` | function | 286 |
| `createGroundMaterial` | function | 311 |
| ... and 1 more | | |

### rendering/webgpu-limits.ts

- **Tree-Shaking Score:** 15%
- **Unused Exports:** 11/13

| Export | Type | Line |
|--------|------|------|
| `WebGPULimits` | interface | 30 |
| `clearWebGPULimitsCache` | function | 93 |
| `supportsComplexInstancing` | function | 107 |
| `supportsBasicInstancing` | function | 119 |
| `MaterialFallbackOptions` | interface | 127 |
| `simplifyMaterial` | function | 185 |
| `isVertexBufferLimitError` | function | 217 |
| `WebGPUPipelineErrorHandler` | class | 231 |
| `pipelineErrorHandler` | const | 284 |
| `estimateVertexBufferUsage` | function | 290 |
| ... and 1 more | | |

### systems/analytics/types.ts

- **Tree-Shaking Score:** 52%
- **Unused Exports:** 11/23

| Export | Type | Line |
|--------|------|------|
| `AnalyticsConfig` | interface | 14 |
| `EventType` | type | 38 |
| `AnalyticsEvent` | interface | 53 |
| `SessionData` | interface | 67 |
| `FPSHistogram` | interface | 97 |
| `FrameTimePercentiles` | interface | 109 |
| `LoadingPhaseTiming` | interface | 119 |
| `MemorySnapshot` | interface | 129 |
| `GPUTiming` | interface | 141 |
| `AnalyticsExport` | interface | 165 |
| ... and 1 more | | |

## 💡 Recommendations

### 🔴 High Priority

**compute/gpu-foliage-animator.ts**
- Issue: 11 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 27.6 KB

**systems/accessibility.ts**
- Issue: 21 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 26.17 KB

**systems/region-manager.ts**
- Issue: 14 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 25.21 KB

**particles/gpu_particles.ts**
- Issue: 7 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 22.83 KB

**compute/gpu-culling-system.ts**
- Issue: 8 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 22.05 KB

**ui/save-menu/save-menu.ts**
- Issue: 8 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 21.71 KB

**foliage/lod.ts**
- Issue: 7 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 21.61 KB

**compute/gpu-particle-system.ts**
- Issue: 7 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 21.19 KB

**systems/discovery-persistence.ts**
- Issue: 12 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 20.41 KB

**ui/loading-screen.ts**
- Issue: 9 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 20.04 KB

### 🟡 Medium Priority

**compute/gpu-foliage-animator.ts**
- Issue: Low tree-shaking score (0%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 27.6 KB

**systems/accessibility.ts**
- Issue: Low tree-shaking score (13%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 26.17 KB

**systems/region-manager.ts**
- Issue: Low tree-shaking score (22%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 25.21 KB

**ui/analytics-debug.ts**
- Issue: 5 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 24.43 KB

**ui/analytics-debug.ts**
- Issue: Low tree-shaking score (17%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 24.43 KB

**particles/gpu_particles.ts**
- Issue: Low tree-shaking score (0%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 22.83 KB

**compute/gpu-culling-system.ts**
- Issue: Low tree-shaking score (11%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 22.05 KB

**ui/save-menu/save-menu.ts**
- Issue: Low tree-shaking score (27%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 21.71 KB

**foliage/lod.ts**
- Issue: Low tree-shaking score (22%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 21.61 KB

**compute/gpu-particle-system.ts**
- Issue: Low tree-shaking score (22%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 21.19 KB

## 📚 Tree-Shaking Best Practices

1. **Use explicit exports** - Avoid `export * from './module'` when possible
2. **Mark side effects** - Add `"sideEffects": false` to package.json
3. **Avoid barrel files** - Direct imports enable better tree-shaking
4. **Use ES modules** - Ensure all dependencies are ES modules
5. **Check dead code** - Remove unused functions and variables
6. **Dynamic imports** - Use `import()` for code-splitting optional features

