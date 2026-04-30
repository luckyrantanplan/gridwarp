export const EPSILON = 1.0e-10;
export const TWO_PI = 2.0 * Math.PI;

export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface Point3 extends Point2 {
  readonly z: number;
}

export interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

export interface BarycentricCoordinates {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

export function makePoint2(xCoordinate: number, yCoordinate: number): Point2 {
  return { x: xCoordinate, y: yCoordinate };
}

export function makePoint3(xCoordinate: number, yCoordinate: number, zCoordinate: number): Point3 {
  return { x: xCoordinate, y: yCoordinate, z: zCoordinate };
}

export function subtract(firstPoint: Point2, secondPoint: Point2): Point2 {
  return makePoint2(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

export function add(firstPoint: Point2, secondPoint: Point2): Point2 {
  return makePoint2(firstPoint.x + secondPoint.x, firstPoint.y + secondPoint.y);
}

export function multiply(point: Point2, scalar: number): Point2 {
  return makePoint2(point.x * scalar, point.y * scalar);
}

export function squaredLength(vector: Point2): number {
  return vector.x * vector.x + vector.y * vector.y;
}

export function length(vector: Point2): number {
  return Math.sqrt(squaredLength(vector));
}

export function cross(firstVector: Point2, secondVector: Point2): number {
  return firstVector.x * secondVector.y - firstVector.y * secondVector.x;
}

export function dot(firstVector: Point2, secondVector: Point2): number {
  return firstVector.x * secondVector.x + firstVector.y * secondVector.y;
}

export function toXY(point: Point3): Point2 {
  return makePoint2(point.x, point.y);
}

export function signedPolygonArea(points: readonly Point2[]): number {
  let doubledArea = 0.0;
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const point = points[pointIndex];
    const nextPoint = points[(pointIndex + 1) % points.length];
    doubledArea += point.x * nextPoint.y - nextPoint.x * point.y;
  }
  return 0.5 * doubledArea;
}

export function samePoint(firstPoint: Point2, secondPoint: Point2): boolean {
  return Math.abs(firstPoint.x - secondPoint.x) < EPSILON && Math.abs(firstPoint.y - secondPoint.y) < EPSILON;
}

export function normalizeClosedPolygon(points: readonly Point2[]): Point2[] {
  if (points.length < 3) {
    throw new Error("Expected at least three polygon points");
  }

  const normalizedPoints = [...points];
  if (samePoint(normalizedPoints[0], normalizedPoints[normalizedPoints.length - 1])) {
    normalizedPoints.pop();
  }

  if (normalizedPoints.length < 3) {
    throw new Error("Expected at least three distinct polygon points");
  }

  const area = signedPolygonArea(normalizedPoints);
  if (Math.abs(area) < EPSILON) {
    throw new Error("Polygon area is too small to triangulate");
  }

  if (area < 0.0) {
    normalizedPoints.reverse();
  }

  return normalizedPoints;
}

export function barycentricCoordinates(
  point: Point2,
  firstPoint: Point2,
  secondPoint: Point2,
  thirdPoint: Point2,
): BarycentricCoordinates | null {
  const firstEdge = subtract(secondPoint, firstPoint);
  const secondEdge = subtract(thirdPoint, firstPoint);
  const pointVector = subtract(point, firstPoint);
  const denominator = cross(firstEdge, secondEdge);

  if (Math.abs(denominator) < EPSILON) {
    return null;
  }

  const beta = cross(pointVector, secondEdge) / denominator;
  const gamma = cross(firstEdge, pointVector) / denominator;
  const alpha = 1.0 - beta - gamma;
  return { alpha, beta, gamma };
}

export function isInsideOrOnTriangle(coordinates: BarycentricCoordinates): boolean {
  return coordinates.alpha >= -EPSILON && coordinates.beta >= -EPSILON && coordinates.gamma >= -EPSILON
    && coordinates.alpha <= 1.0 + EPSILON && coordinates.beta <= 1.0 + EPSILON && coordinates.gamma <= 1.0 + EPSILON;
}

export function pointInTriangle(point: Point2, firstPoint: Point2, secondPoint: Point2, thirdPoint: Point2): boolean {
  const coordinates = barycentricCoordinates(point, firstPoint, secondPoint, thirdPoint);
  return coordinates !== null && isInsideOrOnTriangle(coordinates);
}
