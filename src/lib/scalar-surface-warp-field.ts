import { BicubicGridSampler } from "./bicubic-grid-sampler.js";
import { EPSILON, makePoint2, type Point2 } from "./polygon-geometry.js";
import type { BoundingBox, PolygonShape } from "./polygon-shape.js";
import {
  createWorldScreenTransform,
  worldPointFromScreen,
  type WorldScreenTransform,
} from "./world-screen-transform.js";
import type { Bounds, Jacobian, WarpField, WarpValue } from "./warp-field.js";

export interface AngleDirectedSurfaceWarpSettings {
  readonly finiteDifferenceEpsilon: number;
  readonly amplitudeScale: number;
}

export class AngleDirectedSurfaceWarpField implements WarpField {
  private readonly transform: WorldScreenTransform;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly worldBounds: BoundingBox,
    private readonly polygon: PolygonShape,
    private readonly amplitudeSurface: BicubicGridSampler,
    private readonly directionSurface: BicubicGridSampler,
    private readonly settings: AngleDirectedSurfaceWarpSettings,
  ) {
    validateAngleDirectedSurfaceWarpSettings(settings);
    this.transform = createWorldScreenTransform(width, height, worldBounds);
  }

  valueAt(screenX: number, screenY: number): WarpValue {
    const planePoint = this.toPlane(screenX, screenY);
    const displacement = this.displacementAt(planePoint);
    return {
      warpedX: planePoint.x + displacement.x,
      warpedY: planePoint.y + displacement.y,
    };
  }

  jacobianAt(screenX: number, screenY: number): Jacobian {
    const x0 = clamp(screenX - this.settings.finiteDifferenceEpsilon, 0, this.width);
    const x1 = clamp(screenX + this.settings.finiteDifferenceEpsilon, 0, this.width);
    const y0 = clamp(screenY - this.settings.finiteDifferenceEpsilon, 0, this.height);
    const y1 = clamp(screenY + this.settings.finiteDifferenceEpsilon, 0, this.height);
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

  private displacementAt(point: Point2): Point2 {
    if (this.polygon.distance(point) <= 0.0) {
      return makePoint2(0.0, 0.0);
    }

    const amplitude = this.amplitudeSurface.evaluateComponent(point.x, point.y, 0) * this.settings.amplitudeScale;
    if (amplitude === 0.0) {
      return makePoint2(0.0, 0.0);
    }

    const direction = this.directionSurface.evaluateVector(point.x, point.y);
    const directionLength = Math.hypot(direction[0], direction[1]);
    if (directionLength <= EPSILON) {
      return makePoint2(0.0, 0.0);
    }

    return makePoint2(
      amplitude * direction[0] / directionLength,
      amplitude * direction[1] / directionLength,
    );
  }

  private toPlane(screenX: number, screenY: number): Point2 {
    return worldPointFromScreen(
      clamp(screenX, 0, this.width),
      clamp(screenY, 0, this.height),
      this.transform,
    );
  }
}

function validateAngleDirectedSurfaceWarpSettings(settings: AngleDirectedSurfaceWarpSettings): void {
  if (!Number.isFinite(settings.finiteDifferenceEpsilon) || settings.finiteDifferenceEpsilon <= 0.0) {
    throw new Error("Surface warp finite-difference epsilon must be positive and finite.");
  }
  if (!Number.isFinite(settings.amplitudeScale)) {
    throw new Error("Surface warp amplitude scale must be finite.");
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}