import {
  EPSILON,
  add,
  cross,
  length,
  makePoint2,
  makePoint3,
  normalizeClosedPolygon,
  pointInTriangle,
  subtract,
  type Point2,
  type Point3,
  type Triangle,
} from "./polygon-geometry.js";

export interface PolygonVertex {
  readonly position: Point3;
  uv: Point2;
}

export interface PolygonMesh {
  readonly vertices: PolygonVertex[];
  readonly triangles: Triangle[];
  readonly adjacency: number[][];
  readonly boundaryEdges: [number, number][];
  readonly boundaryLoop: number[];
}

export interface PolygonTriangulation {
  readonly points: Point2[];
  readonly triangles: Triangle[];
}

export interface PolygonGridSubdivisionSettings {
  readonly columns: number;
  readonly rows: number;
  readonly segmentLengthMultiplier: number;
  readonly minSegmentsPerEdge: number;
  readonly maxSegmentsPerEdge: number;
}

export interface PolygonMeshRefinementSettings {
  readonly segmentsPerTriangleEdge: number;
}

interface PolygonBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function edgeKey(firstVertex: number, secondVertex: number): string {
  const lowerVertex = Math.min(firstVertex, secondVertex);
  const upperVertex = Math.max(firstVertex, secondVertex);
  return `${String(lowerVertex)}:${String(upperVertex)}`;
}

function parsePointList(pointsText: string): Point2[] {
  const values = pointsText.trim().split(/[\s,]+/).filter((value) => value.length > 0).map(Number.parseFloat);
  if (values.length < 6 || values.length % 2 !== 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Invalid SVG point list");
  }

  const points: Point2[] = [];
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 2) {
    points.push(makePoint2(values[valueIndex], values[valueIndex + 1]));
  }
  return normalizeClosedPolygon(points);
}

function isPathCommand(token: string): boolean {
  return /^[MmLlHhVvZz]$/.test(token);
}

