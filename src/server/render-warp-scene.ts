import { ContourTracer, type ContourTracerSettings } from "../render/contour-tracer.js";
import { LeafCellCollector, smallestLeafCellSize, type LeafCellCollectorSettings } from "../render/leaf-cell-collector.js";
import { segmentsFromVertices, traceWarpedPolylineOverlayGroups, type WarpedPolylineShape } from "../render/polyline-overlay.js";
import { SvgContourRenderer } from "../render/svg-contour-renderer.js";
import type { Cell, Point, TracedComponent, WarpField } from "../render/types.js";
import { BicubicGridSampler } from "../lib/bicubic-grid-sampler.js";
import { createDirectionGrid } from "../lib/direction-grid.js";
import { PolygonShape, type BoundingBox } from "../lib/polygon-shape.js";
import { resolveRegularGridSpec, type RegularGridSpec } from "../lib/regular-grid.js";
import { AngleDirectedSurfaceWarpField } from "../lib/scalar-surface-warp-field.js";
import { countNonZeroSamples, createPolygonScalarGrid } from "../lib/scalar-grid.js";
import { WarpRequestError, type WarpGeometryPresentation, type WarpRequest } from "../shared/warp-request.js";
import type { ParsedWarpGeometry } from "./parse-geometry-svg.js";

const SURFACE_WARP_JACOBIAN_EPSILON = 0.75;
const SURFACE_WARP_REFERENCE_TIME = 16.0;
const SURFACE_WARP_AMPLITUDE = 1.0;
const SURFACE_WARP_ANGLE_OFFSET = 22.0 * Math.PI / 180.0;
const PATH_DECIMALS = 2;
const MAX_GRID_KNOTS = 2_000_000;

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
const contourRenderer = new SvgContourRenderer(2.2, PATH_DECIMALS);

export function renderWarpScene(request: WarpRequest, geometry: ParsedWarpGeometry): string {
  const outerBoundaryShape = new PolygonShape(geometry.outerBoundary);
  const resolvedGridSpec = resolveRegularGridSpec(geometry.worldBounds, { samplesPerUnit: request.samplesPerUnit });
  ensureGridFitsBudget(resolvedGridSpec);
  const scalarGrid = createPolygonScalarGrid(outerBoundaryShape, {
    worldBounds: geometry.worldBounds,
    samplesPerUnit: request.samplesPerUnit,
    gain: request.gain,
    plateau: request.plateau,
  });
  const amplitudeSurface = new BicubicGridSampler(scalarGrid);
  const directionSurface = new BicubicGridSampler(createDirectionGrid(resolvedGridSpec, {
    angleOffset: SURFACE_WARP_ANGLE_OFFSET,
  }));
  const amplitudeScale = SURFACE_WARP_AMPLITUDE * Math.max(request.time / SURFACE_WARP_REFERENCE_TIME, 0.0);
  const warp = new AngleDirectedSurfaceWarpField(
    request.renderWidth,
    request.renderHeight,
    geometry.worldBounds,
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
  const renderIdentityShapes = amplitudeScale <= 0.0;

  const parts: string[] = [];
  parts.push(renderShapeSetMarkup(geometry.horizontalGrid, geometry.horizontalGridStyle, request, geometry, warp, leafCells, renderIdentityShapes));
  parts.push(renderShapeSetMarkup(geometry.verticalGrid, geometry.verticalGridStyle, request, geometry, warp, leafCells, renderIdentityShapes));
  parts.push(renderShapeSetMarkup([toClosedShape(geometry.outerBoundary)], geometry.outerBoundaryStyle, request, geometry, warp, leafCells, renderIdentityShapes));
  parts.push(renderShapeSetMarkup(geometry.innerBoundary, geometry.innerBoundaryStyle, request, geometry, warp, leafCells, renderIdentityShapes));
  parts.push(renderShapeSetMarkup(geometry.diagonals, geometry.diagonalsStyle, request, geometry, warp, leafCells, renderIdentityShapes));

  const activeSampleCount = String(countNonZeroSamples(scalarGrid));
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  const gridLabel = formatGridLabel(geometry.horizontalGrid.length, geometry.verticalGrid.length);
  const resolutionLabel = formatResolutionLabel(request.samplesPerUnit, resolvedGridSpec.columns, resolvedGridSpec.rows);
  const caption = request.renderWidth < 720
    ? compactCaption(request.time, resolutionLabel, activeSampleCount, gridLabel, leafCellCount, smallestCell)
    : fullCaption(request.time, resolutionLabel, activeSampleCount, gridLabel, leafCellCount, smallestCell);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeAttribute(String(request.renderWidth))}" height="${escapeAttribute(String(request.renderHeight))}" viewBox="0 0 ${escapeAttribute(String(request.renderWidth))} ${escapeAttribute(String(request.renderHeight))}" aria-label="Scalar warp grid demo" data-caption="${escapeAttribute(caption)}">`,
    ...parts,
    "</svg>",
  ].join("");
}

function renderShapeSetMarkup(
  shapes: readonly WarpedPolylineShape[],
  presentation: WarpGeometryPresentation,
  request: WarpRequest,
  geometry: ParsedWarpGeometry,
  warp: WarpField,
  leafCells: readonly Cell[],
  renderIdentityShapes: boolean,
): string {
  return renderIdentityShapes
    ? renderIdentityShapeSetMarkup(shapes, presentation, request.renderWidth, request.renderHeight, geometry.worldBounds)
    : renderWarpedShapeSetMarkup(shapes, presentation, warp, leafCells);
}

