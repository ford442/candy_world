import { POSITION_OFFSET } from "./constants";

export function getPositionX(index: i32): f32 {
  return load<f32>(POSITION_OFFSET + index * 16);
}

export function getPositionY(index: i32): f32 {
  return load<f32>(POSITION_OFFSET + index * 16 + 4);
}

export function getPositionZ(index: i32): f32 {
  return load<f32>(POSITION_OFFSET + index * 16 + 8);
}

export function getPositionRadius(index: i32): f32 {
  return load<f32>(POSITION_OFFSET + index * 16 + 12);
}
