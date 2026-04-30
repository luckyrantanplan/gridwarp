/**
 * Demo entry point: wires the viewport, tracing pipeline, and SVG rendering together.
 */
import { ContourTracer, type ContourTracerSettings } from "./demo/contour-tracer.js";
import { maxWarpedRadius } from "./demo/dual-spiral-warp.js";
import {
  LeafCellCollector,
  smallestLeafCellSize,
  type LeafCellCollectorSettings,
} from "./demo/leaf-cell-collector.js";
import { createWarpedOctagonOverlay, type OctagonOverlaySettings } from "./demo/octagon-overlay.js";
import { regularPolygonVertices } from "./demo/polyline-overlay.js";
import { SvgContourRenderer } from "./demo/svg-contour-renderer.js";
import { DisplacementFieldWarpField } from "./lib/displacement-field-warp-field.js";
import {
  INNER_OCTAGON_RADIUS,
  OUTER_OCTAGON_RADIUS,
} from "./lib/deformation-field.js";
import {
  countValidSamples,
  sampleDisplacementField,
  type PerlinDiskShapeSettings,
} from "./lib/polygon-displacement-field.js";
import {
  createPolygonMeshFromPoints,
  refinePolygonMesh,
  subdividePolygonForGrid,
  type PolygonMesh,
} from "./lib/polygon-mesh.js";
import { computeDiskParameterization } from "./lib/polygon-parameterization.js";
import type { Cell, Point, WarpField } from "./demo/types.js";
import { WarpLinearField } from "./demo/warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_TIME = 16.0;
const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;

const POLYGON_DISPLACEMENT_FIELD_COLUMNS = 240;
const POLYGON_DISPLACEMENT_FIELD_ROWS = 240;
const POLYGON_DISPLACEMENT_JACOBIAN_EPSILON = 0.75;
const POLYGON_DISPLACEMENT_REFERENCE_TIME = DEFAULT_TIME;
const POLYGON_BOUNDARY_SEGMENT_GRID_MULTIPLIER = 2.0;
const POLYGON_BOUNDARY_MIN_SEGMENTS_PER_EDGE = 1;
const POLYGON_BOUNDARY_MAX_SEGMENTS_PER_EDGE = 128;
const POLYGON_MESH_REFINEMENT_SEGMENTS_PER_TRIANGLE_EDGE = 2;

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
const outerOctagonMesh = createParameterizedOuterOctagonMesh();

