import assert from "node:assert/strict";
import test from "node:test";

import {
  addComplex,
  applyComplexAffine,
  bilinearInterpolateAffinePair,
  complex,
  createAffineGrid,
  createAffineGridHandle,
  createBilinearAffineField,
  createCenteredRadialAffinePair,
  evaluateCenteredRadialWarp,
  multiplyComplex,
  type AffineGridSpec,
  type ComplexAffinePair,
} from "../src/lib/affine-grid.js";

const defaultSpec: AffineGridSpec = {
  columns: 3,
  rows: 3,
  minReal: -2,
  maxReal: 2,
  minImag: -1,
  maxImag: 3,
  time: 16,
};

function approxEqual(actual: number, expected: number, epsilon = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function approxComplex(actual: { real: number; imag: number }, expected: { real: number; imag: number }, epsilon = 1e-9): void {
  approxEqual(actual.real, expected.real, epsilon);
  approxEqual(actual.imag, expected.imag, epsilon);
}

void test("complex arithmetic applies affine pairs in the expected order", () => {
  const point = complex(2, -1);
  const pair = {
    a: complex(0.5, 1.5),
    b: complex(-2, 4),
  } satisfies ComplexAffinePair;

  assert.deepEqual(multiplyComplex(complex(1, 2), complex(3, 4)), complex(-5, 10));
  assert.deepEqual(addComplex(complex(1, 2), complex(3, 4)), complex(4, 6));
  assert.deepEqual(applyComplexAffine(point, pair), complex(0.5, 6.5));
});

void test("the centered radial pair is identity at time zero and keeps b at zero", () => {
  const point = complex(1.25, -0.75);
  const pair = createCenteredRadialAffinePair(point, 0);

  approxComplex(pair.a, complex(1, 0));
  approxComplex(pair.b, complex(0, 0));
  approxComplex(evaluateCenteredRadialWarp(point, 0), point);
});

void test("createAffineGrid samples the hardcoded warp over the requested domain", () => {
  const grid = createAffineGrid(defaultSpec);
  const firstRow = grid[0];
  const lastRow = grid.at(-1);

  assert.equal(grid.length, defaultSpec.rows);
  assert.ok(firstRow);
  assert.ok(lastRow);
  assert.equal(firstRow.length, defaultSpec.columns);

  const topLeft = firstRow[0];
  const bottomRight = lastRow.at(-1);
  assert.ok(topLeft);
  assert.ok(bottomRight);

  approxComplex(topLeft.a, createCenteredRadialAffinePair(complex(defaultSpec.minReal, defaultSpec.minImag), defaultSpec.time).a);
  approxComplex(bottomRight.a, createCenteredRadialAffinePair(complex(defaultSpec.maxReal, defaultSpec.maxImag), defaultSpec.time).a);
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

  approxComplex(interpolated.a, complex(0.5, 1));
  approxComplex(interpolated.b, complex(22.5, 0));
});

void test("the affine handle returns exact samples on knots and clamps outside the domain", () => {
  const simpleSpec: AffineGridSpec = {
    columns: 2,
    rows: 2,
    minReal: 0,
    maxReal: 10,
    minImag: 0,
    maxImag: 20,
    time: 0,
  };
  const grid = [
    [
      { a: complex(1, 0), b: complex(1, 1) },
      { a: complex(3, 0), b: complex(3, 3) },
    ],
    [
      { a: complex(1, 4), b: complex(5, 5) },
      { a: complex(3, 4), b: complex(7, 7) },
    ],
  ] satisfies ComplexAffinePair[][];
  const topRow = grid[0];
  const bottomRow = grid[1];

  const handle = createAffineGridHandle(simpleSpec, grid);
  assert.ok(topRow);
  assert.ok(bottomRow);

  assert.deepEqual(handle.sample(0, 0), topRow[0]);
  assert.deepEqual(handle.sample(10, 20), bottomRow[1]);

  const midpoint = handle.sample(5, 10);
  approxComplex(midpoint.a, complex(2, 2));
  approxComplex(midpoint.b, complex(4, 4));

  const clamped = handle.sample(-100, 999);
  assert.deepEqual(clamped, bottomRow[0]);
});

void test("createBilinearAffineField exposes interpolated transforms over a generated grid", () => {
  const field = createBilinearAffineField(defaultSpec);
  const point = complex(0.5, -0.25);
  const sample = field.sample(0, 0);
  const firstRow = field.grid[0];

  assert.equal(field.grid.length, defaultSpec.rows);
  assert.ok(firstRow);
  assert.equal(firstRow.length, defaultSpec.columns);
  approxComplex(field.transform(point, 0, 0), applyComplexAffine(point, sample), 1e-12);
});

void test("invalid specs and mismatched grids are rejected", () => {
  assert.throws(
    () => createAffineGrid({ ...defaultSpec, columns: 1 }),
    /at least two columns/,
  );
  assert.throws(
    () => createAffineGrid({ ...defaultSpec, minReal: 5, maxReal: 1 }),
    /real bounds/,
  );
  assert.throws(
    () => createAffineGridHandle(defaultSpec, [[{ a: complex(1, 0), b: complex(0, 0) }]]),
    /row count does not match/,
  );
});