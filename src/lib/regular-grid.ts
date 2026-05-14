import { makePoint2, type Point2 } from "./polygon-geometry.js";
import type { BoundingBox } from "./polygon-shape.js";

export interface RegularGridSpec extends BoundingBox {
  readonly columns: number;
  readonly rows: number;
}

export interface RegularGridResolution {
  readonly samplesPerUnit: number;
}

export interface RegularGrid {
  readonly spec: RegularGridSpec;
  readonly components: number;
  readonly stepX: number;
  readonly stepY: number;
  readonly values: Float64Array;
}

export function createRegularGrid(spec: RegularGridSpec, components: number): RegularGrid {
  validateRegularGridSpec(spec, components);
  return {
    spec,
    components,
    stepX: (spec.maxX - spec.minX) / (spec.columns - 1),
    stepY: (spec.maxY - spec.minY) / (spec.rows - 1),
    values: new Float64Array(spec.columns * spec.rows * components),
  };
}

export function resolveRegularGridSpec(bounds: BoundingBox, resolution: RegularGridResolution): RegularGridSpec {
  validateRegularGridResolution(resolution);
  validateBoundingBox(bounds);
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    columns: resolveAxisSampleCount(bounds.maxX - bounds.minX, resolution.samplesPerUnit),
    rows: resolveAxisSampleCount(bounds.maxY - bounds.minY, resolution.samplesPerUnit),
  };
}

export function regularGridPoint(grid: RegularGrid, column: number, row: number): Point2 {
  return makePoint2(
    grid.spec.minX + column * grid.stepX,
    grid.spec.minY + row * grid.stepY,
  );
}

export function regularGridValueIndex(grid: RegularGrid, column: number, row: number, component: number): number {
  if (!Number.isInteger(component) || component < 0 || component >= grid.components) {
    throw new Error("Grid component index is out of bounds.");
  }
  return ((row * grid.spec.columns) + column) * grid.components + component;
}

export function validateRegularGridSpec(spec: RegularGridSpec, components: number): void {
  if (!Number.isInteger(spec.columns) || spec.columns < 4) {
    throw new Error("Regular grid must have at least four columns.");
  }
  if (!Number.isInteger(spec.rows) || spec.rows < 4) {
    throw new Error("Regular grid must have at least four rows.");
  }
  if (!Number.isInteger(components) || components < 1) {
    throw new Error("Regular grid must have at least one component.");
  }
  validateBoundingBox(spec);
}

export function validateRegularGridResolution(resolution: RegularGridResolution): void {
  if (!Number.isFinite(resolution.samplesPerUnit) || resolution.samplesPerUnit <= 0.0) {
    throw new Error("Regular grid samples per unit must be positive and finite.");
  }
}

function resolveAxisSampleCount(length: number, samplesPerUnit: number): number {
  return Math.max(4, Math.ceil(length * samplesPerUnit) + 1);
}

function validateBoundingBox(bounds: BoundingBox): void {
  if (!(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && bounds.minX < bounds.maxX)) {
    throw new Error("Regular grid x bounds must be finite and strictly increasing.");
  }
  if (!(Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) && bounds.minY < bounds.maxY)) {
    throw new Error("Regular grid y bounds must be finite and strictly increasing.");
  }
}