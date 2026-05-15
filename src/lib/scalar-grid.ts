import {
  createRegularGrid,
  regularGridPoint,
  regularGridValueIndex,
  validateRegularGridSpec,
  type RegularGrid,
  type RegularGridResolution,
  type RegularGridSpec,
} from "./regular-grid.js";

export type ScalarGridSpec = RegularGridSpec;
export type ScalarGridResolution = RegularGridResolution;

export type ScalarGrid = RegularGrid;

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

function validateScalarGridSpec(spec: ScalarGridSpec): void {
  validateRegularGridSpec(spec, 1);
}