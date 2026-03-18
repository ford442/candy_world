# 🌳 Tree Shaking Audit Report

**Overall Tree-Shaking Score: 38%**

| Metric | Value |
|--------|-------|
| Total Files | 123 |
| Total Exports | 842 |
| Unused Exports | 525 (62.4%) |
| Potential Savings | 820.93 KB |

## 📋 common.ts Analysis

| Metric | Value |
|--------|-------|
| Total Exports | 45 |
| Unused Exports | 7 |
| Side Effects | ⚠️ Yes |

### Unused Functions in common.ts

- `generateNoiseTexture`
- `createTexturedClay`
- `createSugaredMaterial`

### Recommendations

- Consider splitting common.ts into smaller modules. 7 unused exports detected.
- common.ts may have side effects. Add "sideEffects": false to package.json for better tree-shaking.
- Remove unused functions: generateNoiseTexture, createTexturedClay, createSugaredMaterial
- Using Three.js imports. Ensure you're importing only needed modules for better tree-shaking.

## 📁 Files with Unused Exports

### foliage/index.ts

- **Tree-Shaking Score:** 4%
- **Unused Exports:** 47/49

| Export | Type | Line |
|--------|------|------|
| `./common.ts` | const | 3 |
| `./berries.ts` | const | 4 |
| `./grass.ts` | const | 5 |
| `./mushrooms.ts` | const | 6 |
| `./flowers.ts` | const | 7 |
| `./trees.ts` | const | 8 |
| `./clouds.ts` | const | 9 |
| `./waterfalls.ts` | const | 10 |
| `./cave.ts` | const | 11 |
| `./environment.ts` | const | 12 |
| ... and 37 more | | |

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

### systems/asset-streaming.ts

- **Tree-Shaking Score:** 13%
- **Unused Exports:** 26/30

| Export | Type | Line |
|--------|------|------|
| `AssetPriority` | enum | 28 |
| `AssetType` | enum | 37 |
| `TextureFormat` | enum | 48 |
| `LoadingState` | enum | 58 |
| `QualityLevel` | enum | 68 |
| `MemoryPressure` | enum | 77 |
| `AssetMetadata` | interface | 86 |
| `AssetManifest` | interface | 103 |
| `LoadedAsset` | interface | 112 |
| `LoadingProgress` | interface | 126 |
| ... and 16 more | | |

### utils/wasm-loader-wrapper.ts

- **Tree-Shaking Score:** 29%
- **Unused Exports:** 24/34

| Export | Type | Line |
|--------|------|------|
| `SpawnCandidate` | type | 3 |
| `AnimationType` | const | 5 |
| `isEmscriptenReady` | function | 14 |
| `lerp` | function | 18 |
| `lerpColor` | function | 19 |
| `batchDistanceCull` | function | 31 |
| `calcBounceY` | function | 43 |
| `calcSwayRotZ` | function | 44 |
| `calcWobble` | function | 45 |
| `checkCollision` | function | 47 |
| ... and 14 more | | |

### particles/compute-particles.ts

- **Tree-Shaking Score:** 15%
- **Unused Exports:** 22/26

| Export | Type | Line |
|--------|------|------|
| `ComputeParticleType` | type | 52 |
| `ComputeParticleConfig` | interface | 54 |
| `ParticleBuffers` | interface | 71 |
| `ParticleAudioData` | interface | 80 |
| `FireflyConfig` | interface | 1357 |
| `PollenConfig` | interface | 1362 |
| `BerryConfig` | interface | 1367 |
| `RainConfig` | interface | 1372 |
| `SparkConfig` | interface | 1377 |
| `createComputeBerries` | function | 1419 |
| ... and 12 more | | |

### ui/announcer.ts

- **Tree-Shaking Score:** 10%
- **Unused Exports:** 19/21

| Export | Type | Line |
|--------|------|------|
| `Announcement` | interface | 17 |
| `AnnouncerOptions` | interface | 24 |
| `GameEventType` | type | 35 |
| `GameEvent` | interface | 47 |
| `Announcer` | class | 125 |
| `getAnnouncer` | function | 517 |
| `initAnnouncer` | function | 524 |
| `announceNow` | function | 539 |
| `announcePolite` | function | 543 |
| `announceDiscovery` | function | 547 |
| ... and 9 more | | |

### systems/analytics.ts

- **Tree-Shaking Score:** 18%
- **Unused Exports:** 18/22