function parseSvgPathData(pathData: string): Point2[] {
  const tokens = pathData.match(/[MmLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (tokens === null) {
    throw new Error("Invalid SVG path data");
  }

  const points: Point2[] = [];
  let tokenIndex = 0;
  let command: string | null = null;
  let currentPoint = makePoint2(0.0, 0.0);
  let startPoint: Point2 | null = null;

  while (tokenIndex < tokens.length) {
    if (isPathCommand(tokens[tokenIndex])) {
      command = tokens[tokenIndex];
      tokenIndex += 1;
    }

    if (command === null) {
      throw new Error("SVG path data must begin with a command");
    }

    if (command === "Z" || command === "z") {
      if (startPoint !== null) {
        currentPoint = startPoint;
      }
      command = null;
      continue;
    }

    if (command === "M" || command === "m") {
      if (tokenIndex + 1 >= tokens.length || isPathCommand(tokens[tokenIndex]) || isPathCommand(tokens[tokenIndex + 1])) {
        throw new Error("Invalid SVG moveto command");
      }

      const xCoordinate = Number.parseFloat(tokens[tokenIndex]);
      const yCoordinate = Number.parseFloat(tokens[tokenIndex + 1]);
      tokenIndex += 2;
      currentPoint = command === "m"
        ? add(currentPoint, makePoint2(xCoordinate, yCoordinate))
        : makePoint2(xCoordinate, yCoordinate);
      startPoint = currentPoint;
      points.push(currentPoint);
      command = command === "m" ? "l" : "L";
      continue;
    }

    if (command === "L" || command === "l") {
      if (tokenIndex + 1 >= tokens.length || isPathCommand(tokens[tokenIndex]) || isPathCommand(tokens[tokenIndex + 1])) {
        throw new Error("Invalid SVG lineto command");
      }

      const xCoordinate = Number.parseFloat(tokens[tokenIndex]);
      const yCoordinate = Number.parseFloat(tokens[tokenIndex + 1]);
      tokenIndex += 2;
      currentPoint = command === "l"
        ? add(currentPoint, makePoint2(xCoordinate, yCoordinate))
        : makePoint2(xCoordinate, yCoordinate);
      points.push(currentPoint);
      continue;
    }

    if (command === "H" || command === "h") {
      if (tokenIndex >= tokens.length || isPathCommand(tokens[tokenIndex])) {
        throw new Error("Invalid SVG horizontal lineto command");
      }

      const xCoordinate = Number.parseFloat(tokens[tokenIndex]);
      tokenIndex += 1;
      currentPoint = command === "h"
        ? makePoint2(currentPoint.x + xCoordinate, currentPoint.y)
        : makePoint2(xCoordinate, currentPoint.y);
      points.push(currentPoint);
      continue;
    }

    if (command === "V" || command === "v") {
      if (tokenIndex >= tokens.length || isPathCommand(tokens[tokenIndex])) {
        throw new Error("Invalid SVG vertical lineto command");
      }

      const yCoordinate = Number.parseFloat(tokens[tokenIndex]);
      tokenIndex += 1;
      currentPoint = command === "v"
        ? makePoint2(currentPoint.x, currentPoint.y + yCoordinate)
        : makePoint2(currentPoint.x, yCoordinate);
      points.push(currentPoint);
      continue;
    }

    throw new Error(`Unsupported SVG path command: ${command}`);
  }

  return normalizeClosedPolygon(points);
}

function extractSvgPolygonPoints(content: string): Point2[] {
  const pointListMatch = /<(?:polygon|polyline)\b[^>]*\bpoints\s*=\s*(["'])(.*?)\1/is.exec(content);
  if (pointListMatch !== null) {
    return parsePointList(pointListMatch[2]);
  }

  const pathMatch = /<path\b[^>]*\bd\s*=\s*(["'])(.*?)\1/is.exec(content);
  if (pathMatch !== null) {
    return parseSvgPathData(pathMatch[2]);
  }

  throw new Error("Expected an SVG polygon, polyline, or path element");
}

export function triangulatePolygonPoints(points: readonly Point2[]): PolygonTriangulation {
  const polygonPoints = normalizeClosedPolygon(points);
  const remainingIndices = Array.from({ length: polygonPoints.length }, (_unused, index) => index);
  const triangles: Triangle[] = [];

  while (remainingIndices.length > 3) {
    let earFound = false;

    for (let localIndex = 0; localIndex < remainingIndices.length; localIndex += 1) {
      const previousIndex = remainingIndices[(localIndex + remainingIndices.length - 1) % remainingIndices.length];
      const currentIndex = remainingIndices[localIndex];
      const nextIndex = remainingIndices[(localIndex + 1) % remainingIndices.length];
      const previousPoint = polygonPoints[previousIndex];
      const currentPoint = polygonPoints[currentIndex];
      const nextPoint = polygonPoints[nextIndex];
      const turn = cross(subtract(currentPoint, previousPoint), subtract(nextPoint, currentPoint));

      if (turn <= EPSILON) {
        continue;
      }

      let containsOtherVertex = false;
      for (const candidateIndex of remainingIndices) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) {
          continue;
        }

        if (pointInTriangle(polygonPoints[candidateIndex], previousPoint, currentPoint, nextPoint)) {
          containsOtherVertex = true;
          break;
        }
      }

      if (containsOtherVertex) {
        continue;
      }

      triangles.push({ a: previousIndex, b: currentIndex, c: nextIndex });
      remainingIndices.splice(localIndex, 1);
      earFound = true;
      break;
    }

    if (!earFound) {
      throw new Error("Could not triangulate SVG polygon; expected a simple non-self-intersecting polygon");
    }
  }

  triangles.push({ a: remainingIndices[0], b: remainingIndices[1], c: remainingIndices[2] });
  return { points: polygonPoints, triangles };
}

export function parseSvgPolygonMesh(content: string): PolygonMesh {
  const polygonPoints = extractSvgPolygonPoints(content);
  return createPolygonMeshFromPoints(polygonPoints);
}

export function createPolygonMeshFromPoints(points: readonly Point2[]): PolygonMesh {
  const triangulation = triangulatePolygonPoints(points);
  const vertices = triangulation.points.map((point): PolygonVertex => ({
    position: makePoint3(point.x, point.y, 0.0),
    uv: makePoint2(0.0, 0.0),
  }));
  return buildMesh(vertices, triangulation.triangles);
}

export function subdividePolygonForGrid(
  points: readonly Point2[],
  settings: PolygonGridSubdivisionSettings,
): Point2[] {
  validatePolygonGridSubdivisionSettings(settings);
  const polygonPoints = normalizeClosedPolygon(points);
  const bounds = polygonBoundsFromPoints(polygonPoints);
  const stepX = (bounds.maxX - bounds.minX) / (settings.columns - 1);
  const stepY = (bounds.maxY - bounds.minY) / (settings.rows - 1);
  const targetSegmentLength = Math.min(stepX, stepY) * settings.segmentLengthMultiplier;

  if (!Number.isFinite(targetSegmentLength) || targetSegmentLength < EPSILON) {
    throw new Error("Polygon grid subdivision target segment length is too small");
  }

  const subdividedPoints: Point2[] = [];
  for (let pointIndex = 0; pointIndex < polygonPoints.length; pointIndex += 1) {
    const firstPoint = polygonPoints[pointIndex];
    const secondPoint = polygonPoints[(pointIndex + 1) % polygonPoints.length];
    const edgeLength = length(subtract(secondPoint, firstPoint));
    const segmentCount = clampInteger(
      Math.ceil(edgeLength / targetSegmentLength),
      settings.minSegmentsPerEdge,
      settings.maxSegmentsPerEdge,
    );

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const fraction = segmentIndex / segmentCount;
      subdividedPoints.push(makePoint2(
        firstPoint.x + (secondPoint.x - firstPoint.x) * fraction,
        firstPoint.y + (secondPoint.y - firstPoint.y) * fraction,
      ));
    }
  }

  return subdividedPoints;
}

export function refinePolygonMesh(mesh: PolygonMesh, settings: PolygonMeshRefinementSettings): PolygonMesh {
  validatePolygonMeshRefinementSettings(settings);
  const vertices: PolygonVertex[] = [];
  const vertexIndexByKey = new Map<string, number>();
  const triangles: Triangle[] = [];

  for (const triangle of mesh.triangles) {
    const localVertexIndices = createRefinedTriangleVertices(mesh, triangle, settings.segmentsPerTriangleEdge, vertices, vertexIndexByKey);

    for (let firstIndex = 0; firstIndex < settings.segmentsPerTriangleEdge; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < settings.segmentsPerTriangleEdge - firstIndex; secondIndex += 1) {
        triangles.push({
          a: localVertexIndices.get(localTriangleKey(firstIndex, secondIndex)) ?? missingRefinedTriangleVertex(),
          b: localVertexIndices.get(localTriangleKey(firstIndex + 1, secondIndex)) ?? missingRefinedTriangleVertex(),
          c: localVertexIndices.get(localTriangleKey(firstIndex, secondIndex + 1)) ?? missingRefinedTriangleVertex(),
        });

        if (firstIndex + secondIndex < settings.segmentsPerTriangleEdge - 1) {
          triangles.push({
            a: localVertexIndices.get(localTriangleKey(firstIndex + 1, secondIndex)) ?? missingRefinedTriangleVertex(),
            b: localVertexIndices.get(localTriangleKey(firstIndex + 1, secondIndex + 1)) ?? missingRefinedTriangleVertex(),
            c: localVertexIndices.get(localTriangleKey(firstIndex, secondIndex + 1)) ?? missingRefinedTriangleVertex(),
          });
        }
      }
    }
  }

  return buildMesh(vertices, triangles);
}

function validatePolygonMeshRefinementSettings(settings: PolygonMeshRefinementSettings): void {
  if (!Number.isInteger(settings.segmentsPerTriangleEdge) || settings.segmentsPerTriangleEdge < 1) {
    throw new Error("Polygon mesh refinement segments per triangle edge must be an integer of at least 1");
  }
}

function createRefinedTriangleVertices(
  mesh: PolygonMesh,
  triangle: Triangle,
  segmentsPerTriangleEdge: number,
  vertices: PolygonVertex[],
  vertexIndexByKey: Map<string, number>,
): Map<string, number> {
  const localVertexIndices = new Map<string, number>();
  const firstPosition = mesh.vertices[triangle.a].position;
  const secondPosition = mesh.vertices[triangle.b].position;
  const thirdPosition = mesh.vertices[triangle.c].position;

  for (let firstIndex = 0; firstIndex <= segmentsPerTriangleEdge; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex <= segmentsPerTriangleEdge - firstIndex; secondIndex += 1) {
      const point = interpolateTrianglePoint(firstPosition, secondPosition, thirdPosition, firstIndex, secondIndex, segmentsPerTriangleEdge);
      const vertexIndex = getOrCreateRefinedVertex(vertices, vertexIndexByKey, point);
      localVertexIndices.set(localTriangleKey(firstIndex, secondIndex), vertexIndex);
    }
  }

  return localVertexIndices;
}

function interpolateTrianglePoint(
  firstPoint: Point3,
  secondPoint: Point3,
  thirdPoint: Point3,
  firstIndex: number,
  secondIndex: number,
  segmentsPerTriangleEdge: number,
): Point3 {
  const secondWeight = firstIndex / segmentsPerTriangleEdge;
  const thirdWeight = secondIndex / segmentsPerTriangleEdge;
  const firstWeight = 1.0 - secondWeight - thirdWeight;
  return makePoint3(
    firstWeight * firstPoint.x + secondWeight * secondPoint.x + thirdWeight * thirdPoint.x,
    firstWeight * firstPoint.y + secondWeight * secondPoint.y + thirdWeight * thirdPoint.y,
    firstWeight * firstPoint.z + secondWeight * secondPoint.z + thirdWeight * thirdPoint.z,
  );
}

function getOrCreateRefinedVertex(
  vertices: PolygonVertex[],
  vertexIndexByKey: Map<string, number>,
  point: Point3,
): number {
  const key = refinedVertexKey(point);
  const existingIndex = vertexIndexByKey.get(key);
  if (existingIndex !== undefined) {
    return existingIndex;
  }

  const vertexIndex = vertices.length;
  vertices.push({ position: point, uv: makePoint2(0.0, 0.0) });
  vertexIndexByKey.set(key, vertexIndex);
  return vertexIndex;
}

function refinedVertexKey(point: Point3): string {
  return `${String(quantizedCoordinate(point.x))}:${String(quantizedCoordinate(point.y))}:${String(quantizedCoordinate(point.z))}`;
}

function quantizedCoordinate(value: number): number {
  return Math.round(value / (EPSILON * 100.0));
}

function localTriangleKey(firstIndex: number, secondIndex: number): string {
  return `${String(firstIndex)}:${String(secondIndex)}`;
}

function missingRefinedTriangleVertex(): never {
  throw new Error("Missing refined triangle vertex");
}

function validatePolygonGridSubdivisionSettings(settings: PolygonGridSubdivisionSettings): void {
  if (!Number.isInteger(settings.columns) || settings.columns < 2) {
    throw new Error("Polygon grid subdivision columns must be an integer of at least 2");
  }

  if (!Number.isInteger(settings.rows) || settings.rows < 2) {
    throw new Error("Polygon grid subdivision rows must be an integer of at least 2");
  }

  if (!Number.isFinite(settings.segmentLengthMultiplier) || settings.segmentLengthMultiplier <= 0.0) {
    throw new Error("Polygon grid subdivision segment length multiplier must be positive");
  }

  if (!Number.isInteger(settings.minSegmentsPerEdge) || settings.minSegmentsPerEdge < 1) {
    throw new Error("Polygon grid subdivision minimum segments per edge must be an integer of at least 1");
  }

  if (!Number.isInteger(settings.maxSegmentsPerEdge) || settings.maxSegmentsPerEdge < settings.minSegmentsPerEdge) {
    throw new Error("Polygon grid subdivision maximum segments per edge must be at least the minimum");
  }
}

function polygonBoundsFromPoints(points: readonly Point2[]): PolygonBounds {
  const initialPoint = points[0];
  const bounds = {
    minX: initialPoint.x,
    minY: initialPoint.y,
    maxX: initialPoint.x,
    maxY: initialPoint.y,
  };

  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }

  return bounds;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function parseOff(content: string): PolygonMesh {
  const tokens = content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .split(/\s+/);

  let tokenIndex = 0;
  const header = tokens[tokenIndex];
  tokenIndex += 1;

  if (header !== "OFF") {
    throw new Error("Expected OFF header");
  }

  const vertexCount = Number.parseInt(tokens[tokenIndex], 10);
  tokenIndex += 1;
  const faceCount = Number.parseInt(tokens[tokenIndex], 10);
  tokenIndex += 1;
  tokenIndex += 1;

  if (!Number.isInteger(vertexCount) || !Number.isInteger(faceCount)) {
    throw new Error("Invalid OFF counts");
  }

  const vertices: PolygonVertex[] = [];
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    const xCoordinate = Number.parseFloat(tokens[tokenIndex]);
    tokenIndex += 1;
    const yCoordinate = Number.parseFloat(tokens[tokenIndex]);
    tokenIndex += 1;
    const zCoordinate = Number.parseFloat(tokens[tokenIndex]);
    tokenIndex += 1;
    vertices.push({ position: makePoint3(xCoordinate, yCoordinate, zCoordinate), uv: makePoint2(0.0, 0.0) });
  }

  const triangles: Triangle[] = [];
  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const degree = Number.parseInt(tokens[tokenIndex], 10);
    tokenIndex += 1;

    if (degree !== 3) {
      throw new Error("Only triangulated OFF files are supported");
    }

    const firstVertex = Number.parseInt(tokens[tokenIndex], 10);
    tokenIndex += 1;
    const secondVertex = Number.parseInt(tokens[tokenIndex], 10);
    tokenIndex += 1;
    const thirdVertex = Number.parseInt(tokens[tokenIndex], 10);
    tokenIndex += 1;
    triangles.push({ a: firstVertex, b: secondVertex, c: thirdVertex });
  }

  if (vertices.length === 0 || triangles.length === 0) {
    throw new Error("Expected a non-empty triangulated mesh");
  }

  return buildMesh(vertices, triangles);
}

