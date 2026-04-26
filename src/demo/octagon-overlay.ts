/**
 * Octagon-specific overlay definitions built on the reusable polyline overlay pipeline.
 */
import type { ContourTracer } from "./contour-tracer.js";
import {
  createWarpedPolylineOverlay,
  type PlaneSegment,
  segmentsFromVertices,
  type WarpedPolylineOverlaySettings,
  type WarpedPolylineShape,
} from "./polyline-overlay.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, Point, WarpField } from "./types.js";

export interface OctagonOverlaySettings extends WarpedPolylineOverlaySettings {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly diagonalOpacity: number;
  readonly showDiagonals?: boolean;
}

/**
 * Builds an SVG group containing the warped outer octagon, inner octagon, and four diagonals.
 */
export function createWarpedOctagonOverlay(
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  settings: OctagonOverlaySettings,
): SVGGElement {
  const shapes: WarpedPolylineShape[] = [
    { segments: segmentsFromVertices(regularPolygonVertices(8, settings.outerRadius)), closed: true },
    { segments: segmentsFromVertices(regularPolygonVertices(8, settings.innerRadius)), closed: true },
  ];

  if (settings.showDiagonals !== false) {
    shapes.push({
      segments: octagonDiagonals(settings.outerRadius),
      opacity: settings.diagonalOpacity,
    });
  }

  return createWarpedPolylineOverlay(warp, leafCells, tracer, renderer, shapes, settings);
}

function regularPolygonVertices(sides: number, radius: number): Point[] {
  const vertices: Point[] = [];
  for (let vertex = 0; vertex < sides; vertex += 1) {
    const angle = vertex * (2 * Math.PI) / sides;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return vertices;
}

function octagonDiagonals(outerRadius: number): PlaneSegment[] {
  const segments: PlaneSegment[] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    segments.push({
      start: { x: -cos * outerRadius, y: -sin * outerRadius },
      end: { x: cos * outerRadius, y: sin * outerRadius },
    });
  }
  return segments;
}