| Export | Type | Line |
|--------|------|------|
| `AnalyticsConfig` | interface | 38 |
| `EventType` | type | 62 |
| `AnalyticsEvent` | interface | 77 |
| `SessionData` | interface | 91 |
| `FPSHistogram` | interface | 121 |
| `FrameTimePercentiles` | interface | 133 |
| `LoadingPhaseTiming` | interface | 143 |
| `MemorySnapshot` | interface | 153 |
| `GPUTiming` | interface | 165 |
| `PerformanceMetrics` | interface | 175 |
| ... and 8 more | | |

### foliage/trees.ts

- **Tree-Shaking Score:** 29%
- **Unused Exports:** 17/24

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
| ... and 7 more | | |

### rendering/culling-system.ts

- **Tree-Shaking Score:** 6%
- **Unused Exports:** 17/18

| Export | Type | Line |
|--------|------|------|
| `CullingGroup` | enum | 25 |
| `EntityType` | enum | 35 |
| `LODLevel` | enum | 49 |
| `QualityTier` | enum | 57 |
| `CullableObject` | interface | 65 |
| `CullingConfig` | interface | 83 |
| `CullingStats` | interface | 109 |
| `DEFAULT_CULL_DISTANCES` | const | 135 |
| `LOD_THRESHOLDS` | const | 149 |
| `QUALITY_MULTIPLIERS` | const | 157 |
| ... and 7 more | | |

### particles/compute-integration.ts

- **Tree-Shaking Score:** 0%
- **Unused Exports:** 15/15

| Export | Type | Line |
|--------|------|------|
| `getParticleMetrics` | function | 28 |
| `getAllParticleMetrics` | function | 32 |
| `IntegratedFireflyOptions` | interface | 40 |
| `createIntegratedFireflies` | function | 50 |
| `IntegratedPollenOptions` | interface | 102 |
| `createIntegratedPollen` | function | 113 |
| `registerIntegratedSystem` | function | 175 |
| `updateAllIntegratedSystems` | function | 201 |
| `disposeIntegratedSystem` | function | 212 |
| `disposeAllIntegratedSystems` | function | 223 |
| ... and 5 more | | |

### systems/accessibility.ts

- **Tree-Shaking Score:** 38%
- **Unused Exports:** 15/24

| Export | Type | Line |
|--------|------|------|
| `Keybinding` | interface | 24 |
| `InputSettings` | interface | 32 |
| `VisualSettings` | interface | 43 |
| `CognitiveSettings` | interface | 59 |
| `AuditorySettings` | interface | 70 |
| `ScreenReaderSettings` | interface | 83 |
| `AccessibilitySettings` | interface | 91 |
| `AccessibilityPreset` | interface | 99 |
| `defaultSettings` | const | 127 |
| `colorBlindMatrices` | const | 189 |
| ... and 5 more | | |

### ui/loading-screen.ts

- **Tree-Shaking Score:** 7%
- **Unused Exports:** 14/15

| Export | Type | Line |
|--------|------|------|
| `LoadingPhase` | interface | 20 |
| `LoadingProgress` | interface | 30 |
| `LoadingScreenOptions` | interface | 40 |
| `DEFAULT_LOADING_PHASES` | const | 52 |
| `LoadingScreen` | class | 116 |
| `initLoadingScreen` | function | 701 |
| `getLoadingScreen` | function | 715 |
| `showLoadingScreen` | function | 722 |
| `hideLoadingScreen` | function | 732 |
| `updateProgress` | function | 739 |
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

### particles/particle_config.ts

- **Tree-Shaking Score:** 8%
- **Unused Exports:** 12/13

| Export | Type | Line |
|--------|------|------|
| `ParticleSystemTypeValue` | type | 20 |
| `ParticleBounds` | interface | 25 |
| `ShimmerParticleConfig` | interface | 34 |
| `BubbleStreamConfig` | interface | 52 |
| `PollenCloudConfig` | interface | 68 |
| `LeafConfettiConfig` | interface | 84 |
| `PulseRingConfig` | interface | 100 |
| `ComputeParticleConfig` | interface | 114 |
| `ParticleAudioState` | interface | 130 |
| `IParticleSystem` | interface | 160 |
| ... and 2 more | | |

### rendering/material_types.ts

- **Tree-Shaking Score:** 8%
- **Unused Exports:** 11/12

| Export | Type | Line |
|--------|------|------|
| `MaterialTypeValue` | type | 24 |
| `CandyMaterialConfig` | interface | 29 |
| `GlowingMaterialConfig` | interface | 47 |
| `PetalMaterialConfig` | interface | 59 |
| `AudioReactiveMaterialConfig` | interface | 69 |
| `GroundMaterialConfig` | interface | 81 |
| `AudioState` | interface | 89 |
| `IAudioReactiveMaterial` | interface | 103 |
| `CandyMaterial` | interface | 111 |
| `AudioUniforms` | interface | 131 |
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

