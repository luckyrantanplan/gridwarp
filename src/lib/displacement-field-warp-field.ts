/**
 * Screen-space warp adapter backed by a sampled polygon displacement field.
 */
import { makePoint2, type Point2 } from "./polygon-geometry.js";
import type { DisplacementField } from "./polygon-displacement-field.js";
import type { Bounds, Jacobian, WarpField, WarpValue } from "./warp-field.js";

interface WeightedSample {
  readonly column: number;
  readonly row: number;
  readonly weight: number;
}

export class DisplacementFieldWarpField implements WarpField {
  private readonly planeScale: number;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly field: DisplacementField,
    private readonly finiteDifferenceEpsilon: number,
  ) {
    this.planeScale = height / 10;
  }

  valueAt(screenX: number, screenY: number): WarpValue {
    const planePoint = this.toPlane(screenX, screenY);
    const displacement = sampleDisplacement(this.field, planePoint);
    return {
      warpedX: planePoint.x + displacement.x,
      warpedY: planePoint.y + displacement.y,
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

  private toPlane(screenX: number, screenY: number): Point2 {
    return makePoint2(
      (screenX - this.width * 0.5) / this.planeScale,
      (this.height * 0.5 - screenY) / this.planeScale,
    );
  }
}

function sampleDisplacement(field: DisplacementField, point: Point2): Point2 {
  if (
    point.x < field.bounds.minX
    || point.x > field.bounds.maxX
    || point.y < field.bounds.minY
    || point.y > field.bounds.maxY
  ) {
    return makePoint2(0, 0);
  }

  const normalizedColumn = (point.x - field.bounds.minX) / field.stepX;
  const normalizedRow = (point.y - field.bounds.minY) / field.stepY;
  const leftColumn = Math.min(Math.floor(normalizedColumn), field.width - 2);
  const topRow = Math.min(Math.floor(normalizedRow), field.height - 2);
  const tx = normalizedColumn - leftColumn;
  const ty = normalizedRow - topRow;

  const samples: WeightedSample[] = [
    { column: leftColumn, row: topRow, weight: (1 - tx) * (1 - ty) },
    { column: leftColumn + 1, row: topRow, weight: tx * (1 - ty) },
    { column: leftColumn, row: topRow + 1, weight: (1 - tx) * ty },
    { column: leftColumn + 1, row: topRow + 1, weight: tx * ty },
  ];

  let displacementX = 0;
  let displacementY = 0;
  for (const sample of samples) {
    const index = fieldIndex(field, sample.column, sample.row);
    if (field.valid[index] === 0) {
      continue;
    }

    displacementX += sample.weight * field.values[2 * index];
    displacementY += sample.weight * field.values[2 * index + 1];
  }

  return makePoint2(displacementX, displacementY);
}

function fieldIndex(field: DisplacementField, column: number, row: number): number {
  return row * field.width + column;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