function ensureGridFitsBudget(spec: RegularGridSpec): void {
  const knotCount = spec.columns * spec.rows;
  if (knotCount > MAX_GRID_KNOTS) {
    throw new WarpRequestError(`Resolved grid is too dense (${String(spec.columns)}x${String(spec.rows)} = ${String(knotCount)} knots). Reduce samplesPerUnit.`);
  }
}

function renderWarpedShapeSetMarkup(
  shapes: readonly WarpedPolylineShape[],
  presentation: WarpGeometryPresentation,
  warp: WarpField,
  leafCells: readonly Cell[],
): string {
  if (shapes.length === 0) {
    return "";
  }

  const tracedGroups = traceWarpedPolylineOverlayGroups(warp, leafCells, contourTracer, shapes);
  const parts: string[] = [];
  for (const group of tracedGroups) {
    parts.push(renderOverlayGroupMarkup(group.components, withOpacity(presentation, group.opacity)));
  }
  return parts.join("");
}

function renderIdentityShapeSetMarkup(
  shapes: readonly WarpedPolylineShape[],
  presentation: WarpGeometryPresentation,
  renderWidth: number,
  renderHeight: number,
  worldBounds: BoundingBox,
): string {
  if (shapes.length === 0) {
    return "";
  }

  const attributes = presentationAttributes(presentation);

  const parts = [`<g ${attributes.join(" ")}>`];
  for (const shape of shapes) {
    parts.push(`<path fill="none" d="${escapeAttribute(identityPathData(shape, renderWidth, renderHeight, worldBounds))}" />`);
  }
  parts.push("</g>");
  return parts.join("");
}

function identityPathData(
  shape: WarpedPolylineShape,
  renderWidth: number,
  renderHeight: number,
  worldBounds: BoundingBox,
): string {
  const points = shapePoints(shape);
  if (points.length === 0) {
    return "";
  }

  let pathData = moveTo(screenPoint(points[0], renderWidth, renderHeight, worldBounds));
  for (const point of points.slice(1)) {
    pathData += lineTo(screenPoint(point, renderWidth, renderHeight, worldBounds));
  }
  if (shape.closed) {
    pathData += " Z";
  }
  return pathData;
}

function shapePoints(shape: WarpedPolylineShape): Point[] {
  if (shape.segments.length === 0) {
    return [];
  }

  const points = [shape.segments[0].start];
  for (const segment of shape.segments) {
    points.push(segment.end);
  }
  if (shape.closed) {
    points.pop();
  }
  return points;
}

function screenPoint(point: Point, renderWidth: number, renderHeight: number, worldBounds: BoundingBox): Point {
  const worldWidth = worldBounds.maxX - worldBounds.minX;
  const worldHeight = worldBounds.maxY - worldBounds.minY;
  const normalizedX = worldWidth > 0.0 ? (point.x - worldBounds.minX) / worldWidth : 0.5;
  const normalizedY = worldHeight > 0.0 ? (worldBounds.maxY - point.y) / worldHeight : 0.5;
  return {
    x: normalizedX * renderWidth,
    y: normalizedY * renderHeight,
  };
}

function moveTo(point: Point): string {
  return `M ${point.x.toFixed(PATH_DECIMALS)} ${point.y.toFixed(PATH_DECIMALS)}`;
}

function lineTo(point: Point): string {
  return ` L ${point.x.toFixed(PATH_DECIMALS)} ${point.y.toFixed(PATH_DECIMALS)}`;
}

function renderOverlayGroupMarkup(
  components: readonly TracedComponent[],
  presentation: WarpGeometryPresentation,
): string {
  const attributes = presentationAttributes(presentation);

  const parts = [`<g ${attributes.join(" ")}>`];
  for (const component of components) {
    parts.push(renderPathMarkup(component, presentation));
  }
  parts.push("</g>");
  return parts.join("");
}

function renderPathMarkup(
  component: TracedComponent,
  presentation: WarpGeometryPresentation,
): string {
  const attributes = presentationAttributes(presentation);
  return `<path ${attributes.join(" ")} data-closed="${component.closed ? "true" : "false"}" d="${escapeAttribute(contourRenderer.createPathData(component))}" />`;
}

function presentationAttributes(presentation: WarpGeometryPresentation): string[] {
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
  return attributes;
}

function withOpacity(presentation: WarpGeometryPresentation, opacity: number | undefined): WarpGeometryPresentation {
  const nextPresentation: WarpGeometryPresentation = {
    stroke: presentation.stroke,
    strokeWidth: presentation.strokeWidth,
    strokeLineCap: presentation.strokeLineCap,
    strokeLineJoin: presentation.strokeLineJoin,
    vectorEffect: presentation.vectorEffect,
  };
  const effectiveOpacity = opacity ?? presentation.opacity;
  if (effectiveOpacity !== undefined) {
    return {
      ...nextPresentation,
      opacity: effectiveOpacity,
    };
  }
  return nextPresentation;
}

function compactCaption(
  time: number,
  resolutionLabel: string,
  activeSampleCount: string,
  gridLabel: string,
  leafCellCount: string,
  smallestCell: string,
): string {
  return `t=${time.toFixed(1)} · ${resolutionLabel} · ${activeSampleCount} active · ${gridLabel} · ${leafCellCount} cells · min ${smallestCell}px`;
}

function fullCaption(
  time: number,
  resolutionLabel: string,
  activeSampleCount: string,
  gridLabel: string,
  leafCellCount: string,
  smallestCell: string,
): string {
  return `C1 scalar-amplitude warp at t=${time.toFixed(1)} · ${resolutionLabel} · ${activeSampleCount} active samples · ${gridLabel} · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
}

function formatResolutionLabel(samplesPerUnit: number, columns: number, rows: number): string {
  return `${samplesPerUnit.toFixed(2)} samples/unit -> ${String(columns)}x${String(rows)} knots`;
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