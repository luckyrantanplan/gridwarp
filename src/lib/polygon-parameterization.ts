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

const UV_VERTEX_SEARCH_GRID_COLUMNS = 48;
const UV_VERTEX_SEARCH_GRID_ROWS = 48;

export interface SmoothPhiInverseSettings {
  readonly influenceRadius: number;
  readonly minimumNeighborCount: number;
  readonly maximumNeighborCount: number;
  readonly regularization: number;
  readonly boundaryBlendRadius: number;
}

interface LocatedTriangle {
  readonly triangleIndex: number;
  readonly coordinates: BarycentricCoordinates;
}

interface UvVertexSearchBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface UvVertexSearchIndex {
  readonly bounds: UvVertexSearchBounds;
  readonly columns: number;
  readonly rows: number;
  readonly buckets: number[][];
}

interface WeightedUvVertex {
  readonly vertexIndex: number;
  readonly distanceSquared: number;
}

const uvVertexSearchIndexByMesh = new WeakMap<PolygonMesh, UvVertexSearchIndex>();

function locateTriangleInOriginalMesh(mesh: PolygonMesh, point: Point2): LocatedTriangle | null {
  for (let triangleIndex = 0; triangleIndex < mesh.triangles.length; triangleIndex += 1) {
    const triangle = mesh.triangles[triangleIndex];
    const firstPoint = toXY(mesh.vertices[triangle.a].position);
    const secondPoint = toXY(mesh.vertices[triangle.b].position);
    const thirdPoint = toXY(mesh.vertices[triangle.c].position);
    const coordinates = barycentricCoordinates(point, firstPoint, secondPoint, thirdPoint);

    if (coordinates !== null && isInsideOrOnTriangle(coordinates)) {
      return { triangleIndex, coordinates };
    }
  }

  return null;
}

