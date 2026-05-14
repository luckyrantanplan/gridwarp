import { regularPolygonVertices } from "../render/polyline-overlay.js";
import {
  WARP_GEOMETRY_GROUPS,
  WARP_GEOMETRY_FORMAT,
  WARP_GEOMETRY_PRESENTATION,
  type WarpGeometryPresentation,
  type WarpGeometry,
} from "../shared/warp-request.js";

export const OUTER_OCTAGON_RADIUS = 4.0;
export const INNER_OCTAGON_RADIUS = 2.8;
export const WORLD_WIDTH = 24.0;
export const WORLD_HEIGHT = 24.0;

const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function createInitialGeometry(renderWidth: number, renderHeight: number, includeGrid: boolean, includeDiagonals: boolean): WarpGeometry {
  const worldBounds = createWorldBounds();
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" data-format="${escapeAttribute(WARP_GEOMETRY_FORMAT)}" viewBox="${escapeAttribute(viewBoxValue(worldBounds))}">`,
    renderPolylineGroup(WARP_GEOMETRY_GROUPS.outerBoundary, [closePolyline(regularPolygonVertices(8, OUTER_OCTAGON_RADIUS))], WARP_GEOMETRY_PRESENTATION[WARP_GEOMETRY_GROUPS.outerBoundary]),
    renderPolylineGroup(WARP_GEOMETRY_GROUPS.innerBoundary, [closePolyline(regularPolygonVertices(8, INNER_OCTAGON_RADIUS))], WARP_GEOMETRY_PRESENTATION[WARP_GEOMETRY_GROUPS.innerBoundary]),
  ];

  if (includeGrid) {
    const gridFamilies = createGridFamilies(worldBounds);
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.horizontalGrid, gridFamilies.horizontal, WARP_GEOMETRY_PRESENTATION[WARP_GEOMETRY_GROUPS.horizontalGrid]));
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.verticalGrid, gridFamilies.vertical, WARP_GEOMETRY_PRESENTATION[WARP_GEOMETRY_GROUPS.verticalGrid]));
  }

  if (includeDiagonals) {
    parts.push(renderPolylineGroup(WARP_GEOMETRY_GROUPS.diagonals, createDiagonalPolylines(OUTER_OCTAGON_RADIUS), WARP_GEOMETRY_PRESENTATION[WARP_GEOMETRY_GROUPS.diagonals]));
  }

  parts.push("</svg>");
  return {
    format: WARP_GEOMETRY_FORMAT,
    svg: parts.join(""),
  };
}

function createGridFamilies(worldBounds: WorldBounds): { horizontal: Point[][]; vertical: Point[][] } {
  const horizontal: Point[][] = [];
  const vertical: Point[][] = [];
  const horizontalOffsets = lineOffsets(worldBounds.minY, worldBounds.maxY);
  const verticalOffsets = lineOffsets(worldBounds.minX, worldBounds.maxX);

  for (const offset of horizontalOffsets) {
    horizontal.push([
      { x: worldBounds.minX, y: offset },
      { x: worldBounds.maxX, y: offset },
    ]);
  }

  for (const offset of verticalOffsets) {
    vertical.push([
      { x: offset, y: worldBounds.minY },
      { x: offset, y: worldBounds.maxY },
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

function lineOffsets(minimum: number, maximum: number): number[] {
  const values: number[] = [];
  const firstIndex = Math.ceil((minimum - GRID_LINE_OFFSET) / GRID_LINE_SPACING);
  const lastIndex = Math.floor((maximum - GRID_LINE_OFFSET) / GRID_LINE_SPACING);
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    values.push(index * GRID_LINE_SPACING + GRID_LINE_OFFSET);
  }
  return values;
}

function createWorldBounds(): WorldBounds {
  return {
    minX: -0.5 * WORLD_WIDTH,
    minY: -0.5 * WORLD_HEIGHT,
    maxX: 0.5 * WORLD_WIDTH,
    maxY: 0.5 * WORLD_HEIGHT,
  };
}

function viewBoxValue(worldBounds: WorldBounds): string {
  return `${worldBounds.minX.toFixed(2)} ${worldBounds.minY.toFixed(2)} ${(worldBounds.maxX - worldBounds.minX).toFixed(2)} ${(worldBounds.maxY - worldBounds.minY).toFixed(2)}`;
}

function renderPolylineGroup(groupId: string, polylines: readonly Point[][], presentation: WarpGeometryPresentation): string {
  const parts = [`<g id="${escapeAttribute(groupId)}">`];
  for (const polyline of polylines) {
    parts.push(`<polyline ${presentationAttributes(presentation)} points="${escapeAttribute(polylinePoints(polyline))}" />`);
  }
  parts.push("</g>");
  return parts.join("");
}

function polylinePoints(points: readonly Point[]): string {
  return points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`).join(" ");
}

function closePolyline(points: readonly Point[]): Point[] {
  if (points.length === 0) {
    return [];
  }

  return [...points, points[0]];
}

function presentationAttributes(presentation: WarpGeometryPresentation): string {
  const attributes = [
    'fill="none"',
    `stroke="${escapeAttribute(presentation.stroke)}"`,
    `stroke-width="${escapeAttribute(String(presentation.strokeWidth))}"`,
    `stroke-linecap="${escapeAttribute(presentation.strokeLineCap)}"`,
    `stroke-linejoin="${escapeAttribute(presentation.strokeLineJoin)}"`,
    `vector-effect="${escapeAttribute(presentation.vectorEffect)}"`,
  ];
  if (presentation.opacity !== undefined) {
    attributes.push(`opacity="${escapeAttribute(String(presentation.opacity))}"`);
  }
  return attributes.join(" ");
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}