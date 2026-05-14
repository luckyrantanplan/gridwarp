import { ContourTracer, type ContourTracerSettings } from "../render/contour-tracer.js";
import { LeafCellCollector, smallestLeafCellSize, type LeafCellCollectorSettings } from "../render/leaf-cell-collector.js";
import { segmentsFromVertices, traceWarpedPolylineOverlayGroups, type WarpedPolylineShape } from "../render/polyline-overlay.js";
import { SvgContourRenderer } from "../render/svg-contour-renderer.js";
import type { Cell, Point, TracedComponent, WarpField } from "../render/types.js";
import { BicubicGridSampler } from "../lib/bicubic-grid-sampler.js";
import { createDirectionGrid } from "../lib/direction-grid.js";
import { PolygonShape } from "../lib/polygon-shape.js";
import { AngleDirectedSurfaceWarpField } from "../lib/scalar-surface-warp-field.js";
import { countNonZeroSamples, createPolygonScalarGrid } from "../lib/scalar-grid.js";
import type { WarpRequest } from "../shared/warp-request.js";
import type { ParsedWarpGeometry } from "./parse-geometry-svg.js";

const POLYGON_SCALAR_GRID_PADDING = 0.5;
const SURFACE_WARP_JACOBIAN_EPSILON = 0.75;
const SURFACE_WARP_REFERENCE_TIME = 16.0;
const SURFACE_WARP_AMPLITUDE = 1.0;
const SURFACE_WARP_ANGLE_OFFSET = 22.0 * Math.PI / 180.0;
const STROKE_WIDTH = 2.2;
const PATH_DECIMALS = 2;

const OVERLAY_STROKE = "#161616";
const OVERLAY_STROKE_WIDTH = 1.6;
const DIAGONAL_OPACITY = 0.55;

const leafCellSettings: LeafCellCollectorSettings = {
  maxContourCellSize: 8,
  minContourCellSize: 3,
  maxAdaptiveDepth: 3,
  curvatureErrorThreshold: 0.02,
};

const tracerSettings: ContourTracerSettings = {
  minGradientNorm: 1e-4,
  newtonTolerance: 1e-3,
  maxProjectionIterations: 10,
  maxNewtonDisplacement: 2,
  initialTraceStep: 4,
  maxTraceStep: 8,
  traceMinStep: 0.25,
  traceTargetCorrection: 0.4,
  maxTraceTurn: Math.PI / 6,
  maxTraceSteps: 4000,
  loopClosureDistance: 3,
  minLoopArcLength: 40,
  seedDedupDistance: 4,
  visitedBucketSize: 18,
  visitedSeedDistance: 10,
};

const contourTracer = new ContourTracer(tracerSettings);
const contourRenderer = new SvgContourRenderer(STROKE_WIDTH, PATH_DECIMALS);

export function renderWarpScene(request: WarpRequest, geometry: ParsedWarpGeometry): string {
  const outerBoundaryShape = new PolygonShape(geometry.outerBoundary);
  const scalarGrid = createPolygonScalarGrid(outerBoundaryShape, {
    columns: request.sampleGridSize,
    rows: request.sampleGridSize,
    padding: POLYGON_SCALAR_GRID_PADDING,
    gain: request.gain,
    plateau: request.plateau,
  });
  const amplitudeSurface = new BicubicGridSampler(scalarGrid);
  const directionSurface = new BicubicGridSampler(createDirectionGrid(scalarGrid.spec, {
    columns: scalarGrid.spec.columns,
    rows: scalarGrid.spec.rows,
    angleOffset: SURFACE_WARP_ANGLE_OFFSET,
  }));
  const amplitudeScale = SURFACE_WARP_AMPLITUDE * Math.max(request.time / SURFACE_WARP_REFERENCE_TIME, 0.0);
  const warp = new AngleDirectedSurfaceWarpField(
    request.renderWidth,
    request.renderHeight,
    outerBoundaryShape,
    amplitudeSurface,
    directionSurface,
    {
      finiteDifferenceEpsilon: SURFACE_WARP_JACOBIAN_EPSILON,
      amplitudeScale,
    },
  );
  const leafCells = new LeafCellCollector(
    request.renderWidth,
    request.renderHeight,
    warp,
    leafCellSettings,
  ).collect();

  const parts: string[] = [];
  parts.push(renderWarpedShapeSetMarkup(geometry.horizontalGrid, "#d4372f", STROKE_WIDTH, warp, leafCells));
  parts.push(renderWarpedShapeSetMarkup(geometry.verticalGrid, "#148a45", STROKE_WIDTH, warp, leafCells));
  parts.push(renderWarpedShapeSetMarkup([toClosedShape(geometry.outerBoundary)], OVERLAY_STROKE, OVERLAY_STROKE_WIDTH, warp, leafCells));
  parts.push(renderWarpedShapeSetMarkup(geometry.innerBoundary, OVERLAY_STROKE, OVERLAY_STROKE_WIDTH, warp, leafCells));
  parts.push(renderWarpedShapeSetMarkup(geometry.diagonals, OVERLAY_STROKE, OVERLAY_STROKE_WIDTH, warp, leafCells, DIAGONAL_OPACITY));

  const activeSampleCount = String(countNonZeroSamples(scalarGrid));
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  const gridLabel = formatGridLabel(geometry.horizontalGrid.length, geometry.verticalGrid.length);
  const caption = request.renderWidth < 720
    ? compactCaption(request.time, request.sampleGridSize, activeSampleCount, gridLabel, leafCellCount, smallestCell)
    : fullCaption(request.time, request.sampleGridSize, activeSampleCount, gridLabel, leafCellCount, smallestCell);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeAttribute(String(request.renderWidth))}" height="${escapeAttribute(String(request.renderHeight))}" viewBox="0 0 ${escapeAttribute(String(request.renderWidth))} ${escapeAttribute(String(request.renderHeight))}" aria-label="Scalar warp grid demo" data-caption="${escapeAttribute(caption)}">`,
    ...parts,
    "</svg>",
  ].join("");
}

