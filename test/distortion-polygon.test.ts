import assert from "node:assert/strict";
import test from "node:test";

import {
  createPolygonMeshFromPoints,
  parseOff,
  parseSvgPolygonMesh,
  type PolygonMesh,
} from "../src/lib/polygon-mesh.js";
import {
  computeDiskParameterization,
  phi,
  phiInverse,
  phiInverseSmooth,
  type SmoothPhiInverseSettings,
} from "../src/lib/polygon-parameterization.js";
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

const smoothInverseSettings: SmoothPhiInverseSettings = {
  influenceRadius: 1.5,
  minimumNeighborCount: 3,
  maximumNeighborCount: 5,
  regularization: 1.0e-10,
  boundaryBlendRadius: 0.1,
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

void test("phiInverseSmooth reconstructs the center and boundary vertices", () => {
  const mesh = makeParameterizedSquareMesh();
  const center = phiInverseSmooth(mesh, { x: 0.0, y: 0.0 }, smoothInverseSettings);
  const boundaryVertex = phiInverseSmooth(mesh, mesh.vertices[0].uv, smoothInverseSettings);

  assert.ok(center !== null);
  assert.ok(boundaryVertex !== null);
  pointsApproximatelyEqual(center, { x: 0.5, y: 0.5 }, 1.0e-10);
  pointsApproximatelyEqual(boundaryVertex, { x: 0.0, y: 0.0 }, 1.0e-12);
});