function addNeighbor(adjacency: Set<number>[], firstVertex: number, secondVertex: number): void {
  adjacency[firstVertex].add(secondVertex);
  adjacency[secondVertex].add(firstVertex);
}

export function buildMesh(vertices: PolygonVertex[], triangles: Triangle[]): PolygonMesh {
  const adjacencySets = Array.from({ length: vertices.length }, () => new Set<number>());
  const edgeCounts = new Map<string, number>();

  for (const triangle of triangles) {
    const triangleEdges: [number, number][] = [
      [triangle.a, triangle.b],
      [triangle.b, triangle.c],
      [triangle.c, triangle.a],
    ];

    for (const [firstVertex, secondVertex] of triangleEdges) {
      addNeighbor(adjacencySets, firstVertex, secondVertex);
      const key = edgeKey(firstVertex, secondVertex);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }

  const boundaryEdges: [number, number][] = [];
  for (const [key, count] of edgeCounts.entries()) {
    if (count === 1) {
      const [firstVertexText, secondVertexText] = key.split(":");
      boundaryEdges.push([Number.parseInt(firstVertexText, 10), Number.parseInt(secondVertexText, 10)]);
    }
  }

  if (boundaryEdges.length === 0) {
    throw new Error("Expected a mesh with a boundary");
  }

  return {
    vertices,
    triangles,
    adjacency: adjacencySets.map((neighbors) => Array.from(neighbors)),
    boundaryEdges,
    boundaryLoop: orderBoundaryLoop(boundaryEdges),
  };
}

function orderBoundaryLoop(boundaryEdges: readonly (readonly [number, number])[]): number[] {
  const boundaryAdjacency = new Map<number, number[]>();

  for (const [firstVertex, secondVertex] of boundaryEdges) {
    getOrCreateBoundaryNeighbors(boundaryAdjacency, firstVertex).push(secondVertex);
    getOrCreateBoundaryNeighbors(boundaryAdjacency, secondVertex).push(firstVertex);
  }

  for (const [vertexIndex, neighbors] of boundaryAdjacency.entries()) {
    if (neighbors.length !== 2) {
      throw new Error(`Boundary is not a single simple loop near vertex ${String(vertexIndex)}`);
    }
  }

  const startVertex = boundaryEdges[0][0];
  const loop: number[] = [];
  let previousVertex = -1;
  let currentVertex = startVertex;
  let loopClosed = false;

  while (!loopClosed) {
    loop.push(currentVertex);
    const neighbors = getOrCreateBoundaryNeighbors(boundaryAdjacency, currentVertex);
    const nextVertex = neighbors[0] === previousVertex ? neighbors[1] : neighbors[0];

    previousVertex = currentVertex;
    currentVertex = nextVertex;

    if (currentVertex === startVertex) {
      loopClosed = true;
    }

    if (loop.length > boundaryEdges.length) {
      throw new Error("Could not order boundary loop");
    }
  }

  if (loop.length !== boundaryEdges.length) {
    throw new Error("Expected exactly one boundary component");
  }

  return loop;
}

function getOrCreateBoundaryNeighbors(boundaryAdjacency: Map<number, number[]>, vertexIndex: number): number[] {
  const existingNeighbors = boundaryAdjacency.get(vertexIndex);
  if (existingNeighbors !== undefined) {
    return existingNeighbors;
  }

  const neighbors: number[] = [];
  boundaryAdjacency.set(vertexIndex, neighbors);
  return neighbors;
}
