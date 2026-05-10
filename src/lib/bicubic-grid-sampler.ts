import type { RegularGrid } from "./regular-grid.js";

interface CellCoordinates {
  readonly column: number;
  readonly row: number;
  readonly tx: number;
  readonly ty: number;
}

export class BicubicGridSampler {
  constructor(private readonly grid: RegularGrid) {}

  evaluateComponent(x: number, y: number, component: number): number {
    validateComponentIndex(this.grid, component);
    const cell = this.cellCoordinates(x, y);
    const rowValues = Array<number>(4);

    for (let stencilRow = 0; stencilRow < 4; stencilRow += 1) {
      const row = cell.row + stencilRow - 1;
      const p0 = sampleGridComponent(this.grid, cell.column - 1, row, component);
      const p1 = sampleGridComponent(this.grid, cell.column, row, component);
      const p2 = sampleGridComponent(this.grid, cell.column + 1, row, component);
      const p3 = sampleGridComponent(this.grid, cell.column + 2, row, component);
      rowValues[stencilRow] = catmullRom(p0, p1, p2, p3, cell.tx);
    }

    return catmullRom(rowValues[0], rowValues[1], rowValues[2], rowValues[3], cell.ty);
  }

  evaluateVector(x: number, y: number): Float64Array {
    const components = new Float64Array(this.grid.components);
    for (let component = 0; component < this.grid.components; component += 1) {
      components[component] = this.evaluateComponent(x, y, component);
    }
    return components;
  }

  private cellCoordinates(x: number, y: number): CellCoordinates {
    const clampedX = clamp(x, this.grid.spec.minX, this.grid.spec.maxX);
    const clampedY = clamp(y, this.grid.spec.minY, this.grid.spec.maxY);
    const normalizedColumn = (clampedX - this.grid.spec.minX) / this.grid.stepX;
    const normalizedRow = (clampedY - this.grid.spec.minY) / this.grid.stepY;
    const column = Math.min(Math.floor(normalizedColumn), this.grid.spec.columns - 2);
    const row = Math.min(Math.floor(normalizedRow), this.grid.spec.rows - 2);

    return {
      column,
      row,
      tx: normalizedColumn - column,
      ty: normalizedRow - row,
    };
  }
}

export function sampleGridComponent(grid: RegularGrid, column: number, row: number, component: number): number {
  validateComponentIndex(grid, component);
  const clampedColumn = clampInteger(column, 0, grid.spec.columns - 1);
  const clampedRow = clampInteger(row, 0, grid.spec.rows - 1);
  return grid.values[((clampedRow * grid.spec.columns + clampedColumn) * grid.components) + component];
}

function validateComponentIndex(grid: RegularGrid, component: number): void {
  if (!Number.isInteger(component) || component < 0 || component >= grid.components) {
    throw new Error("Grid component index is out of bounds.");
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, amount: number): number {
  const tangent1 = 0.5 * (p2 - p0);
  const tangent2 = 0.5 * (p3 - p1);
  const amountSquared = amount * amount;
  const amountCubed = amountSquared * amount;
  return (2.0 * amountCubed - 3.0 * amountSquared + 1.0) * p1
    + (amountCubed - 2.0 * amountSquared + amount) * tangent1
    + (-2.0 * amountCubed + 3.0 * amountSquared) * p2
    + (amountCubed - amountSquared) * tangent2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}