function locateTriangleInUvMesh(mesh: PolygonMesh, point: Point2): LocatedTriangle | null {
  for (let triangleIndex = 0; triangleIndex < mesh.triangles.length; triangleIndex += 1) {
    const triangle = mesh.triangles[triangleIndex];
    const firstPoint = mesh.vertices[triangle.a].uv;
    const secondPoint = mesh.vertices[triangle.b].uv;
    const thirdPoint = mesh.vertices[triangle.c].uv;
    const coordinates = barycentricCoordinates(point, firstPoint, secondPoint, thirdPoint);

    if (coordinates !== null && isInsideOrOnTriangle(coordinates)) {
      return { triangleIndex, coordinates };
    }
  }

  return null;
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

export function phiInverseSmooth(mesh: PolygonMesh, point: Point2, settings: SmoothPhiInverseSettings): Point2 | null {
  validateSmoothPhiInverseSettings(settings);
  const smoothPoint = movingLeastSquaresPhiInverse(mesh, point, settings);
  if (smoothPoint === null) {
    return phiInverse(mesh, point);
  }

  if (settings.boundaryBlendRadius <= EPSILON) {
    return smoothPoint;
  }

  const diskRadius = length(point);
  const blendStart = 1.0 - settings.boundaryBlendRadius;
  if (diskRadius <= blendStart) {
    return smoothPoint;
  }

  const exactPoint = phiInverse(mesh, point);
  if (exactPoint === null) {
    return smoothPoint;
  }

  const blendAmount = smootherstep(clamp((diskRadius - blendStart) / settings.boundaryBlendRadius, 0.0, 1.0));
  return makePoint2(
    smoothPoint.x * (1.0 - blendAmount) + exactPoint.x * blendAmount,
    smoothPoint.y * (1.0 - blendAmount) + exactPoint.y * blendAmount,
  );
}

function validateSmoothPhiInverseSettings(settings: SmoothPhiInverseSettings): void {
  if (!Number.isFinite(settings.influenceRadius) || settings.influenceRadius <= 0.0) {
    throw new Error("Smooth phi inverse influence radius must be positive");
  }

  if (!Number.isInteger(settings.minimumNeighborCount) || settings.minimumNeighborCount < 3) {
    throw new Error("Smooth phi inverse minimum neighbor count must be an integer of at least 3");
  }

  if (!Number.isInteger(settings.maximumNeighborCount) || settings.maximumNeighborCount < settings.minimumNeighborCount) {
    throw new Error("Smooth phi inverse maximum neighbor count must be at least the minimum");
  }

  if (!Number.isFinite(settings.regularization) || settings.regularization < 0.0) {
    throw new Error("Smooth phi inverse regularization must be non-negative");
  }

  if (!Number.isFinite(settings.boundaryBlendRadius) || settings.boundaryBlendRadius < 0.0) {
    throw new Error("Smooth phi inverse boundary blend radius must be non-negative");
  }
}

function movingLeastSquaresPhiInverse(mesh: PolygonMesh, point: Point2, settings: SmoothPhiInverseSettings): Point2 | null {
  const neighbors = findUvNeighbors(mesh, point, settings.influenceRadius, settings.minimumNeighborCount, settings.maximumNeighborCount);
  if (neighbors.length < 3) {
    return null;
  }

  for (const neighbor of neighbors) {
    if (neighbor.distanceSquared <= EPSILON * EPSILON) {
      return toXY(mesh.vertices[neighbor.vertexIndex].position);
    }
  }

  const supportRadius = Math.max(settings.influenceRadius, Math.sqrt(neighbors[neighbors.length - 1].distanceSquared) + EPSILON);
  const matrix: number[][] = Array.from({ length: 3 }, () => Array<number>(3).fill(0.0));
  const rightHandSideX = Array<number>(3).fill(0.0);
  const rightHandSideY = Array<number>(3).fill(0.0);
  let totalWeight = 0.0;

  for (const neighbor of neighbors) {
    const vertex = mesh.vertices[neighbor.vertexIndex];
    const uv = vertex.uv;
    const originalPoint = toXY(vertex.position);
    const localX = uv.x - point.x;
    const localY = uv.y - point.y;
    const distanceRatio = Math.sqrt(neighbor.distanceSquared) / supportRadius;
    const weight = wendlandWeight(distanceRatio);

    if (weight <= EPSILON) {
      continue;
    }

    const basis = [1.0, localX, localY];
    totalWeight += weight;
    for (let rowIndex = 0; rowIndex < basis.length; rowIndex += 1) {
      rightHandSideX[rowIndex] += weight * basis[rowIndex] * originalPoint.x;
      rightHandSideY[rowIndex] += weight * basis[rowIndex] * originalPoint.y;
      for (let columnIndex = 0; columnIndex < basis.length; columnIndex += 1) {
        matrix[rowIndex][columnIndex] += weight * basis[rowIndex] * basis[columnIndex];
      }
    }
  }

  if (totalWeight <= EPSILON) {
    return null;
  }

  matrix[1][1] += settings.regularization;
  matrix[2][2] += settings.regularization;

  try {
    const solutionX = solveDenseLinearSystem(matrix, rightHandSideX);
    const solutionY = solveDenseLinearSystem(matrix, rightHandSideY);
    return makePoint2(solutionX[0], solutionY[0]);
  } catch (error) {
    if (error instanceof Error) {
      return null;
    }
    throw error;
  }
}

function findUvNeighbors(
  mesh: PolygonMesh,
  point: Point2,
  influenceRadius: number,
  minimumNeighborCount: number,
  maximumNeighborCount: number,
): WeightedUvVertex[] {
  const searchIndex = getUvVertexSearchIndex(mesh);
  const minColumn = coordinateToBucket(point.x - influenceRadius, searchIndex.bounds.minX, searchIndex.bounds.maxX, searchIndex.columns) ?? 0;
  const maxColumn = coordinateToBucket(point.x + influenceRadius, searchIndex.bounds.minX, searchIndex.bounds.maxX, searchIndex.columns) ?? searchIndex.columns - 1;
  const minRow = coordinateToBucket(point.y - influenceRadius, searchIndex.bounds.minY, searchIndex.bounds.maxY, searchIndex.rows) ?? 0;
  const maxRow = coordinateToBucket(point.y + influenceRadius, searchIndex.bounds.minY, searchIndex.bounds.maxY, searchIndex.rows) ?? searchIndex.rows - 1;
  const candidateVertices = new Set<number>();

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      for (const vertexIndex of searchIndex.buckets[uvVertexBucketIndex(searchIndex, column, row)]) {
        candidateVertices.add(vertexIndex);
      }
    }
  }

  const radiusSquared = influenceRadius * influenceRadius;
  const neighbors: WeightedUvVertex[] = [];
  for (const vertexIndex of candidateVertices) {
    const distanceSquared = squaredDistance(point, mesh.vertices[vertexIndex].uv);
    if (distanceSquared <= radiusSquared) {
      neighbors.push({ vertexIndex, distanceSquared });
    }
  }

  if (neighbors.length < minimumNeighborCount) {
    return allUvVerticesByDistance(mesh, point).slice(0, maximumNeighborCount);
  }

  neighbors.sort(compareWeightedUvVertices);
  return neighbors.slice(0, maximumNeighborCount);
}

