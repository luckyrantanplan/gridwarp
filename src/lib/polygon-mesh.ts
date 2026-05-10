import {
  EPSILON,
  add,
  cross,
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
