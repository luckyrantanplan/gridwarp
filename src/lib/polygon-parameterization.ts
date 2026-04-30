import {
  EPSILON,
  TWO_PI,
  barycentricCoordinates,
  isInsideOrOnTriangle,
  length,
  makePoint2,
  subtract,
  toXY,
  type BarycentricCoordinates,
  type Point2,
} from "./polygon-geometry.js";
import type { PolygonMesh } from "./polygon-mesh.js";

const TRIANGLE_SEARCH_GRID_COLUMNS = 48;
const TRIANGLE_SEARCH_GRID_ROWS = 48;

interface LocatedTriangle {
  readonly triangleIndex: number;
  readonly coordinates: BarycentricCoordinates;
}

interface TriangleSearchBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface TriangleSearchIndex {
  readonly bounds: TriangleSearchBounds;
  readonly columns: number;
  readonly rows: number;
  readonly buckets: number[][];
}

type TriangleCoordinateSpace = "original" | "uv";

const originalTriangleSearchIndexByMesh = new WeakMap<PolygonMesh, TriangleSearchIndex>();
const uvTriangleSearchIndexByMesh = new WeakMap<PolygonMesh, TriangleSearchIndex>();

function locateTriangleInOriginalMesh(mesh: PolygonMesh, point: Point2): LocatedTriangle | null {
  return locateTriangleInMesh(mesh, point, "original");
}

function locateTriangleInUvMesh(mesh: PolygonMesh, point: Point2): LocatedTriangle | null {
  return locateTriangleInMesh(mesh, point, "uv");
}

function locateTriangleInMesh(mesh: PolygonMesh, point: Point2, coordinateSpace: TriangleCoordinateSpace): LocatedTriangle | null {
  const searchIndex = getTriangleSearchIndex(mesh, coordinateSpace);
  const column = coordinateToBucket(point.x, searchIndex.bounds.minX, searchIndex.bounds.maxX, searchIndex.columns);
  const row = coordinateToBucket(point.y, searchIndex.bounds.minY, searchIndex.bounds.maxY, searchIndex.rows);

  if (column === null || row === null) {
    return null;
  }

  return locateTriangleInCandidates(mesh, point, coordinateSpace, searchIndex.buckets[bucketIndex(searchIndex, column, row)]);
}

function locateTriangleInCandidates(
  mesh: PolygonMesh,
  point: Point2,
  coordinateSpace: TriangleCoordinateSpace,
  candidateTriangles: readonly number[],
): LocatedTriangle | null {
  for (const triangleIndex of candidateTriangles) {
    const triangle = mesh.triangles[triangleIndex];
    const firstPoint = trianglePoint(mesh, triangle.a, coordinateSpace);
    const secondPoint = trianglePoint(mesh, triangle.b, coordinateSpace);
    const thirdPoint = trianglePoint(mesh, triangle.c, coordinateSpace);
    const coordinates = barycentricCoordinates(point, firstPoint, secondPoint, thirdPoint);

    if (coordinates !== null && isInsideOrOnTriangle(coordinates)) {
      return { triangleIndex, coordinates };
    }
  }

  return null;
}

function getTriangleSearchIndex(mesh: PolygonMesh, coordinateSpace: TriangleCoordinateSpace): TriangleSearchIndex {
  const cache = coordinateSpace === "original" ? originalTriangleSearchIndexByMesh : uvTriangleSearchIndexByMesh;
  const existingIndex = cache.get(mesh);
  if (existingIndex !== undefined) {
    return existingIndex;
  }

  const searchIndex = createTriangleSearchIndex(mesh, coordinateSpace);
  cache.set(mesh, searchIndex);
  return searchIndex;
}

