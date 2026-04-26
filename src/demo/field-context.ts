/**
 * Field evaluation helpers used by Newton projection and contour tracing.
 */
import type { Axis, FieldContext, Point, WarpField } from "./types.js";

/**
 * Exposes scalar field values and gradients derived from the active warp.
 */
export class WarpFieldContext implements FieldContext {
  readonly width: number;
  readonly height: number;

  constructor(private readonly warp: WarpField) {
    const bounds = warp.bounds();
    this.width = bounds.width;
    this.height = bounds.height;
  }

  value(axis: Axis, offset: number, x: number, y: number): number {
    return this.warp.valueAt(clamp(x, 0, this.width), clamp(y, 0, this.height))[axis] - offset;
  }

  gradient(axis: Axis, offset: number, x: number, y: number): Point {
    const jacobian = this.warp.jacobianAt(clamp(x, 0, this.width), clamp(y, 0, this.height));
    return axis === "warpedX"
      ? { x: jacobian.xx, y: jacobian.xy }
      : { x: jacobian.yx, y: jacobian.yy };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}