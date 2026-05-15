import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PARAMETERS as DEFAULT_NOISE_PARAMETERS } from "noise_generator";

import { BicubicGridSampler } from "../src/lib/bicubic-grid-sampler.js";
import { createInitialGeometry } from "../src/client/initial-geometry.js";
import { mapPlotPoint, sampleTransferCurve, transferCurvePathData } from "../src/client/transfer-curve.js";
import { createDirectionGrid } from "../src/lib/direction-grid.js";
import { PolygonShape } from "../src/lib/polygon-shape.js";
import { resolveRegularGridSpec } from "../src/lib/regular-grid.js";
import { createNoiseGeneratorParameters, createNoiseWarpSurfaces, deriveNoiseRenderSize } from "../src/server/noise-field-adapter.js";
import { SvgContourRenderer } from "../src/render/svg-contour-renderer.js";
import { AngleDirectedSurfaceWarpField } from "../src/lib/scalar-surface-warp-field.js";
import { createScalarGrid, scalarGridIndex } from "../src/lib/scalar-grid.js";
import { satur } from "../src/lib/saturation.js";
import {
  createWorldScreenTransform,
  screenPointFromWorld,
  worldPointFromScreen,
} from "../src/lib/world-screen-transform.js";
import type { TangentSample } from "../src/render/types.js";
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

void test("resolveRegularGridSpec converts samples-per-unit into rectangular inclusive endpoints", () => {
  const spec = resolveRegularGridSpec({ minX: -60.0, minY: -45.0, maxX: 60.0, maxY: 45.0 }, { samplesPerUnit: 10.0 });

  assert.deepEqual(spec, {
    minX: -60.0,
    minY: -45.0,
    maxX: 60.0,
    maxY: 45.0,
    columns: 1201,
    rows: 901,
  });
});

void test("createInitialGeometry keeps the resized world viewBox and scales grid density with the octogon", () => {
  const geometry = createInitialGeometry(960, 320, true, true);
  const horizontalGridMatch = geometry.svg.match(/<g id="horizontal-grid">([\s\S]*?)<\/g>/);
  const verticalGridMatch = geometry.svg.match(/<g id="vertical-grid">([\s\S]*?)<\/g>/);

  assert.match(geometry.svg, /viewBox="-225\.00 -225\.00 450\.00 450\.00"/);
  assert.ok(horizontalGridMatch !== null);
  assert.ok(verticalGridMatch !== null);
  assert.equal([...horizontalGridMatch[1].matchAll(/<polyline\b/g)].length, 36);
  assert.equal([...verticalGridMatch[1].matchAll(/<polyline\b/g)].length, 36);
});