function createTriangleSearchIndex(mesh: PolygonMesh, coordinateSpace: TriangleCoordinateSpace): TriangleSearchIndex {
  const bounds = computeTriangleSearchBounds(mesh, coordinateSpace);
  const searchIndex: TriangleSearchIndex = {
    bounds,
    columns: TRIANGLE_SEARCH_GRID_COLUMNS,
    rows: TRIANGLE_SEARCH_GRID_ROWS,
    buckets: Array.from({ length: TRIANGLE_SEARCH_GRID_COLUMNS * TRIANGLE_SEARCH_GRID_ROWS }, () => []),
  };

  for (let triangleIndex = 0; triangleIndex < mesh.triangles.length; triangleIndex += 1) {
    const triangleBounds = computeSingleTriangleBounds(mesh, triangleIndex, coordinateSpace);
    const minColumn = coordinateToBucket(triangleBounds.minX, bounds.minX, bounds.maxX, searchIndex.columns) ?? 0;
    const maxColumn = coordinateToBucket(triangleBounds.maxX, bounds.minX, bounds.maxX, searchIndex.columns) ?? searchIndex.columns - 1;
    const minRow = coordinateToBucket(triangleBounds.minY, bounds.minY, bounds.maxY, searchIndex.rows) ?? 0;
    const maxRow = coordinateToBucket(triangleBounds.maxY, bounds.minY, bounds.maxY, searchIndex.rows) ?? searchIndex.rows - 1;

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        searchIndex.buckets[bucketIndex(searchIndex, column, row)].push(triangleIndex);
      }
    }
  }

  return searchIndex;
}

