export interface Complex {
  readonly real: number;
  readonly imag: number;
}

export interface ComplexAffinePair {
  readonly a: Complex;
  readonly b: Complex;
}

export interface AffineGridSpec {
  readonly columns: number;
  readonly rows: number;
  readonly minReal: number;
  readonly maxReal: number;
  readonly minImag: number;
  readonly maxImag: number;
  readonly time: number;
}

export interface AffineGridHandle {
  readonly grid: readonly (readonly ComplexAffinePair[])[];
  readonly spec: AffineGridSpec;
  sample(real: number, imag: number): ComplexAffinePair;
  transform(point: Complex, real: number, imag: number): Complex;
}

export function complex(real: number, imag: number): Complex {
  return { real, imag };
}

export function addComplex(left: Complex, right: Complex): Complex {
  return complex(left.real + right.real, left.imag + right.imag);
}

export function multiplyComplex(left: Complex, right: Complex): Complex {
  return complex(
    left.real * right.real - left.imag * right.imag,
    left.real * right.imag + left.imag * right.real,
  );
}

export function scaleComplex(value: Complex, factor: number): Complex {
  return complex(value.real * factor, value.imag * factor);
}

export function lerpComplex(start: Complex, end: Complex, amount: number): Complex {
  return complex(
    mix(start.real, end.real, amount),
    mix(start.imag, end.imag, amount),
  );
}

export function applyComplexAffine(point: Complex, pair: ComplexAffinePair): Complex {
  return addComplex(multiplyComplex(pair.a, point), pair.b);
}

export function createCenteredRadialAffinePair(point: Complex, time: number): ComplexAffinePair {
  const radius = Math.hypot(point.real, point.imag);
  const centerWeight = Math.exp(-0.16 * radius * radius);
  const curl = time * (0.0022 + 0.01 * centerWeight);
  const inwardPull = time * (0.015 + 0.075 * centerWeight);
  const angle = curl * centerWeight;
  const scale = smoothMin(3.0, 1.0 + inwardPull * centerWeight, 0.2);

  return {
    a: complex(scale * Math.cos(angle), scale * Math.sin(angle)),
    b: complex(0.0, 0.0),
  };
}

export function evaluateCenteredRadialWarp(point: Complex, time: number): Complex {
  return applyComplexAffine(point, createCenteredRadialAffinePair(point, time));
}

export function createAffineGrid(spec: AffineGridSpec): ComplexAffinePair[][] {
  validateAffineGridSpec(spec);

  const grid: ComplexAffinePair[][] = [];
  for (let row = 0; row < spec.rows; row += 1) {
    const imag = coordinateAt(row, spec.rows, spec.minImag, spec.maxImag);
    const gridRow: ComplexAffinePair[] = [];
    for (let column = 0; column < spec.columns; column += 1) {
      const real = coordinateAt(column, spec.columns, spec.minReal, spec.maxReal);
      gridRow.push(createCenteredRadialAffinePair(complex(real, imag), spec.time));
    }
    grid.push(gridRow);
  }

  return grid;
}

export function createAffineGridHandle(
  spec: AffineGridSpec,
  grid: readonly (readonly ComplexAffinePair[])[],
): AffineGridHandle {
  validateAffineGridSpec(spec);
  validateGridShape(spec, grid);

  return {
    grid,
    spec,
    sample(real: number, imag: number): ComplexAffinePair {
      const clampedReal = clamp(real, spec.minReal, spec.maxReal);
      const clampedImag = clamp(imag, spec.minImag, spec.maxImag);
      const normalizedReal = normalizeCoordinate(clampedReal, spec.minReal, spec.maxReal) * (spec.columns - 1);
      const normalizedImag = normalizeCoordinate(clampedImag, spec.minImag, spec.maxImag) * (spec.rows - 1);

      const leftIndex = Math.min(Math.floor(normalizedReal), spec.columns - 2);
      const topIndex = Math.min(Math.floor(normalizedImag), spec.rows - 2);
      const tx = normalizedReal - leftIndex;
      const ty = normalizedImag - topIndex;

      const topLeft = getGridCell(grid, topIndex, leftIndex);
      const topRight = getGridCell(grid, topIndex, leftIndex + 1);
      const bottomLeft = getGridCell(grid, topIndex + 1, leftIndex);
      const bottomRight = getGridCell(grid, topIndex + 1, leftIndex + 1);

      return bilinearInterpolateAffinePair(topLeft, topRight, bottomLeft, bottomRight, tx, ty);
    },
    transform(point: Complex, real: number, imag: number): Complex {
      return applyComplexAffine(point, this.sample(real, imag));
    },
  };
}

export function createBilinearAffineField(spec: AffineGridSpec): AffineGridHandle {
  const grid = createAffineGrid(spec);
  return createAffineGridHandle(spec, grid);
}

export function bilinearInterpolateAffinePair(
  topLeft: ComplexAffinePair,
  topRight: ComplexAffinePair,
  bottomLeft: ComplexAffinePair,
  bottomRight: ComplexAffinePair,
  tx: number,
  ty: number,
): ComplexAffinePair {
  const topA = lerpComplex(topLeft.a, topRight.a, tx);
  const bottomA = lerpComplex(bottomLeft.a, bottomRight.a, tx);
  const topB = lerpComplex(topLeft.b, topRight.b, tx);
  const bottomB = lerpComplex(bottomLeft.b, bottomRight.b, tx);

  return {
    a: lerpComplex(topA, bottomA, ty),
    b: lerpComplex(topB, bottomB, ty),
  };
}

function validateAffineGridSpec(spec: AffineGridSpec): void {
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

function validateGridShape(
  spec: AffineGridSpec,
  grid: readonly (readonly ComplexAffinePair[])[],
): void {
  if (grid.length !== spec.rows) {
    throw new Error("Affine grid row count does not match the specification.");
  }

  for (const row of grid) {
    if (row.length !== spec.columns) {
      throw new Error("Affine grid column count does not match the specification.");
    }
  }
}

function getGridCell(
  grid: readonly (readonly ComplexAffinePair[])[],
  row: number,
  column: number,
): ComplexAffinePair {
  return grid[row][column];
}

function coordinateAt(index: number, count: number, minimum: number, maximum: number): number {
  return mix(minimum, maximum, index / (count - 1));
}

function normalizeCoordinate(value: number, minimum: number, maximum: number): number {
  return (value - minimum) / (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
  return normalized * normalized * normalized * (normalized * (normalized * 6.0 - 15.0) + 10.0);
}

function smoothMin(a: number, b: number, softness: number): number {
  const h = smootherstep(-softness, softness, b - a);
  return mix(b, a, h);
}