### systems/music-reactivity.core.ts

- **Tree-Shaking Score:** 0%
- **Unused Exports:** 11/11

| Export | Type | Line |
|--------|------|------|
| `ReactivityConfig` | interface | 10 |
| `LightLevelCheck` | interface | 17 |
| `ChannelMapping` | interface | 22 |
| `calculateLightFactor` | function | 42 |
| `calculateChannelIndex` | function | 72 |
| `isObjectVisible` | function | 113 |
| `resolveNoteName` | function | 144 |
| `getNoteColorTyped` | function | 172 |
| `calculateSplitIndex` | function | 217 |
| `shouldCheckTimeBudget` | function | 225 |
| ... and 1 more | | |

### systems/performance-budget.ts

- **Tree-Shaking Score:** 23%
- **Unused Exports:** 10/13

| Export | Type | Line |
|--------|------|------|
| `BudgetMode` | enum | 42 |
| `BudgetType` | type | 54 |
| `BudgetConfig` | interface | 62 |
| `InstanceBudget` | interface | 74 |
| `PerformanceBudgetConfig` | interface | 81 |
| `PerformanceMetrics` | interface | 99 |
| `BudgetViolation` | interface | 109 |
| `AdaptiveSettings` | interface | 120 |
| `DebugOverlayOptions` | interface | 136 |
| `performanceBudget` | const | 1356 |

### rendering/shader-warmup.ts

- **Tree-Shaking Score:** 10%
- **Unused Exports:** 9/10

| Export | Type | Line |
|--------|------|------|
| `WarmupTarget` | type | 27 |
| `WarmupStats` | interface | 36 |
| `WarmupProgressCallback` | type | 47 |
| `ShaderWarmupOptions` | interface | 57 |
| `ShaderWarmup` | class | 191 |
| `warmupShader` | function | 450 |
| `warmupAllShaders` | function | 505 |
| `getWarmupShaderList` | function | 522 |
| `getWarmupPriorityOrder` | function | 533 |

## 💡 Recommendations

### 🔴 High Priority

**systems/asset-streaming.ts**
- Issue: 26 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 45.68 KB

**particles/compute-particles.ts**
- Issue: 22 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 44.88 KB

**rendering/culling-system.ts**
- Issue: 17 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 36.71 KB

**systems/analytics.ts**
- Issue: 18 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 31.62 KB

**systems/performance-budget.ts**
- Issue: 10 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 30.63 KB

**ui/loading-screen.ts**
- Issue: 14 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 24.27 KB

**particles/gpu_particles.ts**
- Issue: 7 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 20.47 KB

**systems/accessibility.ts**
- Issue: 15 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 18.68 KB

**foliage/trees.ts**
- Issue: 17 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 15.51 KB

**ui/announcer.ts**
- Issue: 19 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 15.44 KB

### 🟡 Medium Priority

**systems/asset-streaming.ts**
- Issue: Low tree-shaking score (13%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 45.68 KB

**particles/compute-particles.ts**
- Issue: Low tree-shaking score (15%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 44.88 KB

**ui/accessibility-menu.ts**
- Issue: 5 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 40.07 KB

**rendering/culling-system.ts**
- Issue: Low tree-shaking score (6%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 36.71 KB

**systems/analytics.ts**
- Issue: Low tree-shaking score (18%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 31.62 KB

**systems/performance-budget.ts**
- Issue: Low tree-shaking score (23%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 30.63 KB

**ui/save-menu.ts**
- Issue: 5 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 29.3 KB

**ui/save-menu.ts**
- Issue: Low tree-shaking score (38%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 29.3 KB

**ui/loading-screen.ts**
- Issue: Low tree-shaking score (7%)
- Suggestion: Review export structure. Consider using explicit exports instead of wildcards.
- Potential Savings: 24.27 KB

**ui/analytics-debug.ts**
- Issue: 5 unused exports
- Suggestion: Remove unused exports or split into smaller modules
- Potential Savings: 21.89 KB

## 📚 Tree-Shaking Best Practices

1. **Use explicit exports** - Avoid `export * from './module'` when possible
2. **Mark side effects** - Add `"sideEffects": false` to package.json
3. **Avoid barrel files** - Direct imports enable better tree-shaking
4. **Use ES modules** - Ensure all dependencies are ES modules
5. **Check dead code** - Remove unused functions and variables
6. **Dynamic imports** - Use `import()` for code-splitting optional features

