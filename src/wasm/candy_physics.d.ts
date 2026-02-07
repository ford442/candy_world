/** Exported memory */
export declare const memory: WebAssembly.Memory;
// Exported runtime interface
export declare function __new(size: number, id: number): number;
export declare function __pin(ptr: number): number;
export declare function __unpin(ptr: number): void;
export declare function __collect(): void;
export declare const __rtti_base: number;
/** assembly/constants/POSITION_OFFSET */
export declare const POSITION_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/ANIMATION_OFFSET */
export declare const ANIMATION_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/OUTPUT_OFFSET */
export declare const OUTPUT_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/MATERIAL_DATA_OFFSET */
export declare const MATERIAL_DATA_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/PLAYER_STATE_OFFSET */
export declare const PLAYER_STATE_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/MAX_COLLISION_OBJECTS */
export declare const MAX_COLLISION_OBJECTS: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/COLLISION_STRIDE */
export declare const COLLISION_STRIDE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/COLLISION_OFFSET */
export declare const COLLISION_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/GRID_CELL_SIZE */
export declare const GRID_CELL_SIZE: {
  /** @type `f32` */
  get value(): number
};
/** assembly/constants/GRID_COLS */
export declare const GRID_COLS: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/GRID_ROWS */
export declare const GRID_ROWS: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/GRID_ORIGIN_X */
export declare const GRID_ORIGIN_X: {
  /** @type `f32` */
  get value(): number
};
/** assembly/constants/GRID_ORIGIN_Z */
export declare const GRID_ORIGIN_Z: {
  /** @type `f32` */
  get value(): number
};
/** assembly/constants/GRID_HEADS_OFFSET */
export declare const GRID_HEADS_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/** assembly/constants/GRID_NEXT_OFFSET */
export declare const GRID_NEXT_OFFSET: {
  /** @type `i32` */
  get value(): number
};
/**
 * assembly/math/lerp
 * @param a `f32`
 * @param b `f32`
 * @param t `f32`
 * @returns `f32`
 */
export declare function lerp(a: number, b: number, t: number): number;
/**
 * assembly/math/clamp
 * @param value `f32`
 * @param minVal `f32`
 * @param maxVal `f32`
 * @returns `f32`
 */
export declare function clamp(value: number, minVal: number, maxVal: number): number;
/**
 * assembly/math/getGroundHeight
 * @param x `f32`
 * @param z `f32`
 * @returns `f32`
 */
export declare function getGroundHeight(x: number, z: number): number;
/**
 * assembly/math/freqToHue
 * @param freq `f32`
 * @returns `f32`
 */
export declare function freqToHue(freq: number): number;
/**
 * assembly/math/lerpColor
 * @param color1 `u32`
 * @param color2 `u32`
 * @param t `f32`
 * @returns `u32`
 */
export declare function lerpColor(color1: number, color2: number, t: number): number;
/**
 * assembly/memory/getPositionX
 * @param index `i32`
 * @returns `f32`
 */
export declare function getPositionX(index: number): number;
/**
 * assembly/memory/getPositionY
 * @param index `i32`
 * @returns `f32`
 */
export declare function getPositionY(index: number): number;
/**
 * assembly/memory/getPositionZ
 * @param index `i32`
 * @returns `f32`
 */
export declare function getPositionZ(index: number): number;
/**
 * assembly/memory/getPositionRadius
 * @param index `i32`
 * @returns `f32`
 */
export declare function getPositionRadius(index: number): number;
/**
 * assembly/physics/initCollisionSystem
 */
export declare function initCollisionSystem(): void;
/**
 * assembly/physics/addCollisionObject
 * @param type `i32`
 * @param x `f32`
 * @param y `f32`
 * @param z `f32`
 * @param d1 `f32`
 * @param d2 `f32`
 * @param d3 `f32`
 * @param flags `i32`
 */
export declare function addCollisionObject(type: number, x: number, y: number, z: number, d1: number, d2: number, d3: number, flags: number): void;
/**
 * assembly/physics/checkCollision
 * @param playerX `f32`
 * @param playerZ `f32`
 * @param playerRadius `f32`
 * @param objectCount `i32`
 * @returns `i32`
 */
