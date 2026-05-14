import { createRegularGrid, regularGridValueIndex, type RegularGrid, type RegularGridSpec } from "./regular-grid.js";

export interface DirectionGridSettings {
  readonly angleOffset: number;
}

export function createDirectionGrid(spec: RegularGridSpec, settings: DirectionGridSettings): RegularGrid {
  const grid = createRegularGrid(spec, 2);
  const angle = settings.angleOffset;
  const real = Math.cos(angle);
  const imaginary = Math.sin(angle);

  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      grid.values[regularGridValueIndex(grid, column, row, 0)] = real;
      grid.values[regularGridValueIndex(grid, column, row, 1)] = imaginary;
    }
  }

  return grid;
}