function computeTriangleSearchBounds(mesh: PolygonMesh, coordinateSpace: TriangleCoordinateSpace): TriangleSearchBounds {
  const firstPoint = trianglePoint(mesh, mesh.triangles[0].a, coordinateSpace);
  const bounds: TriangleSearchBounds = {
    minX: firstPoint.x,
    minY: firstPoint.y,
    maxX: firstPoint.x,
    maxY: firstPoint.y,
  };

  for (const vertex of mesh.vertices) {
    const point = coordinateSpace === "original" ? toXY(vertex.position) : vertex.uv;
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  expandThinBounds(bounds);
  bounds.minX -= EPSILON;
  bounds.minY -= EPSILON;
  bounds.maxX += EPSILON;
  bounds.maxY += EPSILON;
  return bounds;
}

function computeSingleTriangleBounds(
  mesh: PolygonMesh,
  triangleIndex: number,
  coordinateSpace: TriangleCoordinateSpace,
): TriangleSearchBounds {
  const triangle = mesh.triangles[triangleIndex];
  const firstPoint = trianglePoint(mesh, triangle.a, coordinateSpace);
  const secondPoint = trianglePoint(mesh, triangle.b, coordinateSpace);
  const thirdPoint = trianglePoint(mesh, triangle.c, coordinateSpace);
  return {
    minX: Math.min(firstPoint.x, secondPoint.x, thirdPoint.x) - EPSILON,
    minY: Math.min(firstPoint.y, secondPoint.y, thirdPoint.y) - EPSILON,
    maxX: Math.max(firstPoint.x, secondPoint.x, thirdPoint.x) + EPSILON,
    maxY: Math.max(firstPoint.y, secondPoint.y, thirdPoint.y) + EPSILON,
  };
}

function expandThinBounds(bounds: TriangleSearchBounds): void {
  if (bounds.maxX - bounds.minX < EPSILON) {
    bounds.minX -= 0.5;
    bounds.maxX += 0.5;
  }

  if (bounds.maxY - bounds.minY < EPSILON) {
    bounds.minY -= 0.5;
    bounds.maxY += 0.5;
  }
}

function trianglePoint(mesh: PolygonMesh, vertexIndex: number, coordinateSpace: TriangleCoordinateSpace): Point2 {
  return coordinateSpace === "original" ? toXY(mesh.vertices[vertexIndex].position) : mesh.vertices[vertexIndex].uv;
}

function coordinateToBucket(value: number, minimum: number, maximum: number, bucketCount: number): number | null {
  if (value < minimum || value > maximum) {
    return null;
  }

  const normalizedValue = (value - minimum) / (maximum - minimum);
  return Math.max(0, Math.min(bucketCount - 1, Math.floor(normalizedValue * bucketCount)));
}

function bucketIndex(searchIndex: TriangleSearchIndex, column: number, row: number): number {
  return row * searchIndex.columns + column;
}

function interpolateUv(mesh: PolygonMesh, locatedTriangle: LocatedTriangle): Point2 {
  const triangle = mesh.triangles[locatedTriangle.triangleIndex];
  const firstPoint = mesh.vertices[triangle.a].uv;
  const secondPoint = mesh.vertices[triangle.b].uv;
  const thirdPoint = mesh.vertices[triangle.c].uv;
  const coordinates = locatedTriangle.coordinates;

  return makePoint2(
    coordinates.alpha * firstPoint.x + coordinates.beta * secondPoint.x + coordinates.gamma * thirdPoint.x,
    coordinates.alpha * firstPoint.y + coordinates.beta * secondPoint.y + coordinates.gamma * thirdPoint.y,
  );
}

function interpolateOriginalXY(mesh: PolygonMesh, locatedTriangle: LocatedTriangle): Point2 {
  const triangle = mesh.triangles[locatedTriangle.triangleIndex];
  const firstPoint = toXY(mesh.vertices[triangle.a].position);
  const secondPoint = toXY(mesh.vertices[triangle.b].position);
  const thirdPoint = toXY(mesh.vertices[triangle.c].position);
  const coordinates = locatedTriangle.coordinates;

  return makePoint2(
    coordinates.alpha * firstPoint.x + coordinates.beta * secondPoint.x + coordinates.gamma * thirdPoint.x,
    coordinates.alpha * firstPoint.y + coordinates.beta * secondPoint.y + coordinates.gamma * thirdPoint.y,
  );
}

export function phi(mesh: PolygonMesh, point: Point2): Point2 | null {
  const locatedTriangle = locateTriangleInOriginalMesh(mesh, point);
  if (locatedTriangle === null) {
    return null;
  }

  return interpolateUv(mesh, locatedTriangle);
}

export function phiInverse(mesh: PolygonMesh, point: Point2): Point2 | null {
  const locatedTriangle = locateTriangleInUvMesh(mesh, point);
  if (locatedTriangle === null) {
    return null;
  }

  return interpolateOriginalXY(mesh, locatedTriangle);
}

function solveDenseLinearSystem(inputMatrix: readonly (readonly number[])[], inputRightHandSide: readonly number[]): number[] {
  const rowCount = inputMatrix.length;
  const matrix = inputMatrix.map((row) => [...row]);
  const rightHandSide = [...inputRightHandSide];

  for (let pivotColumn = 0; pivotColumn < rowCount; pivotColumn += 1) {
    let pivotRow = pivotColumn;
    let pivotAbs = Math.abs(matrix[pivotColumn][pivotColumn]);

    for (let candidateRow = pivotColumn + 1; candidateRow < rowCount; candidateRow += 1) {
      const candidateAbs = Math.abs(matrix[candidateRow][pivotColumn]);
      if (candidateAbs > pivotAbs) {
        pivotAbs = candidateAbs;
        pivotRow = candidateRow;
      }
    }

    if (pivotAbs < EPSILON) {
      throw new Error("Singular linear system while computing Tutte embedding");
    }

    if (pivotRow !== pivotColumn) {
      const matrixSwap = matrix[pivotColumn];
      matrix[pivotColumn] = matrix[pivotRow];
      matrix[pivotRow] = matrixSwap;

      const rhsSwap = rightHandSide[pivotColumn];
      rightHandSide[pivotColumn] = rightHandSide[pivotRow];
      rightHandSide[pivotRow] = rhsSwap;
    }

    const pivotValue = matrix[pivotColumn][pivotColumn];
    for (let columnIndex = pivotColumn; columnIndex < rowCount; columnIndex += 1) {
      matrix[pivotColumn][columnIndex] /= pivotValue;
    }
    rightHandSide[pivotColumn] /= pivotValue;

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      if (rowIndex === pivotColumn) {
        continue;
      }

      const factor = matrix[rowIndex][pivotColumn];
      if (Math.abs(factor) < EPSILON) {
        continue;
      }

      for (let columnIndex = pivotColumn; columnIndex < rowCount; columnIndex += 1) {
        matrix[rowIndex][columnIndex] -= factor * matrix[pivotColumn][columnIndex];
      }
      rightHandSide[rowIndex] -= factor * rightHandSide[pivotColumn];
    }
  }

  return rightHandSide;
}

