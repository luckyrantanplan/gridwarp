/**
 * Demo-side helpers for probing visible bounds of a screen-space warp field.
 */
import type { WarpField } from "./types.js";

/**
 * Computes the contour offset limit by sampling the warp on the visible plane diagonal.
 */
export function maxWarpedRadius(width: number, height: number, warp: WarpField): number {
  const { xMax, yMax } = visibleBounds(width, height);
  const planeScale = height / 10;
  let maximum = 0;
  for (let step = 0; step <= 256; step += 1) {
    const t = step / 256;
    const screenX = width * 0.5 + planeScale * t * xMax;
    const screenY = height * 0.5 - planeScale * t * yMax;
    const value = warp.valueAt(screenX, screenY);
    maximum = Math.max(maximum, Math.hypot(value.warpedX, value.warpedY));
  }
  return maximum + 1;
}

function visibleBounds(width: number, height: number): { xMax: number; yMax: number } {
  return {
    xMax: 5 * width / height,
    yMax: 5,
  };
}