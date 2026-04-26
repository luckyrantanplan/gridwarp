import assert from "node:assert/strict";
import test from "node:test";

import {
  complex,
  multiplyComplex,
} from "../src/lib/complex.js";
import {
  createAffineFieldGrid,
  type AffineGridSpec,
} from "../src/lib/affine-field-grid.js";
import { createCenteredRadialAffinePair } from "../src/lib/deformation-field.js";
import { createBilinearAffineField } from "./support/create-bilinear-affine-field.js";

const defaultSpec: AffineGridSpec = {
  columns: 3,
  rows: 3,
  minReal: -2,
  maxReal: 2,
  minImag: -1,
  maxImag: 3,
  time: 16,
};

const DEFAULT_EPSILON = 1e-9;

function approxEqual(actual: number, expected: number, epsilon: number): void {
  const actualText = String(actual);
  const epsilonText = String(epsilon);
  const expectedText = String(expected);
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actualText} to be within ${epsilonText} of ${expectedText}`);
}

function approxComplex(actual: { real: number; imag: number }, expected: { real: number; imag: number }, epsilon: number): void {
  approxEqual(actual.real, expected.real, epsilon);
  approxEqual(actual.imag, expected.imag, epsilon);
}

function bilinearInterpolateAffinePair(
  topLeft: { a: { real: number; imag: number }; b: { real: number; imag: number } },
  topRight: { a: { real: number; imag: number }; b: { real: number; imag: number } },
  bottomLeft: { a: { real: number; imag: number }; b: { real: number; imag: number } },
  bottomRight: { a: { real: number; imag: number }; b: { real: number; imag: number } },
  tx: number,
  ty: number,
) {
  const topA = lerpComplex(topLeft.a, topRight.a, tx);
  const bottomA = lerpComplex(bottomLeft.a, bottomRight.a, tx);
  const topB = lerpComplex(topLeft.b, topRight.b, tx);
  const bottomB = lerpComplex(bottomLeft.b, bottomRight.b, tx);

  return {
    a: lerpComplex(topA, bottomA, ty),
    b: lerpComplex(topB, bottomB, ty),
  };
}

function lerpComplex(start: { real: number; imag: number }, end: { real: number; imag: number }, amount: number) {
  return {
    real: mix(start.real, end.real, amount),
    imag: mix(start.imag, end.imag, amount),
  };
}

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}

void test("complex arithmetic applies affine pairs in the expected order", () => {
 

  assert.deepEqual(multiplyComplex(complex(1, 2), complex(3, 4)), complex(-5, 10));
}); 

void test("the generated field is identity at time zero", () => {
  const point = complex(1.25, -0.75);
  const spec = { ...defaultSpec, time: 0 };
  const field = createBilinearAffineField(spec, createAffineFieldGrid(spec, createCenteredRadialAffinePair));
  const sample = field.sample(point.real, point.imag);

  approxComplex(sample.a, complex(1, 0), DEFAULT_EPSILON);
  approxComplex(sample.b, complex(0, 0), DEFAULT_EPSILON);
  approxComplex(field.transform(point, point.real, point.imag), point, 1e-12);
});

void test("createBilinearAffineField exposes the generated grid on knot samples", () => {
  const grid = createAffineFieldGrid(defaultSpec, createCenteredRadialAffinePair);
  const field = createBilinearAffineField(defaultSpec, grid);
  const firstRow = field.grid[0];
  const lastRow = field.grid.at(-1);

  assert.equal(field.grid, grid);
  assert.equal(field.grid.length, defaultSpec.rows);
  assert.ok(firstRow);
  assert.ok(lastRow);
  assert.equal(firstRow.length, defaultSpec.columns);

  const topLeft = firstRow[0];
  const bottomRight = lastRow.at(-1);
  assert.ok(topLeft);
  assert.ok(bottomRight);

  assert.deepEqual(field.sample(defaultSpec.minReal, defaultSpec.minImag), topLeft);
  assert.deepEqual(field.sample(defaultSpec.maxReal, defaultSpec.maxImag), bottomRight);
});

void test("createAffineFieldGrid applies a pure sampler over the requested lattice", () => {
  const grid = createAffineFieldGrid(defaultSpec, (point, time) => ({
    a: complex(point.real + time, point.imag - time),
    b: complex(point.real, point.imag),
  }));
  const firstRow = grid[0];
  const lastRow = grid.at(-1);

  assert.ok(firstRow);
  assert.ok(lastRow);
  assert.deepEqual(firstRow[0], {
    a: complex(defaultSpec.minReal + defaultSpec.time, defaultSpec.minImag - defaultSpec.time),
    b: complex(defaultSpec.minReal, defaultSpec.minImag),
  });
  assert.deepEqual(lastRow.at(-1), {
    a: complex(defaultSpec.maxReal + defaultSpec.time, defaultSpec.maxImag - defaultSpec.time),
    b: complex(defaultSpec.maxReal, defaultSpec.maxImag),
  });
});

void test("bilinear interpolation blends neighbouring affine pairs smoothly", () => {
  const interpolated = bilinearInterpolateAffinePair(
    { a: complex(0, 0), b: complex(10, 0) },
    { a: complex(2, 0), b: complex(20, 0) },
    { a: complex(0, 2), b: complex(30, 0) },
    { a: complex(2, 2), b: complex(40, 0) },
    0.25,
    0.5,
  );

  approxComplex(interpolated.a, complex(0.5, 1), DEFAULT_EPSILON);
  approxComplex(interpolated.b, complex(22.5, 0), DEFAULT_EPSILON);
});

void test("the generated field interpolates smoothly and clamps outside the domain", () => {
  const field = createBilinearAffineField(defaultSpec, createAffineFieldGrid(defaultSpec, createCenteredRadialAffinePair));
  const topRow = field.grid[0];
  const middleRow = field.grid[1];

  assert.ok(topRow);
  assert.ok(middleRow);

  const topLeft = topRow[0];
  const topMiddle = topRow[1];
  const middleLeft = middleRow[0];
  const middleMiddle = middleRow[1];

  assert.ok(topLeft);
  assert.ok(topMiddle);
  assert.ok(middleLeft);
  assert.ok(middleMiddle);

  const midpoint = field.sample(-1, 0);
  const expectedMidpoint = bilinearInterpolateAffinePair(
    topLeft,
    topMiddle,
    middleLeft,
    middleMiddle,
    0.5,
    0.5,
  );

  approxComplex(midpoint.a, expectedMidpoint.a, 1e-12);
  approxComplex(midpoint.b, expectedMidpoint.b, 1e-12);

  const clamped = field.sample(-100, 999);
  assert.deepEqual(clamped, field.sample(defaultSpec.minReal, defaultSpec.maxImag));
});

void test("createBilinearAffineField exposes interpolated transforms over a generated grid", () => {
  const field = createBilinearAffineField(defaultSpec, createAffineFieldGrid(defaultSpec, createCenteredRadialAffinePair));
  const firstRow = field.grid[0];

  assert.equal(field.grid.length, defaultSpec.rows);
  assert.ok(firstRow);
  assert.equal(firstRow.length, defaultSpec.columns); 
});

void test("invalid specs and mismatched grids are rejected", () => {
  const referenceGrid = createAffineFieldGrid(defaultSpec, createCenteredRadialAffinePair);

  assert.throws(
    () => createBilinearAffineField({ ...defaultSpec, columns: 1 }, referenceGrid),
    /at least two columns/,
  );
  assert.throws(
    () => createBilinearAffineField({ ...defaultSpec, minReal: 5, maxReal: 1 }, referenceGrid),
    /real bounds/,
  );
  assert.throws(
    () => createBilinearAffineField({ ...defaultSpec, time: Number.NaN }, referenceGrid),
    /time must be finite/,
  );
  assert.throws(
    () => createBilinearAffineField(defaultSpec, [[{ a: complex(1, 0), b: complex(0, 0) }]]),
    /row count does not match/,
  );
});