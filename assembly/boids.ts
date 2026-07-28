/**
 * Ambient fauna boids — separation / alignment / cohesion + player avoidance + ground follow.
 * Batch update over a contiguous Float32 slab (8 floats per boid).
 *
 * Layout (stride = 8 f32):
 *   0-2  position xyz
 *   3-5  velocity xyz
 *   6    phase (animation seed)
 *   7    species (0 beetle, 1 hopper, 2 moth)
 */

import { getGroundHeight } from "./math";

const MAX_BOIDS: i32 = 256;
const GRID_DIM: i32 = 32;
const CELL_SIZE: f32 = 8.0;
const WORLD_MIN: f32 = -128.0;
const WORLD_MAX: f32 = 128.0;
const BOID_STRIDE: i32 = 8;

const SEP_RADIUS_SQ: f32 = 4.0;       // 2m
const ALIGN_RADIUS_SQ: f32 = 25.0;    // 5m
const COH_RADIUS_SQ: f32 = 64.0;      // 8m
const PLAYER_AVOID_RADIUS_SQ: f32 = 100.0; // 10m

@lazy
let _gridHeads: Int32Array = new Int32Array(GRID_DIM * GRID_DIM);
@lazy
let _gridNext: Int32Array = new Int32Array(MAX_BOIDS);

function cellIndex(x: f32, z: f32): i32 {
  const cx = i32(Mathf.floor((x - WORLD_MIN) / CELL_SIZE));
  const cz = i32(Mathf.floor((z - WORLD_MIN) / CELL_SIZE));
  if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) return -1;
  return cz * GRID_DIM + cx;
}

function rebuildGrid(boidsPtr: usize, count: i32): void {
  const cells = GRID_DIM * GRID_DIM;
  for (let i = 0; i < cells; i++) {
    _gridHeads[i] = -1;
  }

  for (let i = 0; i < count; i++) {
    const base = boidsPtr + <usize>(i * BOID_STRIDE * 4);
    const x = load<f32>(base);
    const z = load<f32>(base + 8);
    const idx = cellIndex(x, z);
    if (idx < 0) continue;
    _gridNext[i] = _gridHeads[idx];
    _gridHeads[idx] = i;
  }
}

function distSq(ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32): f32 {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  return dx * dx + dy * dy + dz * dz;
}

function maxSpeedForSpecies(species: i32): f32 {
  if (species == 1) return 3.5; // hopper
  if (species == 2) return 2.0; // moth
  return 1.8; // beetle
}

function groundOffsetForSpecies(species: i32): f32 {
  if (species == 1) return 0.22;
  if (species == 2) return 0.0;
  return 0.14;
}

function applyGroundFollow(
  species: i32,
  x: f32,
  z: f32,
  _y: f32,
  time: f32,
  phase: f32
): f32 {
  const ground = getGroundHeight(x, z);
  if (species == 2) {
    // Sugar moth — drift above terrain
    const bob = Mathf.sin(time * 1.2 + phase) * 0.6;
    return ground + 2.5 + bob;
  }
  if (species == 1) {
    // Jellybean hopper — periodic hop
    const hop = Mathf.abs(Mathf.sin(time * 4.0 + phase)) * 0.35;
    return ground + groundOffsetForSpecies(species) + hop;
  }
  return ground + groundOffsetForSpecies(species);
}

/**
 * Advance all boids in-place.
 * @param boidsPtr byte offset into wasm linear memory (Float32 layout)
 * @param count number of boids (max 256)
 * @param dt frame delta seconds
 * @param playerX player X for avoidance
 * @param playerZ player Z for avoidance
 * @param time global time for bob/hop phases
 */