export declare function checkCollision(playerX: number, playerZ: number, playerRadius: number, objectCount: number): number;
/**
 * assembly/physics/checkPositionValidity
 * @param x `f32`
 * @param z `f32`
 * @param radius `f32`
 * @returns `i32`
 */
export declare function checkPositionValidity(x: number, z: number, radius: number): number;
/**
 * assembly/physics/resolveGameCollisions
 * @param kickTrigger `f32`
 * @returns `i32`
 */
export declare function resolveGameCollisions(kickTrigger: number): number;
/**
 * assembly/animation/calcBounceY
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 * @param kick `f32`
 * @returns `f32`
 */
export declare function calcBounceY(time: number, offset: number, intensity: number, kick: number): number;
/**
 * assembly/animation/calcSwayRotZ
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 * @returns `f32`
 */
export declare function calcSwayRotZ(time: number, offset: number, intensity: number): number;
/**
 * assembly/animation/calcWobble
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 */
export declare function calcWobble(time: number, offset: number, intensity: number): void;
/**
 * assembly/animation/getWobbleX
 * @returns `f32`
 */
export declare function getWobbleX(): number;
/**
 * assembly/animation/getWobbleZ
 * @returns `f32`
 */
export declare function getWobbleZ(): number;
/**
 * assembly/animation/calcAccordionStretch
 * @param animTime `f32`
 * @param offset `f32`
 * @param intensity `f32`
 */
export declare function calcAccordionStretch(animTime: number, offset: number, intensity: number): void;
/**
 * assembly/animation/getAccordionStretchY
 * @returns `f32`
 */
export declare function getAccordionStretchY(): number;
/**
 * assembly/animation/getAccordionWidthXZ
 * @returns `f32`
 */
export declare function getAccordionWidthXZ(): number;
/**
 * assembly/animation/calcFiberWhip
 * @param time `f32`
 * @param offset `f32`
 * @param leadVol `f32`
 * @param isActive `i32`
 * @param branchIndex `i32`
 */
export declare function calcFiberWhip(time: number, offset: number, leadVol: number, isActive: number, branchIndex: number): void;
/**
 * assembly/animation/getFiberBaseRotY
 * @returns `f32`
 */
export declare function getFiberBaseRotY(): number;
/**
 * assembly/animation/getFiberBranchRotZ
 * @returns `f32`
 */
export declare function getFiberBranchRotZ(): number;
/**
 * assembly/animation/calcHopY
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 * @param kick `f32`
 * @returns `f32`
 */
export declare function calcHopY(time: number, offset: number, intensity: number, kick: number): number;
/**
 * assembly/animation/calcShiver
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 */
export declare function calcShiver(time: number, offset: number, intensity: number): void;
/**
 * assembly/animation/getShiverRotX
 * @returns `f32`
 */
export declare function getShiverRotX(): number;
/**
 * assembly/animation/getShiverRotZ
 * @returns `f32`
 */
export declare function getShiverRotZ(): number;
/**
 * assembly/animation/calcSpiralWave
 * @param time `f32`
 * @param offset `f32`
 * @param intensity `f32`
 * @param groove `f32`
 */
export declare function calcSpiralWave(time: number, offset: number, intensity: number, groove: number): void;
/**
 * assembly/animation/getSpiralRotY
 * @returns `f32`
 */
export declare function getSpiralRotY(): number;
/**
 * assembly/animation/getSpiralYOffset
 * @returns `f32`
 */
export declare function getSpiralYOffset(): number;
/**
 * assembly/animation/getSpiralScale
 * @returns `f32`
 */
export declare function getSpiralScale(): number;
/**
 * assembly/animation/calcPrismRose
 * @param time `f32`
 * @param offset `f32`
 * @param kick `f32`
 * @param groove `f32`
 * @param isActive `i32`
 */
export declare function calcPrismRose(time: number, offset: number, kick: number, groove: number, isActive: number): void;
/**
 * assembly/animation/getPrismUnfurl
 * @returns `f32`
 */
