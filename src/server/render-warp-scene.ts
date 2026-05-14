import { ContourTracer, type ContourTracerSettings } from "../demo/contour-tracer.js";
import { LeafCellCollector, smallestLeafCellSize, type LeafCellCollectorSettings } from "../demo/leaf-cell-collector.js";
import { type OctagonOverlaySettings, traceWarpedOctagonOverlayGroups } from "../demo/octagon-overlay.js";
import { regularPolygonVertices } from "../demo/polyline-overlay.js";
import { SvgContourRenderer } from "../demo/svg-contour-renderer.js";
import type { Cell, Point, TracedComponent, WarpField } from "../demo/types.js";
import { maxWarpedRadius } from "../demo/visible-warp-bounds.js";
import { WarpLinearField } from "../demo/warp-scalar-fields.js";
import { BicubicGridSampler } from "../lib/bicubic-grid-sampler.js";
import { createDirectionGrid } from "../lib/direction-grid.js";
import { INNER_OCTAGON_RADIUS, OUTER_OCTAGON_RADIUS } from "../lib/octagon-constants.js";
import { PolygonShape } from "../lib/polygon-shape.js";
import { AngleDirectedSurfaceWarpField } from "../lib/scalar-surface-warp-field.js";
import { countNonZeroSamples, createPolygonScalarGrid } from "../lib/scalar-grid.js";
import type { WarpRequest } from "../shared/warp-request.js";

const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;
const POLYGON_SCALAR_GRID_PADDING = 0.5;
const SURFACE_WARP_JACOBIAN_EPSILON = 0.75;
const SURFACE_WARP_REFERENCE_TIME = 16.0;
const SURFACE_WARP_AMPLITUDE = 1.0;
const SURFACE_WARP_ANGLE_OFFSET = 22.0 * Math.PI / 180.0;
const STROKE_WIDTH = 2.2;
const PATH_DECIMALS = 2;

const octagonOverlaySettings: OctagonOverlaySettings = {
  outerRadius: OUTER_OCTAGON_RADIUS,
  innerRadius: INNER_OCTAGON_RADIUS,
  stroke: "#161616",
  strokeWidth: 1.6,
  diagonalOpacity: 0.55,
};

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
const outerOctagonShape = new PolygonShape(regularPolygonVertices(8, OUTER_OCTAGON_RADIUS));

export function renderWarpScene(request: WarpRequest): string {
  const scalarGrid = createPolygonScalarGrid(outerOctagonShape, {
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
    outerOctagonShape,
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
  let offsetCount = "0";
  if (request.gridVisible) {
    const limit = maxWarpedRadius(request.renderWidth, request.renderHeight, warp);
    const offsets = lineOffsets(limit);
    parts.push(renderContourFamilyMarkup(offsets, { x: 0, y: 1 }, "#d4372f", leafCells, warp));
    parts.push(renderContourFamilyMarkup(offsets, { x: 1, y: 0 }, "#148a45", leafCells, warp));
    offsetCount = String(offsets.length);
  }

  const overlaySettings: OctagonOverlaySettings = {
    ...octagonOverlaySettings,
    showDiagonals: request.diagonalsVisible,
  };
  for (const group of traceWarpedOctagonOverlayGroups(warp, leafCells, contourTracer, overlaySettings)) {
    parts.push(
      renderOverlayGroupMarkup(
        group.components,
        octagonOverlaySettings.stroke,
        octagonOverlaySettings.strokeWidth,
        group.opacity,
      ),
    );
  }

  const activeSampleCount = String(countNonZeroSamples(scalarGrid));
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  const caption = request.renderWidth < 720
    ? compactCaption(request.time, request.sampleGridSize, activeSampleCount, offsetCount, leafCellCount, smallestCell, request.gridVisible)
    : fullCaption(request.time, request.sampleGridSize, activeSampleCount, offsetCount, leafCellCount, smallestCell, request.gridVisible);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${escapeAttribute(String(request.renderWidth))}" height="${escapeAttribute(String(request.renderHeight))}" viewBox="0 0 ${escapeAttribute(String(request.renderWidth))} ${escapeAttribute(String(request.renderHeight))}" aria-label="Scalar warp grid demo" data-caption="${escapeAttribute(caption)}">`,
    ...parts,
    "</svg>",
  ].join("");
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

function renderContourFamilyMarkup(
  offsets: readonly number[],
  normal: Point,
  stroke: string,
  leafCells: readonly Cell[],
  warp: WarpField,
): string {
  const parts: string[] = ["<g fill=\"none\">"];
  for (const offset of offsets) {
    const field = new WarpLinearField(warp, normal, offset);
    const components = contourTracer.trace(field, leafCells);
    for (const component of components) {
      parts.push(renderPathMarkup(component, stroke, STROKE_WIDTH, "round", "round", "non-scaling-stroke"));
    }
  }
  parts.push("</g>");
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
  offsetCount: string,
  leafCellCount: string,
  smallestCell: string,
  gridIsEnabled: boolean,
): string {
  const gridLabel = gridIsEnabled ? `${offsetCount}/axis` : "grid off";
  const sampleGridLabel = `${String(sampleGridSize)}x${String(sampleGridSize)}`;
  return `t=${time.toFixed(1)} · ${sampleGridLabel} · ${activeSampleCount} active · ${gridLabel} · ${leafCellCount} cells · min ${smallestCell}px`;
}

function fullCaption(
  time: number,
  sampleGridSize: number,
  activeSampleCount: string,
  offsetCount: string,
  leafCellCount: string,
  smallestCell: string,
  gridIsEnabled: boolean,
): string {
  const gridLabel = gridIsEnabled ? `${offsetCount} lines per axis` : "grid tracing disabled";
  const sampleGridLabel = `${String(sampleGridSize)}x${String(sampleGridSize)} sample grid`;
  return `C1 scalar-amplitude warp at t=${time.toFixed(1)} · ${sampleGridLabel} · ${activeSampleCount} active samples · ${gridLabel} · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}