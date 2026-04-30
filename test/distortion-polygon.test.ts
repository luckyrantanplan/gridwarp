import assert from "node:assert/strict";
import test from "node:test";

import {
  createPolygonMeshFromPoints,
  parseOff,
  parseSvgPolygonMesh,
  refinePolygonMesh,
  subdividePolygonForGrid,
  type PolygonMesh,
} from "../src/lib/polygon-mesh.js";
import {
  computeDiskParameterization,
  phi,
  phiInverse,
} from "../src/lib/polygon-parameterization.js";
import {
  countValidSamples,
  finalMap,
  sampleDisplacementField,
  type PerlinDiskShapeSettings,
} from "../src/lib/polygon-displacement-field.js";
import { DisplacementFieldWarpField } from "../src/lib/displacement-field-warp-field.js";
import type { Point2 } from "../src/lib/polygon-geometry.js";

const squareWithCenterOff = `OFF
5 4 0
0 0 0
1 0 0
1 1 0
0 1 0
0.5 0.5 0
3 0 1 4
3 1 2 4
3 2 3 4
3 3 0 4
`;

const settings: PerlinDiskShapeSettings = {
  frequency: 3.0,
  radialAmplitude: 0.08,
  rotationAmplitude: 0.75,
  vectorAmplitude: 0.04,
  falloffPower: 2.0,
};

const zeroSettings: PerlinDiskShapeSettings = {
  frequency: 3.0,
  radialAmplitude: 0.0,
  rotationAmplitude: 0.0,
  vectorAmplitude: 0.0,
  falloffPower: 2.0,
};

function approximatelyEqual(actual: number, expected: number, tolerance: number): void {
  const actualText = String(actual);
  const expectedText = String(expected);
  const toleranceText = String(tolerance);
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actualText} to be within ${toleranceText} of ${expectedText}`);
}

function pointsApproximatelyEqual(actual: Point2, expected: Point2, tolerance: number): void {
  approximatelyEqual(actual.x, expected.x, tolerance);
  approximatelyEqual(actual.y, expected.y, tolerance);
}

function makeParameterizedSquareMesh(): PolygonMesh {
  const mesh = parseOff(squareWithCenterOff);
  computeDiskParameterization(mesh);
  return mesh;
}

void test("parseOff builds a triangulated mesh with one boundary loop", () => {
  const mesh = parseOff(squareWithCenterOff);

  assert.equal(mesh.vertices.length, 5);
  assert.equal(mesh.triangles.length, 4);
  assert.equal(mesh.boundaryEdges.length, 4);
  assert.deepEqual(mesh.boundaryLoop, [0, 1, 2, 3]);
});

void test("parseOff rejects non-triangular faces", () => {
  const quadOff = `OFF