const scene = getRequiredElement("scene", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const caption = getRequiredElement("caption", (element): element is HTMLDivElement => element instanceof HTMLDivElement);
const timeSlider = getRequiredElement("time-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeInput = getRequiredElement("time-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeValue = getRequiredElement("time-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const gridEnabled = getRequiredElement("grid-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const diagonalsEnabled = getRequiredElement("diagonals-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const stage = getRequiredParentElement(scene);
const minTime = Number(timeSlider.min);
const maxTime = Number(timeSlider.max);

let currentTime = DEFAULT_TIME;

function getRequiredElement<TElement extends Element>(
  id: string,
  predicate: (element: Element) => element is TElement,
): TElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element with id ${id}.`);
  }
  if (!predicate(element)) {
    throw new Error(`Element with id ${id} did not match the expected type.`);
  }
  return element;
}

function getRequiredParentElement(element: Element): HTMLElement {
  if (!(element.parentElement instanceof HTMLElement)) {
    throw new Error("Expected an HTMLElement parent for the scene root.");
  }
  return element.parentElement;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function appendContourFamily(
  group: SVGGElement,
  offsets: readonly number[],
  normal: Point,
  stroke: string,
  leafCells: readonly Cell[],
  warp: WarpField,
): void {
  for (const offset of offsets) {
    const field = new WarpLinearField(warp, normal, offset);
    const components = contourTracer.trace(field, leafCells);
    for (const component of components) {
      group.appendChild(contourRenderer.createPathElement(component, stroke));
    }
  }
}

function createParameterizedOuterOctagonMesh(): PolygonMesh {
  const polygonPoints = regularPolygonVertices(8, OUTER_OCTAGON_RADIUS);
  const subdividedPoints = subdividePolygonForGrid(polygonPoints, {
    columns: POLYGON_DISPLACEMENT_FIELD_COLUMNS,
    rows: POLYGON_DISPLACEMENT_FIELD_ROWS,
    segmentLengthMultiplier: POLYGON_BOUNDARY_SEGMENT_GRID_MULTIPLIER,
    minSegmentsPerEdge: POLYGON_BOUNDARY_MIN_SEGMENTS_PER_EDGE,
    maxSegmentsPerEdge: POLYGON_BOUNDARY_MAX_SEGMENTS_PER_EDGE,
  });
  const boundaryMesh = createPolygonMeshFromPoints(subdividedPoints);
  const mesh = refinePolygonMesh(boundaryMesh, {
    segmentsPerTriangleEdge: POLYGON_MESH_REFINEMENT_SEGMENTS_PER_TRIANGLE_EDGE,
  });
  computeDiskParameterization(mesh);
  return mesh;
}

function polygonDisplacementSettings(time: number): PerlinDiskShapeSettings {
  const amplitudeScale = Math.max(time / POLYGON_DISPLACEMENT_REFERENCE_TIME, 0);
  return {
    frequency: 3.0,
    radialAmplitude: 0.08 * amplitudeScale,
    rotationAmplitude: 0.75 * amplitudeScale,
    vectorAmplitude: 0.04 * amplitudeScale,
    falloffPower: 2.0,
  };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function syncTimeControls(): void {
  const formattedTime = currentTime.toFixed(1);
  timeSlider.value = formattedTime;
  timeInput.value = formattedTime;
  timeValue.textContent = formattedTime;
}

function setCurrentTime(nextTime: number): void {
  if (!Number.isFinite(nextTime)) {
    syncTimeControls();
    return;
  }
  const clampedTime = clamp(nextTime, minTime, maxTime);
  if (clampedTime === currentTime) {
    syncTimeControls();
    return;
  }
  currentTime = clampedTime;
  render();
}

function commitTimeInputValue(): void {
  const rawValue = timeInput.value.trim();
  if (rawValue === "") {
    syncTimeControls();
    return;
  }
  setCurrentTime(Number(rawValue));
}

function render(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;

  const displacementField = sampleDisplacementField(
    outerOctagonMesh,
    polygonDisplacementSettings(currentTime),
    POLYGON_DISPLACEMENT_FIELD_COLUMNS,
    POLYGON_DISPLACEMENT_FIELD_ROWS,
  );
  const warp = new DisplacementFieldWarpField(
    width,
    height,
    displacementField,
    POLYGON_DISPLACEMENT_JACOBIAN_EPSILON,
  );
  const leafCells: Cell[] = new LeafCellCollector(width, height, warp, leafCellSettings).collect();

  scene.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  scene.replaceChildren();

  const overlaySettings: OctagonOverlaySettings = {
    ...octagonOverlaySettings,
    showDiagonals: diagonalsEnabled.checked,
  };

  let offsetCount = "0";
  if (gridEnabled.checked) {
    const limit = maxWarpedRadius(width, height, warp);
    const offsets = lineOffsets(limit);
    const horizontalGroup = document.createElementNS(SVG_NS, "g");
    const verticalGroup = document.createElementNS(SVG_NS, "g");

    appendContourFamily(horizontalGroup, offsets, { x: 0, y: 1 }, "#d4372f", leafCells, warp);
    appendContourFamily(verticalGroup, offsets, { x: 1, y: 0 }, "#148a45", leafCells, warp);
    scene.append(horizontalGroup, verticalGroup);
    offsetCount = String(offsets.length);
  }

  scene.append(createWarpedOctagonOverlay(warp, leafCells, contourTracer, contourRenderer, overlaySettings));
  syncTimeControls();
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  const validSampleCount = String(countValidSamples(displacementField));
  const gridLabel = gridEnabled.checked ? `${offsetCount} lines per axis` : "grid tracing disabled";
  caption.textContent = `polygon displacement at t=${currentTime.toFixed(1)} · ${validSampleCount} valid samples · ${gridLabel} · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
}

timeSlider.addEventListener("input", () => {
  setCurrentTime(Number(timeSlider.value));
});

timeInput.addEventListener("change", () => {
  commitTimeInputValue();
});

timeInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitTimeInputValue();
});

gridEnabled.addEventListener("change", () => {
  render();
});

diagonalsEnabled.addEventListener("change", () => {
  render();
});

const resizeObserver = new ResizeObserver(() => { render(); });

resizeObserver.observe(stage);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});