export declare function getPrismUnfurl(): number;
/**
 * assembly/animation/getPrismSpin
 * @returns `f32`
 */
export declare function getPrismSpin(): number;
/**
 * assembly/animation/getPrismPulse
 * @returns `f32`
 */
export declare function getPrismPulse(): number;
/**
 * assembly/animation/getPrismHue
 * @returns `f32`
 */
export declare function getPrismHue(): number;
/**
 * assembly/animation/calcRainDropY
 * @param startY `f32`
 * @param time `f32`
 * @param speed `f32`
 * @param cycleHeight `f32`
 * @returns `f32`
 */
export declare function calcRainDropY(startY: number, time: number, speed: number, cycleHeight: number): number;
/**
 * assembly/animation/calcFloatingParticle
 * @param baseX `f32`
 * @param baseY `f32`
 * @param baseZ `f32`
 * @param time `f32`
 * @param offset `f32`
 * @param amplitude `f32`
 */
export declare function calcFloatingParticle(baseX: number, baseY: number, baseZ: number, time: number, offset: number, amplitude: number): void;
/**
 * assembly/animation/getParticleX
 * @returns `f32`
 */
export declare function getParticleX(): number;
/**
 * assembly/animation/getParticleY
 * @returns `f32`
 */
export declare function getParticleY(): number;
/**
 * assembly/animation/getParticleZ
 * @returns `f32`
 */
export declare function getParticleZ(): number;
/**
 * assembly/animation/calcFloatingY
 * @param time `f32`
 * @param offset `f32`
 * @param baseHeight `f32`
 * @returns `f32`
 */
export declare function calcFloatingY(time: number, offset: number, baseHeight: number): number;
/**
 * assembly/animation/calcArpeggioStep
 * @param currentUnfurl `f32`
 * @param currentTarget `f32`
 * @param lastTrigger `i32`
 * @param arpeggioActive `i32`
 * @param noteTrigger `i32`
 * @param maxSteps `f32`
 */
export declare function calcArpeggioStep(currentUnfurl: number, currentTarget: number, lastTrigger: number, arpeggioActive: number, noteTrigger: number, maxSteps: number): void;
/**
 * assembly/animation/getArpeggioTargetStep
 * @returns `f32`
 */
export declare function getArpeggioTargetStep(): number;
/**
 * assembly/animation/getArpeggioUnfurlStep
 * @returns `f32`
 */
export declare function getArpeggioUnfurlStep(): number;
/**
 * assembly/animation/updateFoliageBatch
 * @param ptr `usize`
 * @param count `i32`
 * @param time `f32`
 * @param beatPhase `f32`
 * @param kick `f32`
 * @param groove `f32`
 * @param isDay `i32`
 */
export declare function updateFoliageBatch(ptr: number, count: number, time: number, beatPhase: number, kick: number, groove: number, isDay: number): void;
/** assembly/animation_batch/BATCH_SIZE */
export declare const BATCH_SIZE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_GENTLE_SWAY */
export declare const ANIM_TYPE_GENTLE_SWAY: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_BOUNCE */
export declare const ANIM_TYPE_BOUNCE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_WOBBLE */
export declare const ANIM_TYPE_WOBBLE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_HOP */
export declare const ANIM_TYPE_HOP: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SHIVER */
export declare const ANIM_TYPE_SHIVER: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SPRING */
export declare const ANIM_TYPE_SPRING: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_VINE_SWAY */
export declare const ANIM_TYPE_VINE_SWAY: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_FLOAT */
export declare const ANIM_TYPE_FLOAT: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SPIN */
export declare const ANIM_TYPE_SPIN: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_GLOW_PULSE */
export declare const ANIM_TYPE_GLOW_PULSE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_CLOUD_BOB */
export declare const ANIM_TYPE_CLOUD_BOB: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SNARE_SNAP */
export declare const ANIM_TYPE_SNARE_SNAP: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_ACCORDION */
export declare const ANIM_TYPE_ACCORDION: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_FIBER_WHIP */
export declare const ANIM_TYPE_FIBER_WHIP: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SPIRAL_WAVE */
export declare const ANIM_TYPE_SPIRAL_WAVE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_VIBRATO_SHAKE */
export declare const ANIM_TYPE_VIBRATO_SHAKE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_TREMOLO_PULSE */
export declare const ANIM_TYPE_TREMOLO_PULSE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_CYMBAL_SHAKE */
export declare const ANIM_TYPE_CYMBAL_SHAKE: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_PANNING_BOB */
export declare const ANIM_TYPE_PANNING_BOB: {
  /** @type `i32` */
  get value(): number
};
/** assembly/animation_batch/ANIM_TYPE_SPIRIT_FADE */
export declare const ANIM_TYPE_SPIRIT_FADE: {
  /** @type `i32` */
  get value(): number
};
/**
 * assembly/animation_batch/batchSnareSnap
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param snareTrigger `f32`
 * @param outPtr `i32`
 */
