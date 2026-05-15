import {
  DEFAULT_PARAMETERS as DEFAULT_NOISE_PARAMETERS,
  generateDisplacementField,
  type ParameterValues as NoiseGeneratorParameterValues,
} from "noise_generator";

import {
  createRegularGrid,
  regularGridPoint,
  regularGridValueIndex,
  resolveRegularGridSpec,
  type RegularGrid,
} from "../lib/regular-grid.js";
import type { Point2 } from "../lib/polygon-geometry.js";
import type { BoundingBox, PolygonShape } from "../lib/polygon-shape.js";
import { satur } from "../lib/saturation.js";
import type { NoiseEditableParameterValues } from "../shared/noise-parameters.js";

interface NoiseDisplacementSample {
  readonly x: number;
  readonly y: number;
}

export interface NoiseWarpSurfaces {
  readonly amplitudeGrid: RegularGrid;
  readonly directionGrid: RegularGrid;
  readonly activeSampleCount: number;
}

export function editableNoiseParametersFromPackage(parameters: NoiseGeneratorParameterValues): NoiseEditableParameterValues {
  return {
    force: parameters.force,
    scale: parameters.scale,
    silenceCutoffPercent: parameters.silenceCutoffPercent,
    gridSparseness: parameters.gridSparseness,
    showHeatmap: parameters.showHeatmap,
    vectorOverlayDensity: parameters.vectorOverlayDensity,
    spectralSlopeDbPerOct: parameters.spectralSlopeDbPerOct,
    amplitudeContrast: parameters.amplitudeContrast,
    swirlDensity: parameters.swirlDensity,
    swirlMinimumAngleDegrees: parameters.swirlMinimumAngleDegrees,
    swirlStrengthPercent: parameters.swirlStrengthPercent,
    swirlFalloff: parameters.swirlFalloff,
    swirlDirectionBias: parameters.swirlDirectionBias,
    directionNoiseMix: parameters.directionNoiseMix,
    randomSeed: parameters.randomSeed,
  };
}

export function deriveNoiseRenderSize(bounds: BoundingBox): Pick<NoiseGeneratorParameterValues, "renderWidth" | "renderHeight"> {
  return {
    renderWidth: Math.max(1, Math.ceil(bounds.maxX - bounds.minX)),
    renderHeight: Math.max(1, Math.ceil(bounds.maxY - bounds.minY)),
  };
}

export function createNoiseGeneratorParameters(
  parameters: NoiseEditableParameterValues,
  bounds: BoundingBox,
): NoiseGeneratorParameterValues {
  return {
    ...DEFAULT_NOISE_PARAMETERS,
    ...parameters,
    ...deriveNoiseRenderSize(bounds),
  };
}

export function createNoiseWarpSurfaces(
  polygon: PolygonShape,
  worldBounds: BoundingBox,
  samplesPerUnit: number,
  gain: number,
  plateau: number,
  noiseParameters: NoiseEditableParameterValues,
): NoiseWarpSurfaces {
  const spec = resolveRegularGridSpec(worldBounds, { samplesPerUnit });
  const amplitudeGrid = createRegularGrid(spec, 1);
  const directionGrid = createRegularGrid(spec, 2);
  const polygonBounds = polygon.min_ortho_rectangle();
  const packageParameters = createNoiseGeneratorParameters(noiseParameters, polygonBounds);
  const field = generateDisplacementField(packageParameters);
  const interiorScale = Math.max(polygon.max_interior_distance(), 1.0e-8);
  const plateauLimit = plateau * interiorScale;
  let activeSampleCount = 0;

  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const point = regularGridPoint(amplitudeGrid, column, row);
      if (!pointWithinBounds(point, polygonBounds)) {
        continue;
      }

      const distance = polygon.distance(point);
      if (distance <= 0.0) {
        continue;
      }

      const displacement = sampleNoiseDisplacement(
        field.displacementX,
        field.displacementY,
        field.grid.width,
        field.grid.height,
        point,
        polygonBounds,
      );
      const magnitude = Math.hypot(displacement.x, displacement.y);
      if (magnitude <= 1.0e-9) {
        continue;
      }

      const weightedValue = (distance / interiorScale) * magnitude * gain;
      const amplitude = satur(weightedValue, plateauLimit);
      if (amplitude <= 0.0) {
        continue;
      }

      amplitudeGrid.values[regularGridValueIndex(amplitudeGrid, column, row, 0)] = amplitude;
      directionGrid.values[regularGridValueIndex(directionGrid, column, row, 0)] = displacement.x / magnitude;
      directionGrid.values[regularGridValueIndex(directionGrid, column, row, 1)] = displacement.y / magnitude;
      activeSampleCount += 1;
    }
  }

  return {
    amplitudeGrid,
    directionGrid,
    activeSampleCount,
  };
}

function pointWithinBounds(point: Point2, bounds: BoundingBox): boolean {
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
}

function sampleNoiseDisplacement(
  displacementX: Float32Array,
  displacementY: Float32Array,
  width: number,
  height: number,
  point: Point2,
  bounds: BoundingBox,
): NoiseDisplacementSample {
  const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1.0e-9);
  const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1.0e-9);
  const normalizedX = clamp((point.x - bounds.minX) / boundsWidth, 0.0, 1.0);
  const normalizedY = clamp((bounds.maxY - point.y) / boundsHeight, 0.0, 1.0);
  const sampleX = normalizedX * Math.max(width - 1, 0);
  const sampleY = normalizedY * Math.max(height - 1, 0);

  return {
    x: sampleScalarField(displacementX, width, height, sampleX, sampleY),
    y: -sampleScalarField(displacementY, width, height, sampleX, sampleY),
  };
}

function sampleScalarField(
  values: Float32Array,
  width: number,
  height: number,
  sampleX: number,
  sampleY: number,
): number {
  const x0 = Math.floor(sampleX);
  const y0 = Math.floor(sampleY);
  const x1 = Math.min(x0 + 1, Math.max(width - 1, 0));
  const y1 = Math.min(y0 + 1, Math.max(height - 1, 0));
  const tx = sampleX - x0;
  const ty = sampleY - y0;
  const v00 = values[scalarFieldIndex(width, x0, y0)];
  const v10 = values[scalarFieldIndex(width, x1, y0)];
  const v01 = values[scalarFieldIndex(width, x0, y1)];
  const v11 = values[scalarFieldIndex(width, x1, y1)];
  const top = lerp(v00, v10, tx);
  const bottom = lerp(v01, v11, tx);
  return lerp(top, bottom, ty);
}

function scalarFieldIndex(width: number, x: number, y: number): number {
  return y * width + x;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}