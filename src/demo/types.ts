/**
 * Shared contour-tracing types used by the demo-side pipeline.
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

export interface FieldContext {
  readonly width: number;
  readonly height: number;
  value(axis: Axis, offset: number, x: number, y: number): number;
  gradient(axis: Axis, offset: number, x: number, y: number): Point;
}

export interface TracedComponent {
  readonly closed: boolean;
  readonly samples: TangentSample[];
}

export type Axis = keyof WarpValue;
export type Segment = readonly [Point, Point];