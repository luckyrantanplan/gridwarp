import { complex, type Complex, type ComplexAffinePair } from "./complex.js";

export interface AffineGridSpec {
  readonly columns: number;
  readonly rows: number;
  readonly minReal: number;
  readonly maxReal: number;
  readonly minImag: number;
  readonly maxImag: number;
  readonly time: number;
}

export type AffineFieldGrid = ComplexAffinePair[][];
export type AffineFieldSampler = (point: Complex, time: number) => ComplexAffinePair;

export function createAffineFieldGrid(
  spec: AffineGridSpec,
  sampleField: AffineFieldSampler,
): AffineFieldGrid {
  validateAffineGridSpec(spec);
  const grid: AffineFieldGrid = [];

  for (let row = 0; row < spec.rows; row += 1) {
    const imag = coordinateAt(row, spec.rows, spec.minImag, spec.maxImag);
    const gridRow: ComplexAffinePair[] = [];
    for (let column = 0; column < spec.columns; column += 1) {
      const real = coordinateAt(column, spec.columns, spec.minReal, spec.maxReal);
      gridRow.push(sampleField(complex(real, imag), spec.time));
    }
    grid.push(gridRow);
  }

  return grid;
}

export function validateAffineGridSpec(spec: AffineGridSpec): void {
  if (!Number.isInteger(spec.columns) || spec.columns < 2) {
    throw new Error("Affine grid must have at least two columns.");
  }
  if (!Number.isInteger(spec.rows) || spec.rows < 2) {
    throw new Error("Affine grid must have at least two rows.");
  }
  if (!Number.isFinite(spec.time)) {
    throw new Error("Affine grid time must be finite.");
  }
  if (!(Number.isFinite(spec.minReal) && Number.isFinite(spec.maxReal) && spec.minReal < spec.maxReal)) {
    throw new Error("Affine grid real bounds must be finite and strictly increasing.");
  }
  if (!(Number.isFinite(spec.minImag) && Number.isFinite(spec.maxImag) && spec.minImag < spec.maxImag)) {
    throw new Error("Affine grid imaginary bounds must be finite and strictly increasing.");
  }
}

export function validateAffineFieldGridShape(
  spec: AffineGridSpec,
  grid: readonly (readonly ComplexAffinePair[])[],
): void {
  if (grid.length !== spec.rows) {
    throw new Error("Affine field grid row count does not match the specification.");
  }

  for (const row of grid) {
    if (row.length !== spec.columns) {
      throw new Error("Affine field grid column count does not match the specification.");
    }
  }
}

export function coordinateAt(index: number, count: number, minimum: number, maximum: number): number {
  return mix(minimum, maximum, index / (count - 1));
}

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}