function renderWarpedShapeSetMarkup(
  shapes: readonly WarpedPolylineShape[],
  stroke: string,
  strokeWidth: number,
  warp: WarpField,
  leafCells: readonly Cell[],
  opacity?: number,
): string {
  if (shapes.length === 0) {
    return "";
  }

  const tracedGroups = traceWarpedPolylineOverlayGroups(warp, leafCells, contourTracer, shapes);
  const parts: string[] = [];
  for (const group of tracedGroups) {
    parts.push(renderOverlayGroupMarkup(group.components, stroke, strokeWidth, opacity ?? group.opacity));
  }
  return parts.join("");
}

function renderOverlayGroupMarkup(
  components: readonly TracedComponent[],
  stroke: string,
  strokeWidth: number,
  opacity: number | undefined,
): string {
  const attributes = [
    'fill="none"',
    `stroke="${escapeAttribute(stroke)}"`,
    `stroke-width="${escapeAttribute(String(strokeWidth))}"`,
    'stroke-linecap="butt"',
    'stroke-linejoin="miter"',
    'vector-effect="non-scaling-stroke"',
  ];
  if (opacity !== undefined) {
    attributes.push(`opacity="${escapeAttribute(String(opacity))}"`);
  }

  const parts = [`<g ${attributes.join(" ")}>`];
  for (const component of components) {
    parts.push(renderPathMarkup(component, stroke, strokeWidth, "butt", component.closed ? "miter" : "bevel", "non-scaling-stroke"));
  }
  parts.push("</g>");
  return parts.join("");
}

function renderPathMarkup(
  component: TracedComponent,
  stroke: string,
  strokeWidth: number,
  lineCap: string,
  lineJoin: string,
  vectorEffect: string,
): string {
  return `<path fill="none" stroke="${escapeAttribute(stroke)}" stroke-width="${escapeAttribute(String(strokeWidth))}" stroke-linecap="${escapeAttribute(lineCap)}" stroke-linejoin="${escapeAttribute(lineJoin)}" vector-effect="${escapeAttribute(vectorEffect)}" data-closed="${component.closed ? "true" : "false"}" d="${escapeAttribute(contourRenderer.createPathData(component))}" />`;
}

function compactCaption(
  time: number,
  sampleGridSize: number,
  activeSampleCount: string,
  gridLabel: string,
  leafCellCount: string,
  smallestCell: string,
): string {
  const sampleGridLabel = `${String(sampleGridSize)}x${String(sampleGridSize)}`;
  return `t=${time.toFixed(1)} · ${sampleGridLabel} · ${activeSampleCount} active · ${gridLabel} · ${leafCellCount} cells · min ${smallestCell}px`;
}

function fullCaption(
  time: number,
  sampleGridSize: number,
  activeSampleCount: string,
  gridLabel: string,
  leafCellCount: string,
  smallestCell: string,
): string {
  const sampleGridLabel = `${String(sampleGridSize)}x${String(sampleGridSize)} sample grid`;
  return `C1 scalar-amplitude warp at t=${time.toFixed(1)} · ${sampleGridLabel} · ${activeSampleCount} active samples · ${gridLabel} · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
}

function formatGridLabel(horizontalCount: number, verticalCount: number): string {
  if (horizontalCount === 0 && verticalCount === 0) {
    return "grid off";
  }
  if (horizontalCount === verticalCount) {
    return `${String(horizontalCount)} lines per axis`;
  }
  return `${String(horizontalCount)}/${String(verticalCount)} lines`;
}

function toClosedShape(points: readonly Point[]): WarpedPolylineShape {
  return {
    segments: segmentsFromVertices(points, true),
    closed: true,
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}