export declare function batchSnareSnap(ptr: number, count: number, time: number, snareTrigger: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchAccordion
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param intensity `f32`
 * @param outPtr `i32`
 */
export declare function batchAccordion(ptr: number, count: number, time: number, intensity: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchFiberWhip
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param leadVol `f32`
 * @param isActive `i32`
 * @param outPtr `i32`
 */
export declare function batchFiberWhip(ptr: number, count: number, time: number, leadVol: number, isActive: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchSpiralWave
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param intensity `f32`
 * @param groove `f32`
 * @param outPtr `i32`
 */
export declare function batchSpiralWave(ptr: number, count: number, time: number, intensity: number, groove: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchVibratoShake
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param vibratoAmount `f32`
 * @param intensity `f32`
 * @param outPtr `i32`
 */
export declare function batchVibratoShake(ptr: number, count: number, time: number, vibratoAmount: number, intensity: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchTremoloPulse
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param tremoloAmount `f32`
 * @param intensity `f32`
 * @param outPtr `i32`
 */
export declare function batchTremoloPulse(ptr: number, count: number, time: number, tremoloAmount: number, intensity: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchCymbalShake
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param highFreq `f32`
 * @param intensity `f32`
 * @param outPtr `i32`
 */
export declare function batchCymbalShake(ptr: number, count: number, time: number, highFreq: number, intensity: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchPanningBob
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param panActivity `f32`
 * @param intensity `f32`
 * @param outPtr `i32`
 */
export declare function batchPanningBob(ptr: number, count: number, time: number, panActivity: number, intensity: number, outPtr: number): void;
/**
 * assembly/animation_batch/batchSpiritFade
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param volume `f32`
 * @param delta `f32`
 * @param outPtr `i32`
 */
export declare function batchSpiritFade(ptr: number, count: number, time: number, volume: number, delta: number, outPtr: number): void;
/**
 * assembly/animation_batch/processBatchUniversal
 * @param animType `i32`
 * @param ptr `i32`
 * @param count `i32`
 * @param time `f32`
 * @param beatPhase `f32`
 * @param kick `f32`
 * @param groove `f32`
 * @param audioParam `f32`
 * @param outPtr `i32`
 */
export declare function processBatchUniversal(animType: number, ptr: number, count: number, time: number, beatPhase: number, kick: number, groove: number, audioParam: number, outPtr: number): void;
/** assembly/material_batch/MAX_MATERIALS */
export declare const MAX_MATERIALS: {
  /** @type `i32` */
  get value(): number
};
/**
 * assembly/material_batch/batchMaterialFlash
 * @param count `i32`
 * @param fadeSpeed `f32`
 * @param snapThreshold `f32`
 * @param flashScale `f32`
 * @returns `i32`
 */
export declare function batchMaterialFlash(count: number, fadeSpeed: number, snapThreshold: number, flashScale: number): number;
/**
 * assembly/material_batch/initMaterialEntry
 * @param index `i32`
 * @param currentR `f32`
 * @param currentG `f32`
 * @param currentB `f32`
 * @param baseR `f32`
 * @param baseG `f32`
 * @param baseB `f32`
 * @param isBasicMaterial `i32`
 * @param hasEmissive `i32`
 */
export declare function initMaterialEntry(index: number, currentR: number, currentG: number, currentB: number, baseR: number, baseG: number, baseB: number, isBasicMaterial: number, hasEmissive: number): void;
/**
 * assembly/material_batch/triggerMaterialFlash
 * @param index `i32`
 * @param flashR `f32`
 * @param flashG `f32`
 * @param flashB `f32`
 * @param intensity `f32`
 */
export declare function triggerMaterialFlash(index: number, flashR: number, flashG: number, flashB: number, intensity: number): void;
/**
 * assembly/material_batch/getMaterialResult
 * @param index `i32`
 * @param outPtr `i32`
 */
export declare function getMaterialResult(index: number, outPtr: number): void;
/**
 * assembly/material_batch/materialNeedsFadeBack
 * @param index `i32`
 * @returns `i32`
 */
export declare function materialNeedsFadeBack(index: number): number;
/**
 * assembly/material_batch/getMaterialFlashIntensity
 * @param index `i32`
 * @returns `f32`
 */
export declare function getMaterialFlashIntensity(index: number): number;
/** assembly/discovery/MAX_DISCOVERY_OBJECTS */
export declare const MAX_DISCOVERY_OBJECTS: {
  /** @type `i32` */
  get value(): number
};
/** assembly/discovery/DISCOVERY_RADIUS_SQ */
export declare const DISCOVERY_RADIUS_SQ: {
  /** @type `f32` */
  get value(): number
};
/**
 * assembly/discovery/initDiscoverySystem
 */
export declare function initDiscoverySystem(): void;
/**
 * assembly/discovery/registerDiscoveryObject
 * @param x `f32`
 * @param y `f32`
 * @param z `f32`
 * @param typeId `i32`
 * @returns `i32`
 */
export declare function registerDiscoveryObject(x: number, y: number, z: number, typeId: number): number;
/**
 * assembly/discovery/updateDiscoveryPosition
 * @param id `i32`
 * @param x `f32`
 * @param y `f32`
 * @param z `f32`
 */
export declare function updateDiscoveryPosition(id: number, x: number, y: number, z: number): void;
/**
 * assembly/discovery/checkDiscoverySpatial
 * @param playerX `f32`
 * @param playerY `f32`
 * @param playerZ `f32`
 * @param typeIdFilter `i32`
 * @returns `i32`
 */
export declare function checkDiscoverySpatial(playerX: number, playerY: number, playerZ: number, typeIdFilter: number): number;
/**
 * assembly/discovery/batchDiscoveryCheck
 * @param positionsPtr `i32`
 * @param count `i32`
 * @param resultsPtr `i32`
 */
export declare function batchDiscoveryCheck(positionsPtr: number, count: number, resultsPtr: number): void;
/**
 * assembly/discovery/markDiscovered
 * @param id `i32`
 */
export declare function markDiscovered(id: number): void;
/**
 * assembly/discovery/isObjectDiscovered
 * @param id `i32`
 * @returns `i32`
 */
export declare function isObjectDiscovered(id: number): number;
/**
 * assembly/discovery/getDiscoveryTypeId
 * @param id `i32`
 * @returns `i32`
 */
export declare function getDiscoveryTypeId(id: number): number;
/**
 * assembly/discovery/resetAllDiscoveries
 */
export declare function resetAllDiscoveries(): void;
/**
 * assembly/discovery/getDiscoveryObjectCount
 * @returns `i32`
 */
export declare function getDiscoveryObjectCount(): number;
/**
 * assembly/discovery/getUndiscoveredCount
 * @returns `i32`
 */
export declare function getUndiscoveredCount(): number;
/**
 * assembly/discovery/incrementDiscoveryFrame
 */
export declare function incrementDiscoveryFrame(): void;
/**
 * assembly/batch/analyzeMaterials
 * @param materialPtr `i32`
 * @param count `i32`
 * @returns `i32`
 */
export declare function analyzeMaterials(materialPtr: number, count: number): number;
/**
 * assembly/batch/getUniqueShaderCount
 * @returns `i32`
 */
export declare function getUniqueShaderCount(): number;
/**
 * assembly/batch/batchAnimationCalc
 * @param time `f32`
 * @param intensity `f32`
 * @param kick `f32`
 * @param objectCount `i32`
 */
export declare function batchAnimationCalc(time: number, intensity: number, kick: number, objectCount: number): void;
/**
 * assembly/batch/batchDistanceCull
 * @param cameraX `f32`
 * @param cameraY `f32`
 * @param cameraZ `f32`
 * @param maxDistSq `f32`
 * @param objectCount `i32`
 * @param flagsPtr `i32`
 * @returns `i32`
 */
export declare function batchDistanceCull(cameraX: number, cameraY: number, cameraZ: number, maxDistSq: number, objectCount: number, flagsPtr: number): number;
/**
 * assembly/batch/batchMushroomSpawnCandidates
 * @param time `f32`
 * @param playerX `f32`
 * @param playerZ `f32`
 * @param minDistance `f32`
 * @param maxDistance `f32`
 * @param windSpeed `f32`
 * @param windX `f32`
 * @param windZ `f32`
 * @param objectCount `i32`
 * @param candidateCount `i32`
 * @param spawnThreshold `f32`
 * @returns `i32`
 */
export declare function batchMushroomSpawnCandidates(time: number, playerX: number, playerZ: number, minDistance: number, maxDistance: number, windSpeed: number, windX: number, windZ: number, objectCount: number, candidateCount: number, spawnThreshold: number): number;
/**
 * assembly/foliage/computeSway
 * @param count `i32`
 * @param time `f32`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param outRotZ `usize`
 */
export declare function computeSway(count: number, time: number, offsets: number, intensities: number, outRotZ: number): void;
/**
 * assembly/foliage/computeBounce
 * @param count `i32`
 * @param time `f32`
 * @param originalYs `usize`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param kick `f32`
 * @param outPosY `usize`
 */
export declare function computeBounce(count: number, time: number, originalYs: number, offsets: number, intensities: number, kick: number, outPosY: number): void;
/**
 * assembly/foliage/computeWobble
 * @param count `i32`
 * @param time `f32`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param wobbleBoosts `usize`
 * @param outRotX `usize`
 * @param outRotZ `usize`
 */
export declare function computeWobble(count: number, time: number, offsets: number, intensities: number, wobbleBoosts: number, outRotX: number, outRotZ: number): void;
/**
 * assembly/foliage/computeSpiralWave
 * @param count `i32`
 * @param time `f32`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param childCount `i32`
 * @param outRotY `usize`
 */
export declare function computeSpiralWave(count: number, time: number, offsets: number, intensities: number, childCount: number, outRotY: number): void;
/**
 * assembly/foliage/computeGentleSway
 * @param count `i32`
 * @param time `f32`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param outRotZ `usize`
 */
export declare function computeGentleSway(count: number, time: number, offsets: number, intensities: number, outRotZ: number): void;
/**
 * assembly/foliage/computeHop
 * @param count `i32`
 * @param time `f32`
 * @param originalYs `usize`
 * @param offsets `usize`
 * @param intensities `usize`
 * @param kick `f32`
 * @param outPosY `usize`
 */
export declare function computeHop(count: number, time: number, originalYs: number, offsets: number, intensities: number, kick: number, outPosY: number): void;
/**
 * assembly/particles/updateRainBatch
 * @param positionsPtr `usize`
 * @param velocitiesPtr `usize`
 * @param offsetsPtr `usize`
 * @param count `i32`
 * @param time `f32`
 * @param bassIntensity `f32`
 */
export declare function updateRainBatch(positionsPtr: number, velocitiesPtr: number, offsetsPtr: number, count: number, time: number, bassIntensity: number): void;
/**
 * assembly/particles/updateMelodicMistBatch
 * @param positionsPtr `usize`
 * @param count `i32`
 * @param time `f32`
 * @param melodyVol `f32`
 */
export declare function updateMelodicMistBatch(positionsPtr: number, count: number, time: number, melodyVol: number): void;
