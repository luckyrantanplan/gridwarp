/**
 * Complex-number primitives shared by the warp definition, field sampling, and tests.
 */
export interface Complex {
  readonly real: number;
  readonly imag: number;
}

export interface ComplexAffinePair {
  readonly a: Complex;
  readonly b: Complex;
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

export function applyComplexAffine(point: Complex, pair: ComplexAffinePair): Complex {
  return addComplex(multiplyComplex(pair.a, point), pair.b);
}



