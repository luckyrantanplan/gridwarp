/**
 * Scalar fields built on top of a screen-space `WarpField`.
 *
 * The contour tracer follows the zero level set of any `ScalarField`. By choosing
 * different `(normal, offset)` pairs, the same machinery draws every grid line
 * (axis-aligned linear combinations of the warp output) and every line / segment
 * defined in the warped output plane (general linear combinations).
 */
import type { Point, ScalarField, ScreenNode, WarpField } from "./types.js";

/**
 * Linear scalar field of the warp output:
 *
 *   f(p) = normal.x · warpedX(p) + normal.y · warpedY(p) − offset
 *
 * The zero level set in screen space is the preimage, under the warp, of the line
 * `normal · X = offset` in warped output space.
 */
export class WarpLinearField implements ScalarField {
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly warp: WarpField,
    private readonly normal: Point,
    private readonly offset: number,
  ) {
    const bounds = warp.bounds();
    this.width = bounds.width;
    this.height = bounds.height;
  }

  value(x: number, y: number): number {
    const cx = clamp(x, 0, this.width);
    const cy = clamp(y, 0, this.height);
    const warped = this.warp.valueAt(cx, cy);
    return this.normal.x * warped.warpedX + this.normal.y * warped.warpedY - this.offset;
  }

  gradient(x: number, y: number): Point {
    const cx = clamp(x, 0, this.width);
    const cy = clamp(y, 0, this.height);
    const j = this.warp.jacobianAt(cx, cy);
    return {
      x: this.normal.x * j.xx + this.normal.y * j.yx,
      y: this.normal.x * j.xy + this.normal.y * j.yy,
    };
  }

  valueAtNode(node: ScreenNode): number {
    return this.normal.x * node.warpedX + this.normal.y * node.warpedY - this.offset;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}