4 1 0
0 0 0
1 0 0
1 1 0
0 1 0
4 0 1 2 3
`;

  assert.throws(() => parseOff(quadOff), /Only triangulated OFF files are supported/);
});

void test("parseSvgPolygonMesh triangulates a closed polygon points list", () => {
  const svg = `<svg><polygon points="0,0 1,0 1,1 0,1" /></svg>`;
  const mesh = parseSvgPolygonMesh(svg);

  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.triangles.length, 2);
  assert.equal(mesh.boundaryEdges.length, 4);
});

void test("parseSvgPolygonMesh triangulates a closed path", () => {
  const svg = `<svg><path d="M 0 0 L 2 0 L 2 1 L 1 0.5 L 0 1 Z" /></svg>`;
  const mesh = parseSvgPolygonMesh(svg);

  assert.equal(mesh.vertices.length, 5);
  assert.equal(mesh.triangles.length, 3);
  assert.equal(mesh.boundaryEdges.length, 5);
});

void test("parseSvgPolygonMesh triangulates a closed polyline", () => {
  const svg = `<svg><polyline points="0 0 1 0 1 1 0 1 0 0" /></svg>`;
  const mesh = parseSvgPolygonMesh(svg);

  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.triangles.length, 2);
});

void test("createPolygonMeshFromPoints builds a generated octagon mesh", () => {
  const vertices = Array.from({ length: 8 }, (_unused, index) => {
    const angle = index * 2 * Math.PI / 8;
    return { x: Math.cos(angle) * 4, y: Math.sin(angle) * 4 };
  });
  const mesh = createPolygonMeshFromPoints(vertices);

  assert.equal(mesh.vertices.length, 8);
  assert.equal(mesh.triangles.length, 6);
  assert.equal(mesh.boundaryEdges.length, 8);
  assert.equal(mesh.boundaryLoop.length, 8);
});

void test("subdividePolygonForGrid splits square edges by grid spacing", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const points = subdividePolygonForGrid(square, {
    columns: 3,
    rows: 3,
    segmentLengthMultiplier: 1,
    minSegmentsPerEdge: 1,
    maxSegmentsPerEdge: 100,
  });

  assert.equal(points.length, 8);
  pointsApproximatelyEqual(points[0], { x: 0, y: 0 }, 1.0e-12);
  pointsApproximatelyEqual(points[1], { x: 0.5, y: 0 }, 1.0e-12);
  pointsApproximatelyEqual(points[2], { x: 1, y: 0 }, 1.0e-12);
});

void test("subdividePolygonForGrid allocates more samples to longer edges", () => {
  const rectangle = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 0, y: 1 },
  ];
  const points = subdividePolygonForGrid(rectangle, {
    columns: 5,
    rows: 5,
    segmentLengthMultiplier: 1,
    minSegmentsPerEdge: 1,
    maxSegmentsPerEdge: 100,
  });

  assert.equal(points.length, 40);
});

void test("subdividePolygonForGrid removes a repeated closing vertex", () => {
  const closedSquare = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 0 },
  ];
  const points = subdividePolygonForGrid(closedSquare, {
    columns: 3,
    rows: 3,
    segmentLengthMultiplier: 1,
    minSegmentsPerEdge: 1,
    maxSegmentsPerEdge: 100,
  });

  assert.equal(points.length, 8);
  assert.notDeepEqual(points[points.length - 1], points[0]);
});

void test("subdividePolygonForGrid increases density with grid resolution", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const coarsePoints = subdividePolygonForGrid(square, {
    columns: 3,
    rows: 3,
    segmentLengthMultiplier: 1,
    minSegmentsPerEdge: 1,
    maxSegmentsPerEdge: 100,
  });
  const finePoints = subdividePolygonForGrid(square, {
    columns: 5,
    rows: 5,
    segmentLengthMultiplier: 1,
    minSegmentsPerEdge: 1,
    maxSegmentsPerEdge: 100,
  });

  assert.ok(finePoints.length > coarsePoints.length);
});

void test("refinePolygonMesh subdivides triangles and preserves the boundary", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const mesh = createPolygonMeshFromPoints(square);
  const refinedMesh = refinePolygonMesh(mesh, { segmentsPerTriangleEdge: 2 });

  assert.equal(refinedMesh.vertices.length, 9);
  assert.equal(refinedMesh.triangles.length, 8);
  assert.equal(refinedMesh.boundaryEdges.length, 8);
  assert.equal(refinedMesh.boundaryLoop.length, 8);
});

void test("refinePolygonMesh gives disk parameterization interior vertices to solve", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const mesh = createPolygonMeshFromPoints(square);
  const refinedMesh = refinePolygonMesh(mesh, { segmentsPerTriangleEdge: 2 });
  computeDiskParameterization(refinedMesh);

  const boundaryVertices = new Set(refinedMesh.boundaryLoop);
  let interiorVertexCount = 0;
  let interiorVertexNearCenter = false;
  for (let vertexIndex = 0; vertexIndex < refinedMesh.vertices.length; vertexIndex += 1) {
    if (boundaryVertices.has(vertexIndex)) {
      continue;
    }

    interiorVertexCount += 1;
    const uv = refinedMesh.vertices[vertexIndex].uv;
    interiorVertexNearCenter = interiorVertexNearCenter || Math.hypot(uv.x, uv.y) < 0.5;
  }

  assert.equal(interiorVertexCount, 1);
  assert.equal(interiorVertexNearCenter, true);
});

void test("refinePolygonMesh rejects invalid refinement settings", () => {
  const mesh = createPolygonMeshFromPoints([
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);

  assert.throws(() => refinePolygonMesh(mesh, { segmentsPerTriangleEdge: 0 }), /at least 1/);
});

void test("computeDiskParameterization maps the boundary to the unit circle and the center near the origin", () => {
  const mesh = makeParameterizedSquareMesh();

  for (const vertexIndex of mesh.boundaryLoop) {
    const uv = mesh.vertices[vertexIndex].uv;
    approximatelyEqual(Math.hypot(uv.x, uv.y), 1.0, 1.0e-12);
  }

  pointsApproximatelyEqual(mesh.vertices[4].uv, { x: 0.0, y: 0.0 }, 1.0e-12);
});

void test("phi and phiInverse map the square center through the disk center", () => {
  const mesh = makeParameterizedSquareMesh();
  const center = { x: 0.5, y: 0.5 };
  const diskCenter = phi(mesh, center);

  assert.ok(diskCenter !== null);
  pointsApproximatelyEqual(diskCenter, { x: 0.0, y: 0.0 }, 1.0e-12);

  const originalCenter = phiInverse(mesh, diskCenter);
  assert.ok(originalCenter !== null);
  pointsApproximatelyEqual(originalCenter, center, 1.0e-12);
});

void test("finalMap preserves boundary points", () => {
  const mesh = makeParameterizedSquareMesh();
  const boundaryPoint = { x: 0.25, y: 0.0 };
  const mappedPoint = finalMap(mesh, boundaryPoint, settings);

  assert.ok(mappedPoint !== null);
  pointsApproximatelyEqual(mappedPoint, boundaryPoint, 1.0e-12);
});

void test("sampleDisplacementField creates typed arrays and validity mask", () => {
  const mesh = makeParameterizedSquareMesh();
  const field = sampleDisplacementField(mesh, settings, 8, 8);

  assert.equal(field.width, 8);
  assert.equal(field.height, 8);
  assert.equal(field.values.length, 8 * 8 * 2);
  assert.equal(field.valid.length, 8 * 8);
  assert.ok(field.values instanceof Float64Array);
  assert.ok(field.valid instanceof Uint8Array);
  assert.equal(countValidSamples(field), 64);
});

void test("sampleDisplacementField works from an SVG polygon mesh", () => {
  const svg = `<svg><path d="M 0 0 H 1 V 1 H 0 Z" /></svg>`;
  const mesh = parseSvgPolygonMesh(svg);
  computeDiskParameterization(mesh);
  const field = sampleDisplacementField(mesh, settings, 6, 6);

  assert.equal(field.width, 6);
  assert.equal(field.height, 6);
  assert.equal(field.values.length, 6 * 6 * 2);
  assert.ok(countValidSamples(field) > 0);
});

void test("sampleDisplacementField rejects invalid grid sizes", () => {
  const mesh = makeParameterizedSquareMesh();

  assert.throws(() => sampleDisplacementField(mesh, settings, 1, 8), /at least 2/);
  assert.throws(() => sampleDisplacementField(mesh, settings, 8, 1), /at least 2/);
});

void test("DisplacementFieldWarpField exposes sampled displacement as a screen warp", () => {
  const mesh = makeParameterizedSquareMesh();
  const field = sampleDisplacementField(mesh, zeroSettings, 8, 8);
  const warp = new DisplacementFieldWarpField(100, 100, field, 1);

  const value = warp.valueAt(55, 45);

  approximatelyEqual(value.warpedX, 0.5, 1.0e-12);
  approximatelyEqual(value.warpedY, 0.5, 1.0e-12);
  assert.deepEqual(warp.bounds(), { width: 100, height: 100 });
});
