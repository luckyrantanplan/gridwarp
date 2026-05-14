/**
 * Shared contour-tracing types used by the render pipeline.
 */
import type { WarpValue } from "../lib/warp-field.js";

export type { Bounds, Jacobian, WarpField, WarpValue } from "../lib/warp-field.js";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TangentSample extends Point {
  readonly tangent: Point;
}

export interface ScreenNode extends WarpValue {
  readonly screenX: number;
  readonly screenY: number;
}

export interface Cell {
  readonly tl: ScreenNode;
  readonly tr: ScreenNode;
  readonly br: ScreenNode;
  readonly bl: ScreenNode;
}

/**
 * Generic scalar field whose zero level set the contour tracer follows.
 *
 * Implementations expose evaluation at arbitrary screen points (used during Newton
 * projection and tangent following) plus a fast path for a cell corner whose warp
 * value is already cached, used by the marching-squares seeding step.
 */
export interface ScalarField {
  readonly width: number;
  readonly height: number;
  value(x: number, y: number): number;
  gradient(x: number, y: number): Point;
  valueAtNode(node: ScreenNode): number;
}

export interface TracedComponent {
  readonly closed: boolean;
  readonly samples: TangentSample[];
}

export type Axis = keyof WarpValue;
export type Segment = readonly [Point, Point];