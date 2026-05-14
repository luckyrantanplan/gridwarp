import assert from "node:assert/strict";
import test from "node:test";

import { BicubicGridSampler } from "../src/lib/bicubic-grid-sampler.js";
import { mapPlotPoint, sampleTransferCurve, transferCurvePathData } from "../src/client/transfer-curve.js";
import { createDirectionGrid } from "../src/lib/direction-grid.js";
import { PolygonShape } from "../src/lib/polygon-shape.js";
import { AngleDirectedSurfaceWarpField } from "../src/lib/scalar-surface-warp-field.js";
import { createPolygonScalarGrid, createScalarGrid, scalarGridIndex } from "../src/lib/scalar-grid.js";
import { satur } from "../src/lib/saturation.js";
import type { Point2 } from "../src/lib/polygon-geometry.js";

const DEFAULT_EPSILON = 1.0e-9;

function approximatelyEqual(actual: number, expected: number, tolerance: number): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${String(actual)} to be within ${String(tolerance)} of ${String(expected)}`);
}

function squarePoints(size: number): Point2[] {
  return [
    { x: 0.0, y: 0.0 },
    { x: size, y: 0.0 },
    { x: size, y: size },
    { x: 0.0, y: size },
  ];
}

void test("PolygonShape reports signed distance and axis-aligned bounds", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const bounds = shape.min_ortho_rectangle();

  assert.deepEqual(bounds, { minX: 0.0, minY: 0.0, maxX: 2.0, maxY: 2.0 });
  approximatelyEqual(shape.distance({ x: 1.0, y: 1.0 }), 1.0, DEFAULT_EPSILON);
  approximatelyEqual(shape.distance({ x: 2.0, y: 1.0 }), 0.0, DEFAULT_EPSILON);
  approximatelyEqual(shape.distance({ x: 3.0, y: 1.0 }), -1.0, DEFAULT_EPSILON);
});

void test("PolygonShape approximates the maximal interior distance", () => {
  const shape = new PolygonShape(squarePoints(2.0));

  approximatelyEqual(shape.max_interior_distance(), 1.0, 1.0e-4);
});

void test("satur is C1 at the zero and plateau joins", () => {
  const plateau = 2.0;
  const epsilon = 1.0e-5;

  approximatelyEqual(satur(-1.0, plateau), 0.0, DEFAULT_EPSILON);
  approximatelyEqual(satur(0.0, plateau), 0.0, DEFAULT_EPSILON);
  approximatelyEqual(satur(plateau, plateau), plateau, DEFAULT_EPSILON);
  approximatelyEqual(satur(3.0, plateau), plateau, DEFAULT_EPSILON);

  const zeroRightDerivative = (satur(epsilon, plateau) - satur(0.0, plateau)) / epsilon;
  const plateauLeftDerivative = (satur(plateau, plateau) - satur(plateau - epsilon, plateau)) / epsilon;
  approximatelyEqual(zeroRightDerivative, 0.0, 1.0e-4);
  approximatelyEqual(plateauLeftDerivative, 0.0, 1.0e-4);
});

void test("BicubicGridSampler reproduces scalar grid knots", () => {
  const grid = createScalarGrid({ columns: 5, rows: 5, minX: -1.0, minY: -1.0, maxX: 1.0, maxY: 1.0 });

  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      const x = grid.spec.minX + column * grid.stepX;
      const y = grid.spec.minY + row * grid.stepY;
      grid.values[scalarGridIndex(grid, column, row)] = x + 2.0 * y;
    }
  }

  const interpolator = new BicubicGridSampler(grid);
  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      const x = grid.spec.minX + column * grid.stepX;
      const y = grid.spec.minY + row * grid.stepY;
      approximatelyEqual(interpolator.evaluateComponent(x, y, 0), x + 2.0 * y, DEFAULT_EPSILON);
    }
  }
});

void test("BicubicGridSampler has matching first derivatives across interior cell boundaries", () => {
  const grid = createScalarGrid({ columns: 7, rows: 7, minX: 0.0, minY: 0.0, maxX: 6.0, maxY: 6.0 });

  for (let row = 0; row < grid.spec.rows; row += 1) {
    for (let column = 0; column < grid.spec.columns; column += 1) {
      const x = grid.spec.minX + column * grid.stepX;
      const y = grid.spec.minY + row * grid.stepY;
      grid.values[scalarGridIndex(grid, column, row)] = Math.sin(0.4 * x) + Math.cos(0.3 * y);
    }
  }

  const interpolator = new BicubicGridSampler(grid);
  const x = 3.0;
  const y = 2.35;
  const delta = 1.0e-5;
  const leftDerivative = (interpolator.evaluateComponent(x, y, 0) - interpolator.evaluateComponent(x - delta, y, 0)) / delta;
  const rightDerivative = (interpolator.evaluateComponent(x + delta, y, 0) - interpolator.evaluateComponent(x, y, 0)) / delta;

  approximatelyEqual(leftDerivative, rightDerivative, 1.0e-4);
});

void test("createDirectionGrid stores unit complex directions and the bicubic sampler interpolates them", () => {
  const directionGrid = createDirectionGrid({ minX: -2.0, minY: -2.0, maxX: 2.0, maxY: 2.0 }, {
    columns: 5,
    rows: 5,
    angleOffset: 0.0,
  });
  const sampler = new BicubicGridSampler(directionGrid);
  const direction = sampler.evaluateVector(1.0, 0.0);

  approximatelyEqual(direction[0], 1.0, DEFAULT_EPSILON);
  approximatelyEqual(direction[1], 0.0, DEFAULT_EPSILON);
});

void test("createPolygonScalarGrid keeps the stubbed positive noise behavior", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const grid = createPolygonScalarGrid(shape, { columns: 9, rows: 9, padding: 0.0, gain: 1.0, plateau: 1.0 });
  const centerIndex = scalarGridIndex(grid, 4, 4);

  assert.ok(grid.values[centerIndex] > 0.0);
  assert.equal(grid.values[scalarGridIndex(grid, 0, 0)], 0.0);
});

void test("createPolygonScalarGrid uses gain to scale the pre-clamp field", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const lowGainGrid = createPolygonScalarGrid(shape, { columns: 9, rows: 9, padding: 0.0, gain: 0.5, plateau: 1.0 });
  const highGainGrid = createPolygonScalarGrid(shape, { columns: 9, rows: 9, padding: 0.0, gain: 1.0, plateau: 1.0 });
  const centerIndex = scalarGridIndex(lowGainGrid, 4, 4);

  approximatelyEqual(lowGainGrid.values[centerIndex], satur(0.35 * 0.5, 1.0), DEFAULT_EPSILON);
  approximatelyEqual(highGainGrid.values[centerIndex], satur(0.35 * 1.0, 1.0), DEFAULT_EPSILON);
  assert.ok(highGainGrid.values[centerIndex] > lowGainGrid.values[centerIndex]);
});

void test("createPolygonScalarGrid uses plateau as the clamp threshold", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const lowPlateauGrid = createPolygonScalarGrid(shape, { columns: 9, rows: 9, padding: 0.0, gain: 4.0, plateau: 0.5 });
  const highPlateauGrid = createPolygonScalarGrid(shape, { columns: 9, rows: 9, padding: 0.0, gain: 4.0, plateau: 1.5 });
  const centerIndex = scalarGridIndex(lowPlateauGrid, 4, 4);

  approximatelyEqual(lowPlateauGrid.values[centerIndex], 0.5, DEFAULT_EPSILON);
  approximatelyEqual(highPlateauGrid.values[centerIndex], satur(0.35 * 4.0, 1.5), DEFAULT_EPSILON);
  assert.ok(highPlateauGrid.values[centerIndex] > lowPlateauGrid.values[centerIndex]);
});

void test("sampleTransferCurve follows satur(gain * x, plateau)", () => {
  const samples = sampleTransferCurve(1.5, 0.75, 5);

  approximatelyEqual(samples[0].x, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[0].y, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[4].x, 1.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[4].y, 0.75, DEFAULT_EPSILON);
  approximatelyEqual(samples[2].y, satur(1.5 * 0.5, 0.75), DEFAULT_EPSILON);
});

void test("transferCurvePathData maps samples into plot coordinates", () => {
  const samples = [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }];
  const bounds = { minX: 0.0, maxX: 1.0, minY: 0.0, maxY: 1.0 };
  const frame = { width: 100.0, height: 80.0, paddingLeft: 10.0, paddingRight: 20.0, paddingTop: 5.0, paddingBottom: 15.0 };

  assert.equal(transferCurvePathData(samples, bounds, frame), "M10.00 65.00 L80.00 5.00");
  assert.deepEqual(mapPlotPoint({ x: 1.0, y: 1.0 }, bounds, frame), { x: 80.0, y: 5.0 });
});

void test("AngleDirectedSurfaceWarpField uses scalar values as complex-angle amplitudes", () => {
  const shape = new PolygonShape([
    { x: -2.0, y: -2.0 },
    { x: 2.0, y: -2.0 },
    { x: 2.0, y: 2.0 },
    { x: -2.0, y: 2.0 },
  ]);
  const grid = createScalarGrid({ columns: 4, rows: 4, minX: -2.0, minY: -2.0, maxX: 2.0, maxY: 2.0 });
  grid.values.fill(1.0);
  const directionGrid = createDirectionGrid(grid.spec, {
    columns: grid.spec.columns,
    rows: grid.spec.rows,
    angleOffset: 0.0,
  });
  const warp = new AngleDirectedSurfaceWarpField(100, 100, shape, new BicubicGridSampler(grid), new BicubicGridSampler(directionGrid), {
    finiteDifferenceEpsilon: 0.5,
    amplitudeScale: 1.0,
  });

  const insideValue = warp.valueAt(60.0, 50.0);
  approximatelyEqual(insideValue.warpedX, 2.0, DEFAULT_EPSILON);
  approximatelyEqual(insideValue.warpedY, 0.0, DEFAULT_EPSILON);

  const outsideValue = warp.valueAt(90.0, 50.0);
  approximatelyEqual(outsideValue.warpedX, 4.0, DEFAULT_EPSILON);
  approximatelyEqual(outsideValue.warpedY, 0.0, DEFAULT_EPSILON);
});