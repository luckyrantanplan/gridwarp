import { type BoundingBox, type PolygonShape } from "./polygon-shape.js";
import {
  createRegularGrid,
  regularGridPoint,
  regularGridValueIndex,
  validateRegularGridSpec,
  type RegularGrid,
  type RegularGridSpec,
} from "./regular-grid.js";
import { satur } from "./saturation.js";

export type ScalarGridSpec = RegularGridSpec;

export interface PolygonScalarSurfaceSettings {
  readonly columns: number;
  readonly rows: number;
  readonly padding: number;
  readonly gain: number;
  readonly plateau: number;
}

export type ScalarGrid = RegularGrid;

export function createPolygonScalarGrid(
  polygon: PolygonShape,
  settings: PolygonScalarSurfaceSettings,
): ScalarGrid {
  validatePolygonScalarSurfaceSettings(settings);
  const polygonBounds = polygon.min_ortho_rectangle();
  const bounds = expandBoundingBox(polygonBounds, settings.padding);
  const spec: ScalarGridSpec = {
    columns: settings.columns,
    rows: settings.rows,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
  const grid = createScalarGrid(spec);
  const interiorScale = Math.max(polygon.max_interior_distance(), 1.0e-8);

  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      const point = gridPoint(grid, column, row);
      const distance = polygon.distance(point);
      const noise = noise2D(point.x, point.y);
      const weightedValue = (distance / interiorScale) * noise * settings.gain;
      grid.values[scalarGridIndex(grid, column, row)] = satur(weightedValue, settings.plateau);
    }
  }

  return grid;
}

export function createScalarGrid(spec: ScalarGridSpec): ScalarGrid {
  validateScalarGridSpec(spec);
  return createRegularGrid(spec, 1);
}

export function scalarGridIndex(grid: ScalarGrid, column: number, row: number): number {
  return regularGridValueIndex(grid, column, row, 0);
}

export function gridPoint(grid: ScalarGrid, column: number, row: number) {
  return regularGridPoint(grid, column, row);
}

export function countNonZeroSamples(grid: ScalarGrid): number {
  let sampleCount = 0;
  for (const value of grid.values) {
    if (value !== 0.0) {
      sampleCount += 1;
    }
  }
  return sampleCount;
}

function noise2D(noiseX: number, noiseY: number): number {
  void noiseX;
  void noiseY;
  return 0.35;
}

function expandBoundingBox(bounds: BoundingBox, padding: number): BoundingBox {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
  };
}

function validatePolygonScalarSurfaceSettings(settings: PolygonScalarSurfaceSettings): void {
  if (!Number.isFinite(settings.padding) || settings.padding < 0.0) {
    throw new Error("Scalar surface padding must be non-negative and finite.");
  }
  if (!Number.isFinite(settings.gain) || settings.gain <= 0.0) {
    throw new Error("Scalar surface gain must be positive and finite.");
  }
  if (!Number.isFinite(settings.plateau) || settings.plateau <= 0.0) {
    throw new Error("Scalar surface plateau must be positive and finite.");
  }
  validateScalarGridSpec({
    columns: settings.columns,
    rows: settings.rows,
    minX: 0.0,
    minY: 0.0,
    maxX: 1.0,
    maxY: 1.0,
  });
}

function validateScalarGridSpec(spec: ScalarGridSpec): void {
  validateRegularGridSpec(spec, 1);
}