export interface WarpValue {
  readonly warpedX: number;
  readonly warpedY: number;
}

export interface Jacobian {
  readonly xx: number;
  readonly xy: number;
  readonly yx: number;
  readonly yy: number;
}

export interface Bounds {
  readonly width: number;
  readonly height: number;
}

export interface WarpField {
  valueAt(screenX: number, screenY: number): WarpValue;
  jacobianAt(screenX: number, screenY: number): Jacobian;
  bounds(): Bounds;
}