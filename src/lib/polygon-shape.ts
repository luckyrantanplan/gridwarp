import {
  EPSILON,
  add,
  dot,
  length,
  makePoint2,
  multiply,
  normalizeClosedPolygon,
  squaredLength,
  subtract,
  type Point2,
} from "./polygon-geometry.js";

export interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const INITIAL_INTERIOR_SEARCH_SAMPLES = 41;
const REFINED_INTERIOR_SEARCH_SAMPLES = 17;
const INTERIOR_SEARCH_REFINEMENT_STEPS = 4;

export class PolygonShape {
  readonly points: readonly Point2[];
  private readonly bounds: BoundingBox;

  constructor(points: readonly Point2[]) {
    this.points = normalizeClosedPolygon(points).map((point) => makePoint2(point.x, point.y));
    this.bounds = boundingBoxFromPoints(this.points);
  }

  distance(point: Point2): number {
    const unsignedDistance = this.unsignedDistanceToBoundary(point);
    if (unsignedDistance <= EPSILON) {
      return 0.0;
    }

    return this.containsPoint(point) ? unsignedDistance : -unsignedDistance;
  }

  max_interior_distance(): number {
    return approximateMaxInteriorDistance(this);
  }

  min_ortho_rectangle(): BoundingBox {
    return { ...this.bounds };
  }

  containsPoint(point: Point2): boolean {
    if (!pointInsideBoundingBox(point, this.bounds)) {
      return false;
    }

    let inside = false;
    for (let pointIndex = 0; pointIndex < this.points.length; pointIndex += 1) {
      const firstPoint = this.points[pointIndex];
      const secondPoint = this.points[(pointIndex + 1) % this.points.length];
      const crossesHorizontalRay = (firstPoint.y > point.y) !== (secondPoint.y > point.y);
      if (!crossesHorizontalRay) {
        continue;
      }

      const intersectionX = firstPoint.x
        + ((point.y - firstPoint.y) * (secondPoint.x - firstPoint.x)) / (secondPoint.y - firstPoint.y);
      if (point.x < intersectionX) {
        inside = !inside;
      }
    }

    return inside;
  }

  private unsignedDistanceToBoundary(point: Point2): number {
    let minimumDistance = Number.POSITIVE_INFINITY;
    for (let pointIndex = 0; pointIndex < this.points.length; pointIndex += 1) {
      const firstPoint = this.points[pointIndex];
      const secondPoint = this.points[(pointIndex + 1) % this.points.length];
      minimumDistance = Math.min(minimumDistance, distanceToSegment(point, firstPoint, secondPoint));
    }
    return minimumDistance;
  }
}

export function distanceToSegment(point: Point2, firstPoint: Point2, secondPoint: Point2): number {
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

function boundingBoxFromPoints(points: readonly Point2[]): BoundingBox {
  const firstPoint = points[0];
  let minX = firstPoint.x;
  let minY = firstPoint.y;
  let maxX = firstPoint.x;
  let maxY = firstPoint.y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function approximateMaxInteriorDistance(shape: PolygonShape): number {
  const bounds = shape.min_ortho_rectangle();
  let center = makePoint2(0.5 * (bounds.minX + bounds.maxX), 0.5 * (bounds.minY + bounds.maxY));
  let radiusX = 0.5 * (bounds.maxX - bounds.minX);
  let radiusY = 0.5 * (bounds.maxY - bounds.minY);
  let bestDistance = Math.max(0.0, shape.distance(center));

  for (let refinementStep = 0; refinementStep <= INTERIOR_SEARCH_REFINEMENT_STEPS; refinementStep += 1) {
    const samples = refinementStep === 0 ? INITIAL_INTERIOR_SEARCH_SAMPLES : REFINED_INTERIOR_SEARCH_SAMPLES;
    const minX = Math.max(bounds.minX, center.x - radiusX);
    const maxX = Math.min(bounds.maxX, center.x + radiusX);
    const minY = Math.max(bounds.minY, center.y - radiusY);
    const maxY = Math.min(bounds.maxY, center.y + radiusY);
    const stepX = samples > 1 ? (maxX - minX) / (samples - 1) : 0.0;
    const stepY = samples > 1 ? (maxY - minY) / (samples - 1) : 0.0;

    for (let row = 0; row < samples; row += 1) {
      const y = minY + row * stepY;
      for (let column = 0; column < samples; column += 1) {
        const x = minX + column * stepX;
        const point = makePoint2(x, y);
        const distance = shape.distance(point);
        if (distance > bestDistance) {
          bestDistance = distance;
          center = point;
        }
      }
    }

    radiusX = Math.max(stepX, EPSILON);
    radiusY = Math.max(stepY, EPSILON);
  }

  return Math.max(0.0, bestDistance);
}

function pointInsideBoundingBox(point: Point2, bounds: BoundingBox): boolean {
  return point.x >= bounds.minX - EPSILON
    && point.x <= bounds.maxX + EPSILON
    && point.y >= bounds.minY - EPSILON
    && point.y <= bounds.maxY + EPSILON;
}