/**
 * Octagon-specific overlay definitions built on the reusable polyline overlay pipeline.
 */
import type { ContourTracer } from "./contour-tracer.js";
import {
  createWarpedPolylineOverlay,
  traceWarpedPolylineOverlayGroups,
  type PlaneSegment,
  regularPolygonVertices,
  segmentsFromVertices,
  type TracedOverlayGroup,
  type WarpedPolylineOverlaySettings,
  type WarpedPolylineShape,
} from "./polyline-overlay.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, WarpField } from "./types.js";

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
  return createWarpedPolylineOverlay(warp, leafCells, tracer, renderer, octagonShapes(settings), settings);
}

export function traceWarpedOctagonOverlayGroups(
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  settings: OctagonOverlaySettings,
): TracedOverlayGroup[] {
  return traceWarpedPolylineOverlayGroups(warp, leafCells, tracer, octagonShapes(settings));
}

function octagonShapes(settings: OctagonOverlaySettings): WarpedPolylineShape[] {
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

  return shapes;
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