void test("world-screen transform preserves 1:1 scaling in rectangular renders", () => {
  const transform = createWorldScreenTransform(640, 480, {
    minX: -12.0,
    minY: -12.0,
    maxX: 12.0,
    maxY: 12.0,
  });

  const topLeft = screenPointFromWorld({ x: -12.0, y: 12.0 }, transform);
  const bottomRight = screenPointFromWorld({ x: 12.0, y: -12.0 }, transform);
  const center = worldPointFromScreen(320.0, 240.0, transform);

  approximatelyEqual(topLeft.x, 80.0, DEFAULT_EPSILON);
  approximatelyEqual(topLeft.y, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(bottomRight.x, 560.0, DEFAULT_EPSILON);
  approximatelyEqual(bottomRight.y, 480.0, DEFAULT_EPSILON);
  approximatelyEqual(center.x, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(center.y, 0.0, DEFAULT_EPSILON);
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
  const directionGrid = createDirectionGrid({ minX: -2.0, minY: -2.0, maxX: 2.0, maxY: 2.0, columns: 5, rows: 5 }, {
    angleOffset: 0.0,
  });
  const sampler = new BicubicGridSampler(directionGrid);
  const direction = sampler.evaluateVector(1.0, 0.0);

  approximatelyEqual(direction[0], 1.0, DEFAULT_EPSILON);
  approximatelyEqual(direction[1], 0.0, DEFAULT_EPSILON);
});

void test("deriveNoiseRenderSize rounds the outer bbox up to immutable package dimensions", () => {
  assert.deepEqual(deriveNoiseRenderSize({ minX: 1.2, minY: -2.4, maxX: 9.1, maxY: 5.2 }), {
    renderWidth: 8,
    renderHeight: 8,
  });
});

void test("createNoiseGeneratorParameters merges editable values with ceil-rounded bbox size", () => {
  const parameters = createNoiseGeneratorParameters({
    force: 10,
    scale: DEFAULT_NOISE_PARAMETERS.scale,
    silenceCutoffPercent: DEFAULT_NOISE_PARAMETERS.silenceCutoffPercent,
    gridSparseness: DEFAULT_NOISE_PARAMETERS.gridSparseness,
    showHeatmap: DEFAULT_NOISE_PARAMETERS.showHeatmap,
    vectorOverlayDensity: DEFAULT_NOISE_PARAMETERS.vectorOverlayDensity,
    spectralSlopeDbPerOct: DEFAULT_NOISE_PARAMETERS.spectralSlopeDbPerOct,
    amplitudeContrast: DEFAULT_NOISE_PARAMETERS.amplitudeContrast,
    swirlDensity: DEFAULT_NOISE_PARAMETERS.swirlDensity,
    swirlMinimumAngleDegrees: DEFAULT_NOISE_PARAMETERS.swirlMinimumAngleDegrees,
    swirlStrengthPercent: DEFAULT_NOISE_PARAMETERS.swirlStrengthPercent,
    swirlFalloff: DEFAULT_NOISE_PARAMETERS.swirlFalloff,
    swirlDirectionBias: DEFAULT_NOISE_PARAMETERS.swirlDirectionBias,
    directionNoiseMix: DEFAULT_NOISE_PARAMETERS.directionNoiseMix,
    randomSeed: "adapter-test",
  }, {
    minX: -3.6,
    minY: -4.2,
    maxX: 4.2,
    maxY: 3.1,
  });

  assert.equal(parameters.renderWidth, 8);
  assert.equal(parameters.renderHeight, 8);
  assert.equal(parameters.force, 10);
  assert.equal(parameters.silenceCutoffPercent, DEFAULT_NOISE_PARAMETERS.silenceCutoffPercent);
  assert.equal(parameters.randomSeed, "adapter-test");
});

void test("createNoiseWarpSurfaces keeps displacement outside the bbox at zero", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const surfaces = createNoiseWarpSurfaces(
    shape,
    { minX: -3.0, minY: -3.0, maxX: 3.0, maxY: 3.0 },
    4.0,
    1.0,
    1.0,
    {
      force: 40,
      scale: DEFAULT_NOISE_PARAMETERS.scale,
      silenceCutoffPercent: DEFAULT_NOISE_PARAMETERS.silenceCutoffPercent,
      gridSparseness: DEFAULT_NOISE_PARAMETERS.gridSparseness,
      showHeatmap: DEFAULT_NOISE_PARAMETERS.showHeatmap,
      vectorOverlayDensity: DEFAULT_NOISE_PARAMETERS.vectorOverlayDensity,
      spectralSlopeDbPerOct: DEFAULT_NOISE_PARAMETERS.spectralSlopeDbPerOct,
      amplitudeContrast: DEFAULT_NOISE_PARAMETERS.amplitudeContrast,
      swirlDensity: DEFAULT_NOISE_PARAMETERS.swirlDensity,
      swirlMinimumAngleDegrees: DEFAULT_NOISE_PARAMETERS.swirlMinimumAngleDegrees,
      swirlStrengthPercent: DEFAULT_NOISE_PARAMETERS.swirlStrengthPercent,
      swirlFalloff: DEFAULT_NOISE_PARAMETERS.swirlFalloff,
      swirlDirectionBias: DEFAULT_NOISE_PARAMETERS.swirlDirectionBias,
      directionNoiseMix: DEFAULT_NOISE_PARAMETERS.directionNoiseMix,
      randomSeed: "surface-test",
    },
  );

  const outsideIndex = scalarGridIndex(surfaces.amplitudeGrid, 0, 0);
  assert.equal(surfaces.amplitudeGrid.values[outsideIndex], 0.0);
});

void test("createNoiseWarpSurfaces uses gain and plateau to shape generated magnitude", () => {
  const commonParameters = {
    force: 40,
    scale: DEFAULT_NOISE_PARAMETERS.scale,
    silenceCutoffPercent: DEFAULT_NOISE_PARAMETERS.silenceCutoffPercent,
    gridSparseness: DEFAULT_NOISE_PARAMETERS.gridSparseness,
    showHeatmap: DEFAULT_NOISE_PARAMETERS.showHeatmap,
    vectorOverlayDensity: DEFAULT_NOISE_PARAMETERS.vectorOverlayDensity,
    spectralSlopeDbPerOct: DEFAULT_NOISE_PARAMETERS.spectralSlopeDbPerOct,
    amplitudeContrast: DEFAULT_NOISE_PARAMETERS.amplitudeContrast,
    swirlDensity: 0,
    swirlMinimumAngleDegrees: DEFAULT_NOISE_PARAMETERS.swirlMinimumAngleDegrees,
    swirlStrengthPercent: DEFAULT_NOISE_PARAMETERS.swirlStrengthPercent,
    swirlFalloff: DEFAULT_NOISE_PARAMETERS.swirlFalloff,
    swirlDirectionBias: DEFAULT_NOISE_PARAMETERS.swirlDirectionBias,
    directionNoiseMix: 1,
    randomSeed: "gain-test",
  };
  const shape = new PolygonShape(squarePoints(2.0));
  const lowGain = createNoiseWarpSurfaces(shape, { minX: 0.0, minY: 0.0, maxX: 2.0, maxY: 2.0 }, 4.0, 0.5, 100.0, commonParameters);
  const highGain = createNoiseWarpSurfaces(shape, { minX: 0.0, minY: 0.0, maxX: 2.0, maxY: 2.0 }, 4.0, 1.0, 100.0, commonParameters);
  const lowGainTotal = lowGain.amplitudeGrid.values.reduce((sum, value) => sum + value, 0);
  const highGainTotal = highGain.amplitudeGrid.values.reduce((sum, value) => sum + value, 0);

  assert.ok(highGainTotal > lowGainTotal);

  const lowPlateau = createNoiseWarpSurfaces(shape, { minX: 0.0, minY: 0.0, maxX: 2.0, maxY: 2.0 }, 4.0, 4.0, 0.2, commonParameters);
  const lowPlateauPeak = Math.max(...lowPlateau.amplitudeGrid.values);
  assert.ok(lowPlateauPeak <= 0.2 + DEFAULT_EPSILON);

  const largerShape = new PolygonShape(squarePoints(20.0));
  const largePlateau = createNoiseWarpSurfaces(largerShape, { minX: 0.0, minY: 0.0, maxX: 20.0, maxY: 20.0 }, 4.0, 4.0, 0.2, commonParameters);
  const largePlateauPeak = Math.max(...largePlateau.amplitudeGrid.values);
  assert.ok(largePlateauPeak <= 2.0 + DEFAULT_EPSILON);
  assert.ok(largePlateauPeak > 1.0);
});

void test("sampleTransferCurve follows satur(gain * x, plateau)", () => {
  const samples = sampleTransferCurve(1.5, 0.75, 5);

  approximatelyEqual(samples[0].x, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[0].y, 0.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[4].x, 1.0, DEFAULT_EPSILON);
  approximatelyEqual(samples[4].y, 0.75, DEFAULT_EPSILON);
  approximatelyEqual(samples[2].y, satur(1.5 * 0.5, 0.75), DEFAULT_EPSILON);
});

void test("createNoiseWarpSurfaces resolves rectangular world grids from explicit bounds", () => {
  const shape = new PolygonShape(squarePoints(2.0));
  const surfaces = createNoiseWarpSurfaces(
    shape,
    { minX: -2.0, minY: -1.0, maxX: 2.0, maxY: 1.0 },
    2.0,
    1.0,
    1.0,
    {
      force: 20,
      scale: DEFAULT_NOISE_PARAMETERS.scale,
      silenceCutoffPercent: DEFAULT_NOISE_PARAMETERS.silenceCutoffPercent,
      gridSparseness: DEFAULT_NOISE_PARAMETERS.gridSparseness,
      showHeatmap: DEFAULT_NOISE_PARAMETERS.showHeatmap,
      vectorOverlayDensity: DEFAULT_NOISE_PARAMETERS.vectorOverlayDensity,
      spectralSlopeDbPerOct: DEFAULT_NOISE_PARAMETERS.spectralSlopeDbPerOct,
      amplitudeContrast: DEFAULT_NOISE_PARAMETERS.amplitudeContrast,
      swirlDensity: DEFAULT_NOISE_PARAMETERS.swirlDensity,
      swirlMinimumAngleDegrees: DEFAULT_NOISE_PARAMETERS.swirlMinimumAngleDegrees,
      swirlStrengthPercent: DEFAULT_NOISE_PARAMETERS.swirlStrengthPercent,
      swirlFalloff: DEFAULT_NOISE_PARAMETERS.swirlFalloff,
      swirlDirectionBias: DEFAULT_NOISE_PARAMETERS.swirlDirectionBias,
      directionNoiseMix: DEFAULT_NOISE_PARAMETERS.directionNoiseMix,
      randomSeed: "rectangular-grid",
    },
  );

  assert.equal(surfaces.amplitudeGrid.spec.columns, 9);
  assert.equal(surfaces.amplitudeGrid.spec.rows, 5);
});

void test("transferCurvePathData maps samples into plot coordinates", () => {
  const samples = [{ x: 0.0, y: 0.0 }, { x: 1.0, y: 1.0 }];
  const bounds = { minX: 0.0, maxX: 1.0, minY: 0.0, maxY: 1.0 };
  const frame = { width: 100.0, height: 80.0, paddingLeft: 10.0, paddingRight: 20.0, paddingTop: 5.0, paddingBottom: 15.0 };

  assert.equal(transferCurvePathData(samples, bounds, frame), "M10.00 65.00 L80.00 5.00");
  assert.deepEqual(mapPlotPoint({ x: 1.0, y: 1.0 }, bounds, frame), { x: 80.0, y: 5.0 });
});

void test("SvgContourRenderer preserves sharp polygon corners with line segments", () => {
  const renderer = new SvgContourRenderer(1.0, 2);
  const diagonal = 1 / Math.sqrt(2);
  const squareSamples: TangentSample[] = [
    { x: 0.0, y: 0.0, tangent: { x: diagonal, y: -diagonal } },
    { x: 1.0, y: 0.0, tangent: { x: diagonal, y: diagonal } },
    { x: 1.0, y: 1.0, tangent: { x: -diagonal, y: diagonal } },
    { x: 0.0, y: 1.0, tangent: { x: -diagonal, y: -diagonal } },
  ];

  const pathData = renderer.createPathData({ closed: true, samples: squareSamples });

  assert.match(pathData, /^M /);
  assert.ok(pathData.includes(" L "));
  assert.ok(!pathData.includes(" C "));
  assert.ok(pathData.endsWith(" Z"));
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
    angleOffset: 0.0,
  });
  const warp = new AngleDirectedSurfaceWarpField(100, 100, { minX: -5.0, minY: -5.0, maxX: 5.0, maxY: 5.0 }, shape, new BicubicGridSampler(grid), new BicubicGridSampler(directionGrid), {
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