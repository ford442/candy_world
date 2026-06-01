async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.assign(Object.create(globalThis), imports.env || {}, {
      abort(message, fileName, lineNumber, columnNumber) {
        // ~lib/builtins/abort(~lib/string/String | null?, ~lib/string/String | null?, u32?, u32?) => void
        message = __liftString(message >>> 0);
        fileName = __liftString(fileName >>> 0);
        lineNumber = lineNumber >>> 0;
        columnNumber = columnNumber >>> 0;
        (() => {
          // @external.js
          throw Error(`${message} in ${fileName}:${lineNumber}:${columnNumber}`);
        })();
      },
      seed() {
        // ~lib/builtins/seed() => f64
        return (() => {
          // @external.js
          return Date.now() * Math.random();
        })();
      },
    }),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    hslToRgb(h, s, l) {
      // assembly/math/hslToRgb(f32, f32, f32) => u32
      return exports.hslToRgb(h, s, l) >>> 0;
    },
    rgbToHsl(r, g, b) {
      // assembly/math/rgbToHsl(f32, f32, f32) => u32
      return exports.rgbToHsl(r, g, b) >>> 0;
    },
    lerpColor(color1, color2, t) {
      // assembly/math/lerpColor(u32, u32, f32) => u32
      return exports.lerpColor(color1, color2, t) >>> 0;
    },
    ecs_createEntity() {
      // assembly/ecs/ecs_createEntity() => u32
      return exports.ecs_createEntity() >>> 0;
    },
    ecs_addComponent(entity, componentName, componentPtr) {
      // assembly/ecs/ecs_addComponent(u32, ~lib/string/String, usize) => void
      componentName = __lowerString(componentName) || __notnull();
      exports.ecs_addComponent(entity, componentName, componentPtr);
    },
    ecs_removeComponent(entity, componentName) {
      // assembly/ecs/ecs_removeComponent(u32, ~lib/string/String) => void
      componentName = __lowerString(componentName) || __notnull();
      exports.ecs_removeComponent(entity, componentName);
    },
    ecs_getComponent(entity, componentName) {
      // assembly/ecs/ecs_getComponent(u32, ~lib/string/String) => usize
      componentName = __lowerString(componentName) || __notnull();
      return exports.ecs_getComponent(entity, componentName) >>> 0;
    },
    ecs_hasComponent(entity, componentName) {
      // assembly/ecs/ecs_hasComponent(u32, ~lib/string/String) => bool
      componentName = __lowerString(componentName) || __notnull();
      return exports.ecs_hasComponent(entity, componentName) != 0;
    },
  }, exports);
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  function __lowerString(value) {
    if (value == null) return 0;
    const
      length = value.length,
      pointer = exports.__new(length << 1, 2) >>> 0,
      memoryU16 = new Uint16Array(memory.buffer);
    for (let i = 0; i < length; ++i) memoryU16[(pointer >>> 1) + i] = value.charCodeAt(i);
    return pointer;
  }
  function __notnull() {
    throw TypeError("value must not be null");
  }
  return adaptedExports;
}
export const {
  memory,
  __new,
  __pin,
  __unpin,
  __collect,
  __rtti_base,
  POSITION_OFFSET,
  ANIMATION_OFFSET,
  OUTPUT_OFFSET,
  MATERIAL_DATA_OFFSET,
  PLAYER_STATE_OFFSET,
  MAX_COLLISION_OBJECTS,
  COLLISION_STRIDE,
  COLLISION_OFFSET,
  GRID_CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  GRID_ORIGIN_X,
  GRID_ORIGIN_Z,
  GRID_HEADS_OFFSET,
  GRID_NEXT_OFFSET,
  MAX_DYNAMIC_PLANTS,
  DYNAMIC_RADII_OFFSET,
  MAX_DISCOVERY_OBJECTS,
  lerp,
  clamp,
  hslToRgb,
  rgbToHsl,
  hash2D,
  valueNoise2D,
  fbm2D,
  distSq2D,
  distSq3D,
  smoothstep,
  smootherstep,
  inverseLerp,
  getGroundHeight,
  freqToHue,
  lerpColor,
  getPositionX,
  getPositionY,
  getPositionZ,
  getPositionRadius,
  initDynamicFoliageMemory,
  initCollisionSystem,
  addCollisionObjectsBatch,
  addCollisionObject,
  checkCollision,
  checkPositionValidity,
  resolveGameCollisions,
  batchGroundHeight,
  dampVelocity,
  batchDistanceCalc,
  batchFrustumTest,
  batchLODSelect,
  calcBounceY,
  calcSwayRotZ,
  calcWobble,
  getWobbleX,
  getWobbleZ,
  calcAccordionStretch,
  getAccordionStretchY,
  getAccordionWidthXZ,
  calcFiberWhip,
  getFiberBaseRotY,
  getFiberBranchRotZ,
  calcHopY,
  calcShiver,
  getShiverRotX,
  getShiverRotZ,
  calcSpiralWave,
  getSpiralRotY,
  getSpiralYOffset,
  getSpiralScale,
  calcPrismRose,
  getPrismUnfurl,
  getPrismSpin,
  getPrismPulse,
  getPrismHue,
  calcRainDropY,
  calcFloatingParticle,
  getParticleX,
  getParticleY,
  getParticleZ,
  calcFloatingY,
  calcArpeggioStep,
  getArpeggioTargetStep,
  getArpeggioUnfurlStep,
  updateFoliageBatch,
  BATCH_SIZE,
  ANIM_TYPE_GENTLE_SWAY,
  ANIM_TYPE_BOUNCE,
  ANIM_TYPE_WOBBLE,
  ANIM_TYPE_HOP,
  ANIM_TYPE_SHIVER,
  ANIM_TYPE_SPRING,
  ANIM_TYPE_VINE_SWAY,
  ANIM_TYPE_FLOAT,
  ANIM_TYPE_SPIN,
  ANIM_TYPE_GLOW_PULSE,
  ANIM_TYPE_CLOUD_BOB,
  ANIM_TYPE_SNARE_SNAP,
  ANIM_TYPE_ACCORDION,
  ANIM_TYPE_FIBER_WHIP,
  ANIM_TYPE_SPIRAL_WAVE,
  ANIM_TYPE_VIBRATO_SHAKE,
  ANIM_TYPE_TREMOLO_PULSE,
  ANIM_TYPE_CYMBAL_SHAKE,
  ANIM_TYPE_PANNING_BOB,
  ANIM_TYPE_SPIRIT_FADE,
  batchSnareSnap,
  batchAccordion,
  batchFiberWhip,
  batchSpiralWave,
  batchVibratoShake,
  batchTremoloPulse,
  batchCymbalShake,
  batchPanningBob,
  batchSpiritFade,
  processBatchUniversal,
  MAX_MATERIALS,
  batchMaterialFlash,
  initMaterialEntry,
  triggerMaterialFlash,
  getMaterialResult,
  materialNeedsFadeBack,
  getMaterialFlashIntensity,
  DISCOVERY_RADIUS_SQ,
  initDiscoverySystem,
  registerDiscoveryObject,
  updateDiscoveryPosition,
  checkDiscoverySpatial,
  batchDiscoveryCheck,
  markDiscovered,
  isObjectDiscovered,
  getDiscoveryTypeId,
  resetAllDiscoveries,
  getDiscoveryObjectCount,
  getUndiscoveredCount,
  incrementDiscoveryFrame,
  analyzeMaterials,
  getUniqueShaderCount,
  batchAnimationCalc,
  batchDistanceCull,
  batchMushroomSpawnCandidates,
  batchHslToRgb,
  batchSphereCull,
  batchLerp,
  computeSway,
  computeBounce,
  computeWobble,
  computeSpiralWave,
  computeGentleSway,
  computeHop,
  smoothWobble,
  batchGrowth,
  batchBloom,
  batchScaleAnimation,
  updateRainBatch,
  updateMelodicMistBatch,
  updateParticles,
  spawnBurst,
  ecs_createEntity,
  ecs_destroyEntity,
  ecs_addComponent,
  ecs_removeComponent,
  ecs_getComponent,
  ecs_hasComponent,
} = await (async url => instantiate(
  await (async () => {
    const isNodeOrBun = typeof process != "undefined" && process.versions != null && (process.versions.node != null || process.versions.bun != null);
    if (isNodeOrBun) { return globalThis.WebAssembly.compile(await (await import("node:fs/promises")).readFile(url)); }
    else { return await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url)); }
  })(), {
  }
))(new URL("candy_physics.wasm", import.meta.url));
