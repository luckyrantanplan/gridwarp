/**
 * Demo-side helpers for building and probing the dual-spiral octagon-masked warp field.
 */
import {
  createAffineFieldGrid,
  type AffineGridSpec,
} from "../lib/affine-field-grid.js";
import { createDualSpiralOctagonAffinePair } from "../lib/deformation-field.js";
import { AffineGridWarpField } from "../lib/warp-field.js";
import type { WarpField } from "./types.js";

/**
 * Creates the screen-space warp field used by the demo from the dual-spiral deformation.
 */
export function createDualSpiralWarpField(
  width: number,
  height: number,
  time: number,
  columns: number,
  rows: number,
  finiteDifferenceEpsilon: number,
): WarpField {
  const { xMax, yMax } = visibleBounds(width, height);
  const spec: AffineGridSpec = {
    columns,
    rows,
    minReal: -xMax,
    maxReal: xMax,
    minImag: -yMax,
    maxImag: yMax,
    time,
  };
  const affineFieldGrid = createAffineFieldGrid(spec, createDualSpiralOctagonAffinePair);
  return new AffineGridWarpField(width, height, spec, affineFieldGrid, finiteDifferenceEpsilon);
}

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