/**
 * Screen-space warp evaluation built on top of the sampled affine field.
 */
import type { AffineGridSpec } from "./affine-field-grid.js";
import { BilinearAffineFieldHandle } from "./bilinear-affine-field-handle.js";
import { complex, type ComplexAffinePair } from "./complex.js";

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

/**
 * Adapts the affine field to viewport coordinates and finite-difference Jacobians.
 */
export class AffineGridWarpField implements WarpField {
  private readonly planeScale: number;
  private readonly handle: BilinearAffineFieldHandle;

  constructor(
    private readonly width: number,
    private readonly height: number,
    spec: AffineGridSpec,
    grid: readonly (readonly ComplexAffinePair[])[],
    private readonly finiteDifferenceEpsilon: number,
  ) {
    this.planeScale = height / 10;
    this.handle = new BilinearAffineFieldHandle(spec, grid);
  }

  valueAt(screenX: number, screenY: number): WarpValue {
    const planePoint = this.toPlane(screenX, screenY);
    const warped = this.handle.transform(complex(planePoint.real, planePoint.imag), planePoint.real, planePoint.imag);
    return {
      warpedX: warped.real,
      warpedY: warped.imag,
    };
  }

  jacobianAt(screenX: number, screenY: number): Jacobian {
    const x0 = clamp(screenX - this.finiteDifferenceEpsilon, 0, this.width);
    const x1 = clamp(screenX + this.finiteDifferenceEpsilon, 0, this.width);
    const y0 = clamp(screenY - this.finiteDifferenceEpsilon, 0, this.height);
    const y1 = clamp(screenY + this.finiteDifferenceEpsilon, 0, this.height);
    const sx1 = this.valueAt(x1, screenY);
    const sx0 = this.valueAt(x0, screenY);
    const sy1 = this.valueAt(screenX, y1);
    const sy0 = this.valueAt(screenX, y0);
    const dx = Math.max(1e-6, x1 - x0);
    const dy = Math.max(1e-6, y1 - y0);
    return {
      xx: (sx1.warpedX - sx0.warpedX) / dx,
      xy: (sy1.warpedX - sy0.warpedX) / dy,
      yx: (sx1.warpedY - sx0.warpedY) / dx,
      yy: (sy1.warpedY - sy0.warpedY) / dy,
    };
  }

  bounds(): Bounds {
    return { width: this.width, height: this.height };
  }

  private toPlane(screenX: number, screenY: number): { readonly real: number; readonly imag: number } {
    return {
      real: (screenX - this.width * 0.5) / this.planeScale,
      imag: (this.height * 0.5 - screenY) / this.planeScale,
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}