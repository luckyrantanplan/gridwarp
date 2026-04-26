import { 
  applyComplexAffine,
  complex,
  type Complex,
  type ComplexAffinePair,
} from "./complex.js";
import type { AffineGridSpec } from "./affine-field-grid.js";

export class BilinearAffineFieldHandle {
  readonly spec: AffineGridSpec;
  readonly grid: readonly (readonly ComplexAffinePair[])[];

  constructor(spec: AffineGridSpec, grid: readonly (readonly ComplexAffinePair[])[]) {
    this.spec = spec;
    this.grid = grid;
  }

  sample(real: number, imag: number): ComplexAffinePair {
    const clampedReal = clamp(real, this.spec.minReal, this.spec.maxReal);
    const clampedImag = clamp(imag, this.spec.minImag, this.spec.maxImag);
    const normalizedReal = normalizeCoordinate(clampedReal, this.spec.minReal, this.spec.maxReal) * (this.spec.columns - 1);
    const normalizedImag = normalizeCoordinate(clampedImag, this.spec.minImag, this.spec.maxImag) * (this.spec.rows - 1);

    const leftIndex = Math.min(Math.floor(normalizedReal), this.spec.columns - 2);
    const topIndex = Math.min(Math.floor(normalizedImag), this.spec.rows - 2);
    const tx = normalizedReal - leftIndex;
    const ty = normalizedImag - topIndex;

    const topLeft = this.grid[topIndex][leftIndex];
    const topRight = this.grid[topIndex][leftIndex + 1];
    const bottomLeft = this.grid[topIndex + 1][leftIndex];
    const bottomRight = this.grid[topIndex + 1][leftIndex + 1];

    const topA = lerpComplex(topLeft.a, topRight.a, tx);
    const bottomA = lerpComplex(bottomLeft.a, bottomRight.a, tx);
    const topB = lerpComplex(topLeft.b, topRight.b, tx);
    const bottomB = lerpComplex(bottomLeft.b, bottomRight.b, tx);

    return {
      a: lerpComplex(topA, bottomA, ty),
      b: lerpComplex(topB, bottomB, ty),
    };
  }

  transform(point: Complex, real: number, imag: number): Complex {
    return applyComplexAffine(point, this.sample(real, imag));
  }
}

function normalizeCoordinate(value: number, minimum: number, maximum: number): number {
  return (value - minimum) / (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function lerpComplex(start: Complex, end: Complex, amount: number): Complex {
  return complex(
    mix(start.real, end.real, amount),
    mix(start.imag, end.imag, amount),
  );
}

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}