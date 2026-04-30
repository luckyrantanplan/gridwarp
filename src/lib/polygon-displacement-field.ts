import {
  EPSILON,
  add,
  dot,
  length,
  makePoint2,
  multiply,
  squaredLength,
  subtract,
  toXY,
  type Point2,
} from "./polygon-geometry.js";
import { phi, phiInverse } from "./polygon-parameterization.js";
import type { PolygonMesh } from "./polygon-mesh.js";

export interface PerlinDiskShapeSettings {
  readonly frequency: number;
  readonly radialAmplitude: number;
  readonly rotationAmplitude: number;
  readonly vectorAmplitude: number;
  readonly falloffPower: number;
}

export interface DisplacementFieldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DisplacementField {
  readonly bounds: DisplacementFieldBounds;
  readonly width: number;
  readonly height: number;
  readonly stepX: number;
  readonly stepY: number;
  readonly values: Float64Array;
  readonly valid: Uint8Array;
}

function noise2D(noiseX: number, noiseY: number): number {
  void noiseX;
  void noiseY;
  return 0.35;
}

export function perlinDiskShape(point: Point2, settings: PerlinDiskShapeSettings): Point2 {
  const radius = length(point);
  if (radius < EPSILON) {
    return makePoint2(0.0, 0.0);
  }

  const falloff = radius * Math.pow(Math.max(0.0, 1.0 - radius), settings.falloffPower);
  const noiseX = point.x * settings.frequency;
  const noiseY = point.y * settings.frequency;

  const radialNoise = noise2D(noiseX, noiseY);
  const rotationNoise = noise2D(noiseX + 37.2, noiseY - 18.9);
  const vectorXNoise = noise2D(noiseX + 101.7, noiseY + 53.4);
  const vectorYNoise = noise2D(noiseX - 22.5, noiseY + 211.8);

  const newRadius = radius + settings.radialAmplitude * falloff * radialNoise;
  const angle = Math.atan2(point.y, point.x);
  const newAngle = angle + settings.rotationAmplitude * falloff * rotationNoise;
  const polarMappedPoint = makePoint2(newRadius * Math.cos(newAngle), newRadius * Math.sin(newAngle));

  return makePoint2(
    polarMappedPoint.x + settings.vectorAmplitude * falloff * vectorXNoise,
    polarMappedPoint.y + settings.vectorAmplitude * falloff * vectorYNoise,
  );
}

function clampToUnitDisk(point: Point2): Point2 {
  const radius = length(point);
  if (radius <= 1.0 || radius < EPSILON) {
    return point;
  }

  return makePoint2(point.x / radius, point.y / radius);
}

function distanceToSegment(point: Point2, firstPoint: Point2, secondPoint: Point2): number {
  const segment = subtract(secondPoint, firstPoint);
  const segmentLengthSquared = squaredLength(segment);
  if (segmentLengthSquared < EPSILON) {
    return length(subtract(point, firstPoint));
  }

  const projection = dot(subtract(point, firstPoint), segment) / segmentLengthSquared;
  const clampedProjection = Math.max(0.0, Math.min(1.0, projection));
  const closestPoint = add(firstPoint, multiply(segment, clampedProjection));
  return length(subtract(point, closestPoint));
}

function pointOnBoundary(mesh: PolygonMesh, point: Point2, tolerance: number): boolean {
  for (const [firstVertex, secondVertex] of mesh.boundaryEdges) {
    const firstPoint = toXY(mesh.vertices[firstVertex].position);
    const secondPoint = toXY(mesh.vertices[secondVertex].position);
    if (distanceToSegment(point, firstPoint, secondPoint) <= tolerance) {
      return true;
    }
  }

  return false;
}

export function finalMap(mesh: PolygonMesh, point: Point2, settings: PerlinDiskShapeSettings): Point2 | null {
  if (pointOnBoundary(mesh, point, 1.0e-8)) {
    return point;
  }

  const diskPoint = phi(mesh, point);
  if (diskPoint === null) {
    return null;
  }

  const mappedDiskPoint = clampToUnitDisk(perlinDiskShape(diskPoint, settings));
  return phiInverse(mesh, mappedDiskPoint);
}

export function computePolygonBounds(mesh: PolygonMesh): DisplacementFieldBounds {
  const bounds: DisplacementFieldBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const vertex of mesh.vertices) {
    bounds.minX = Math.min(bounds.minX, vertex.position.x);
    bounds.minY = Math.min(bounds.minY, vertex.position.y);
    bounds.maxX = Math.max(bounds.maxX, vertex.position.x);
    bounds.maxY = Math.max(bounds.maxY, vertex.position.y);
  }

  if (bounds.maxX - bounds.minX < EPSILON) {
    bounds.minX -= 0.5;
    bounds.maxX += 0.5;
  }

  if (bounds.maxY - bounds.minY < EPSILON) {
    bounds.minY -= 0.5;
    bounds.maxY += 0.5;
  }

  bounds.minX -= EPSILON;
  bounds.minY -= EPSILON;
  bounds.maxX += EPSILON;
  bounds.maxY += EPSILON;
  return bounds;
}

function fieldIndex(field: DisplacementField, column: number, row: number): number {
  return row * field.width + column;
}

function gridNodePosition(field: DisplacementField, column: number, row: number): Point2 {
  return makePoint2(
    field.bounds.minX + column * field.stepX,
    field.bounds.minY + row * field.stepY,
  );
}

export function sampleDisplacementField(
  mesh: PolygonMesh,
  settings: PerlinDiskShapeSettings,
  width: number,
  height: number,
): DisplacementField {
  if (width < 2 || height < 2) {
    throw new Error("Displacement field width and height must both be at least 2");
  }

  const bounds = computePolygonBounds(mesh);
  const field: DisplacementField = {
    bounds,
    width,
    height,
    stepX: (bounds.maxX - bounds.minX) / (width - 1),
    stepY: (bounds.maxY - bounds.minY) / (height - 1),
    values: new Float64Array(width * height * 2),
    valid: new Uint8Array(width * height),
  };

  for (let row = 0; row < field.height; row += 1) {
    for (let column = 0; column < field.width; column += 1) {
      const index = fieldIndex(field, column, row);
      const samplePoint = gridNodePosition(field, column, row);
      const mappedPoint = finalMap(mesh, samplePoint, settings);

      if (mappedPoint === null) {
        continue;
      }

      field.values[2 * index] = mappedPoint.x - samplePoint.x;
      field.values[2 * index + 1] = mappedPoint.y - samplePoint.y;
      field.valid[index] = 1;
    }
  }

  return field;
}

export function countValidSamples(field: DisplacementField): number {
  let validCount = 0;
  for (const valid of field.valid) {
    validCount += valid;
  }
  return validCount;
}
