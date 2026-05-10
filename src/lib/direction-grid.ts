import { type BoundingBox } from "./polygon-shape.js";
import { createRegularGrid, regularGridPoint, regularGridValueIndex, type RegularGrid, type RegularGridSpec } from "./regular-grid.js";

export interface DirectionGridSettings {
  readonly columns: number;
  readonly rows: number;
  readonly angleOffset: number;
}

export function createDirectionGrid(bounds: BoundingBox, settings: DirectionGridSettings): RegularGrid {
  const spec: RegularGridSpec = {
    columns: settings.columns,
    rows: settings.rows,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
  const grid = createRegularGrid(spec, 2);
  const angle = settings.angleOffset;
  const real = Math.cos(angle);
  const imaginary = Math.sin(angle);

  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      regularGridPoint(grid, column, row);
      grid.values[regularGridValueIndex(grid, column, row, 0)] = real;
      grid.values[regularGridValueIndex(grid, column, row, 1)] = imaginary;
    }
  }

  return grid;
}