function getUvVertexSearchIndex(mesh: PolygonMesh): UvVertexSearchIndex {
  const existingIndex = uvVertexSearchIndexByMesh.get(mesh);
  if (existingIndex !== undefined) {
    return existingIndex;
  }

  const searchIndex = createUvVertexSearchIndex(mesh);
  uvVertexSearchIndexByMesh.set(mesh, searchIndex);
  return searchIndex;
}

function createUvVertexSearchIndex(mesh: PolygonMesh): UvVertexSearchIndex {
  const bounds = computeUvVertexSearchBounds(mesh);
  const searchIndex: UvVertexSearchIndex = {
    bounds,
    columns: UV_VERTEX_SEARCH_GRID_COLUMNS,
    rows: UV_VERTEX_SEARCH_GRID_ROWS,
    buckets: Array.from({ length: UV_VERTEX_SEARCH_GRID_COLUMNS * UV_VERTEX_SEARCH_GRID_ROWS }, () => []),
  };

  for (let vertexIndex = 0; vertexIndex < mesh.vertices.length; vertexIndex += 1) {
    const uv = mesh.vertices[vertexIndex].uv;
    const column = coordinateToBucket(uv.x, bounds.minX, bounds.maxX, searchIndex.columns);
    const row = coordinateToBucket(uv.y, bounds.minY, bounds.maxY, searchIndex.rows);
    if (column === null || row === null) {
      continue;
    }
    searchIndex.buckets[uvVertexBucketIndex(searchIndex, column, row)].push(vertexIndex);
  }

  return searchIndex;
}

function computeUvVertexSearchBounds(mesh: PolygonMesh): UvVertexSearchBounds {
  const firstPoint = mesh.vertices[0].uv;
  const bounds: UvVertexSearchBounds = {
    minX: firstPoint.x,
    minY: firstPoint.y,
    maxX: firstPoint.x,
    maxY: firstPoint.y,
  };

  for (const vertex of mesh.vertices) {
    bounds.minX = Math.min(bounds.minX, vertex.uv.x);
    bounds.minY = Math.min(bounds.minY, vertex.uv.y);
    bounds.maxX = Math.max(bounds.maxX, vertex.uv.x);
    bounds.maxY = Math.max(bounds.maxY, vertex.uv.y);
  }

  expandThinBounds(bounds);
  bounds.minX -= EPSILON;
  bounds.minY -= EPSILON;
  bounds.maxX += EPSILON;
  bounds.maxY += EPSILON;
  return bounds;
}

function expandThinBounds(bounds: UvVertexSearchBounds): void {
  if (bounds.maxX - bounds.minX < EPSILON) {
    bounds.minX -= 0.5;
    bounds.maxX += 0.5;
  }

  if (bounds.maxY - bounds.minY < EPSILON) {
    bounds.minY -= 0.5;
    bounds.maxY += 0.5;
  }
}

function allUvVerticesByDistance(mesh: PolygonMesh, point: Point2): WeightedUvVertex[] {
  const verticesByDistance: WeightedUvVertex[] = [];
  for (let vertexIndex = 0; vertexIndex < mesh.vertices.length; vertexIndex += 1) {
    verticesByDistance.push({
      vertexIndex,
      distanceSquared: squaredDistance(point, mesh.vertices[vertexIndex].uv),
    });
  }
  verticesByDistance.sort(compareWeightedUvVertices);
  return verticesByDistance;
}

function compareWeightedUvVertices(firstVertex: WeightedUvVertex, secondVertex: WeightedUvVertex): number {
  return firstVertex.distanceSquared - secondVertex.distanceSquared;
}

function squaredDistance(firstPoint: Point2, secondPoint: Point2): number {
  const dx = firstPoint.x - secondPoint.x;
  const dy = firstPoint.y - secondPoint.y;
  return dx * dx + dy * dy;
}

function wendlandWeight(distanceRatio: number): number {
  const clampedDistance = clamp(distanceRatio, 0.0, 1.0);
  const remaining = 1.0 - clampedDistance;
  return remaining * remaining * remaining * remaining * (4.0 * clampedDistance + 1.0);
}

function smootherstep(amount: number): number {
  return amount * amount * amount * (amount * (amount * 6.0 - 15.0) + 10.0);
}

function coordinateToBucket(value: number, minimum: number, maximum: number, bucketCount: number): number | null {
  if (value < minimum || value > maximum) {
    return null;
  }

  const normalizedValue = (value - minimum) / (maximum - minimum);
  return Math.max(0, Math.min(bucketCount - 1, Math.floor(normalizedValue * bucketCount)));
}

function uvVertexBucketIndex(searchIndex: UvVertexSearchIndex, column: number, row: number): number {
  return row * searchIndex.columns + column;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
  uvVertexSearchIndexByMesh.delete(mesh);

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
