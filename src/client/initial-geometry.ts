import { regularPolygonVertices } from "../render/polyline-overlay.js";
import {
  WARP_GEOMETRY_GROUPS,
  WARP_GEOMETRY_FORMAT,
  type WarpGeometry,
} from "../shared/warp-request.js";

export const OUTER_OCTAGON_RADIUS = 4.0;
export const INNER_OCTAGON_RADIUS = 2.8;

const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;

interface Point {
  readonly x: number;
  readonly y: number;
}

export function createInitialGeometry(renderWidth: number, renderHeight: number, includeGrid: boolean, includeDiagonals: boolean): WarpGeometry {
  const limit = visiblePlaneLimit(renderWidth, renderHeight);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" data-format="${escapeAttribute(WARP_GEOMETRY_FORMAT)}" viewBox="${escapeAttribute(`${(-limit).toFixed(2)} ${(-limit).toFixed(2)} ${(limit * 2).toFixed(2)} ${(limit * 2).toFixed(2)}`)}">`,
    renderPolylineGroup(WARP_GEOMETRY_GROUPS.outerBoundary, [regularPolygonVertices(8, OUTER_OCTAGON_RADIUS)]),
    renderPolylineGroup(WARP_GEOMETRY_GROUPS.innerBoundary, [regularPolygonVertices(8, INNER_OCTAGON_RADIUS)]),
  ];

  if (includeGrid) {
    const gridFamilies = createGridFamilies(limit);
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.horizontalGrid, gridFamilies.horizontal));
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.verticalGrid, gridFamilies.vertical));
  }

  if (includeDiagonals) {
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.diagonals, createDiagonalPolylines(OUTER_OCTAGON_RADIUS)));
  }

  parts.push("</svg>");
  return {
    format: WARP_GEOMETRY_FORMAT,
    svg: parts.join(""),
  };
}

function createGridFamilies(limit: number): { horizontal: Point[][]; vertical: Point[][] } {
  const horizontal: Point[][] = [];
  const vertical: Point[][] = [];
  const offsets = lineOffsets(limit);

  for (const offset of offsets) {
    horizontal.push([
      { x: -limit, y: offset },
      { x: limit, y: offset },
    ]);
    vertical.push([
      { x: offset, y: -limit },
      { x: offset, y: limit },
    ]);
  }

  return { horizontal, vertical };
}

function createDiagonalPolylines(outerRadius: number): Point[][] {
  const polylines: Point[][] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    polylines.push([
      { x: -cos * outerRadius, y: -sin * outerRadius },
      { x: cos * outerRadius, y: sin * outerRadius },
    ]);
  }
  return polylines;
}

function lineOffsets(limit: number): number[] {
  const values: number[] = [];
  const start = Math.floor(-limit);
  const end = Math.ceil(limit);
  for (let value = start; value <= end; value += GRID_LINE_SPACING) {
    values.push(value + GRID_LINE_OFFSET);
  }
  return values;
}

function visiblePlaneLimit(renderWidth: number, renderHeight: number): number {
  const xMax = 5 * renderWidth / renderHeight;
  return Math.max(xMax, 5);
}

function renderPolylineGroup(groupId: string, polylines: readonly Point[][]): string {
  const parts = [`<g id="${escapeAttribute(groupId)}">`];
  for (const polyline of polylines) {
    parts.push(`<polyline points="${escapeAttribute(polylinePoints(polyline))}" />`);
  }
  parts.push("</g>");
  return parts.join("");
}

function polylinePoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(" ");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}