export function computeDiskParameterization(mesh: PolygonMesh): void {
  originalTriangleSearchIndexByMesh.delete(mesh);
  uvTriangleSearchIndexByMesh.delete(mesh);

  const boundaryVertices = new Set(mesh.boundaryLoop);
  let accumulatedLength = 0.0;
  const cumulativeLengths = [0.0];

  for (let loopIndex = 0; loopIndex < mesh.boundaryLoop.length; loopIndex += 1) {
    const firstVertex = mesh.boundaryLoop[loopIndex];
    const secondVertex = mesh.boundaryLoop[(loopIndex + 1) % mesh.boundaryLoop.length];
    const firstPoint = toXY(mesh.vertices[firstVertex].position);
    const secondPoint = toXY(mesh.vertices[secondVertex].position);
    accumulatedLength += length(subtract(secondPoint, firstPoint));
    cumulativeLengths.push(accumulatedLength);
  }

  if (accumulatedLength < EPSILON) {
    throw new Error("Boundary length is too small for disk parameterization");
  }

  for (let loopIndex = 0; loopIndex < mesh.boundaryLoop.length; loopIndex += 1) {
    const vertexIndex = mesh.boundaryLoop[loopIndex];
    const angle = TWO_PI * cumulativeLengths[loopIndex] / accumulatedLength;
    mesh.vertices[vertexIndex].uv = makePoint2(Math.cos(angle), Math.sin(angle));
  }

  const interiorVertices: number[] = [];
  const interiorIndexByVertex = new Map<number, number>();
  for (let vertexIndex = 0; vertexIndex < mesh.vertices.length; vertexIndex += 1) {
    if (!boundaryVertices.has(vertexIndex)) {
      interiorIndexByVertex.set(vertexIndex, interiorVertices.length);
      interiorVertices.push(vertexIndex);
    }
  }

  if (interiorVertices.length === 0) {
    return;
  }

  const matrix: number[][] = Array.from({ length: interiorVertices.length }, () => Array<number>(interiorVertices.length).fill(0.0));
  const rightHandSideX: number[] = Array<number>(interiorVertices.length).fill(0.0);
  const rightHandSideY: number[] = Array<number>(interiorVertices.length).fill(0.0);

  for (let localIndex = 0; localIndex < interiorVertices.length; localIndex += 1) {
    const vertexIndex = interiorVertices[localIndex];
    const neighbors = mesh.adjacency[vertexIndex];
    const weight = 1.0 / neighbors.length;
    matrix[localIndex][localIndex] = 1.0;

    for (const neighborIndex of neighbors) {
      if (boundaryVertices.has(neighborIndex)) {
        rightHandSideX[localIndex] += weight * mesh.vertices[neighborIndex].uv.x;
        rightHandSideY[localIndex] += weight * mesh.vertices[neighborIndex].uv.y;
      } else {
        const neighborLocalIndex = interiorIndexByVertex.get(neighborIndex);
        if (neighborLocalIndex === undefined) {
          throw new Error("Missing interior vertex index while computing Tutte embedding");
        }
        matrix[localIndex][neighborLocalIndex] -= weight;
      }
    }
  }

  const solutionX = solveDenseLinearSystem(matrix, rightHandSideX);
  const solutionY = solveDenseLinearSystem(matrix, rightHandSideY);

  for (let localIndex = 0; localIndex < interiorVertices.length; localIndex += 1) {
    const vertexIndex = interiorVertices[localIndex];
    mesh.vertices[vertexIndex].uv = makePoint2(solutionX[localIndex], solutionY[localIndex]);
  }
}