export function updateBoids(
  boidsPtr: usize,
  count: i32,
  dt: f32,
  playerX: f32,
  playerZ: f32,
  time: f32
): void {
  if (count <= 0 || boidsPtr == 0) return;
  const n = count > MAX_BOIDS ? MAX_BOIDS : count;
  const clampedDt = Mathf.max(0.0, Mathf.min(dt, 0.1));

  rebuildGrid(boidsPtr, n);

  for (let i = 0; i < n; i++) {
    const base = boidsPtr + <usize>(i * BOID_STRIDE * 4);
    let x = load<f32>(base);
    let y = load<f32>(base + 4);
    let z = load<f32>(base + 8);
    let vx = load<f32>(base + 12);
    let vy = load<f32>(base + 16);
    let vz = load<f32>(base + 20);
    const phase = load<f32>(base + 24);
    const species = i32(load<f32>(base + 28));

    let sepX: f32 = 0.0;
    let sepY: f32 = 0.0;
    let sepZ: f32 = 0.0;
    let aliX: f32 = 0.0;
    let aliY: f32 = 0.0;
    let aliZ: f32 = 0.0;
    let cohX: f32 = 0.0;
    let cohY: f32 = 0.0;
    let cohZ: f32 = 0.0;
    let aliCount: i32 = 0;
    let cohCount: i32 = 0;

    const homeCell = cellIndex(x, z);
    if (homeCell >= 0) {
      const cx0 = homeCell % GRID_DIM;
      const cz0 = homeCell / GRID_DIM;

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) continue;
          const cell = cz * GRID_DIM + cx;
          let j = _gridHeads[cell];
          while (j >= 0) {
            if (j != i) {
              const ob = boidsPtr + <usize>(j * BOID_STRIDE * 4);
              const ox = load<f32>(ob);
              const oy = load<f32>(ob + 4);
              const oz = load<f32>(ob + 8);
              const ovx = load<f32>(ob + 12);
              const ovy = load<f32>(ob + 16);
              const ovz = load<f32>(ob + 20);
              const d2 = distSq(x, y, z, ox, oy, oz);

              if (d2 < SEP_RADIUS_SQ && d2 > 0.0001) {
                const inv: f32 = 1.0 / d2;
                sepX += (x - ox) * inv;
                sepY += (y - oy) * inv;
                sepZ += (z - oz) * inv;
              }
              if (d2 < ALIGN_RADIUS_SQ) {
                aliX += ovx;
                aliY += ovy;
                aliZ += ovz;
                aliCount++;
              }
              if (d2 < COH_RADIUS_SQ) {
                cohX += ox;
                cohY += oy;
                cohZ += oz;
                cohCount++;
              }
            }
            j = _gridNext[j];
          }
        }
      }
    }

    // Player avoidance
    const pdx = x - playerX;
    const pdz = z - playerZ;
    const pd2 = pdx * pdx + pdz * pdz;
    if (pd2 < PLAYER_AVOID_RADIUS_SQ && pd2 > 0.01) {
      const push: f32 = (1.0 - pd2 / PLAYER_AVOID_RADIUS_SQ) * 4.0;
      sepX += (pdx / pd2) * push;
      sepZ += (pdz / pd2) * push;
    }

    // Wander noise
    const wanderX = Mathf.sin(time * 0.7 + phase * 3.1) * 0.4;
    const wanderZ = Mathf.cos(time * 0.6 + phase * 2.7) * 0.4;

    let ax: f32 = sepX * 2.5 + wanderX;
    let ay: f32 = sepY * 1.0;
    let az: f32 = sepZ * 2.5 + wanderZ;

    if (aliCount > 0) {
      const inv: f32 = 1.0 / <f32>aliCount;
      ax += (aliX * inv - vx) * 0.5;
      ay += (aliY * inv - vy) * 0.3;
      az += (aliZ * inv - vz) * 0.5;
    }
    if (cohCount > 0) {
      const inv: f32 = 1.0 / <f32>cohCount;
      ax += (cohX * inv - x) * 0.15;
      ay += (cohY * inv - y) * 0.05;
      az += (cohZ * inv - z) * 0.15;
    }

    vx += ax * clampedDt;
    vy += ay * clampedDt;
    vz += az * clampedDt;

    const damp: f32 = 0.92;
    vx *= damp;
    vy *= damp;
    vz *= damp;

    const maxSpd = maxSpeedForSpecies(species);
    const spd2 = vx * vx + vy * vy + vz * vz;
    if (spd2 > maxSpd * maxSpd) {
      const scale = maxSpd / Mathf.sqrt(spd2);
      vx *= scale;
      vy *= scale;
      vz *= scale;
    }

    x += vx * clampedDt;
    z += vz * clampedDt;

    // World bounds — soft bounce
    if (x < WORLD_MIN) { x = WORLD_MIN; vx = Mathf.abs(vx); }
    if (x > WORLD_MAX) { x = WORLD_MAX; vx = -Mathf.abs(vx); }
    if (z < WORLD_MIN) { z = WORLD_MIN; vz = Mathf.abs(vz); }
    if (z > WORLD_MAX) { z = WORLD_MAX; vz = -Mathf.abs(vz); }

    y = applyGroundFollow(species, x, z, y, time, phase);
    if (species != 2) {
      vy *= 0.5;
    }

    store<f32>(base, x);
    store<f32>(base + 4, y);
    store<f32>(base + 8, z);
    store<f32>(base + 12, vx);
    store<f32>(base + 16, vy);
    store<f32>(base + 20, vz);
  }
}

/** Bytes required for `count` boids (8 f32 each). */
export function boidsBufferBytes(count: i32): i32 {
  if (count <= 0) return 0;
  const n = count > MAX_BOIDS ? MAX_BOIDS : count;
  return n * BOID_STRIDE * 4;
}
