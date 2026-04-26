/**
 * Demo entry point: wires the viewport, tracing pipeline, and SVG rendering together.
 */
import { ContourTracer, type ContourTracerSettings } from "./demo/contour-tracer.js";
import { createDualSpiralWarpField, maxWarpedRadius } from "./demo/dual-spiral-warp.js";
import { WarpFieldContext } from "./demo/field-context.js";
import {
  LeafCellCollector,
  smallestLeafCellSize,
  type LeafCellCollectorSettings,
} from "./demo/leaf-cell-collector.js";
import { createWarpedOctagonOverlay, type OctagonOverlaySettings } from "./demo/octagon-overlay.js";
import { SvgContourRenderer } from "./demo/svg-contour-renderer.js";
import {
  INNER_OCTAGON_RADIUS,
  OUTER_OCTAGON_RADIUS,
} from "./lib/deformation-field.js";
import type { Axis, Cell, FieldContext, WarpField } from "./demo/types.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_TIME = 16.0;
const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;

const AFFINE_GRID_RESOLUTION = 1000;
const AFFINE_GRID_JACOBIAN_EPSILON = 0.75;

const STROKE_WIDTH = 2.2;
const PATH_DECIMALS = 2;

const octagonOverlaySettings: OctagonOverlaySettings = {
  outerRadius: OUTER_OCTAGON_RADIUS,
  innerRadius: INNER_OCTAGON_RADIUS,
  stroke: "#161616",
  strokeWidth: 1.6,
  diagonalOpacity: 0.55,
  samplesPerSegment: 32,
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

const scene = getRequiredElement("scene", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const caption = getRequiredElement("caption", (element): element is HTMLDivElement => element instanceof HTMLDivElement);
const timeSlider = getRequiredElement("time-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeInput = getRequiredElement("time-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeValue = getRequiredElement("time-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
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
  axis: Axis,
  stroke: string,
  leafCells: readonly Cell[],
  field: FieldContext,
  warp: WarpField,
): void {
  const components = contourTracer.traceFamily(offsets, axis, leafCells, field, warp);
  for (const component of components) {
    group.appendChild(contourRenderer.createPathElement(component, stroke));
  }
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

  const warp = createDualSpiralWarpField(
    width,
    height,
    currentTime,
    AFFINE_GRID_RESOLUTION,
    AFFINE_GRID_RESOLUTION,
    AFFINE_GRID_JACOBIAN_EPSILON,
  );
  const field: FieldContext = new WarpFieldContext(warp);
  const leafCells: Cell[] = new LeafCellCollector(width, height, warp, leafCellSettings).collect();

  scene.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, warp);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "warpedY", "#d4372f", leafCells, field, warp);
  appendContourFamily(verticalGroup, offsets, "warpedX", "#148a45", leafCells, field, warp);

  scene.append(horizontalGroup, verticalGroup, createWarpedOctagonOverlay(width, height, warp, octagonOverlaySettings));
  syncTimeControls();
  const offsetCount = String(offsets.length);
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  caption.textContent = `static sample at t=${currentTime.toFixed(1)} · ${offsetCount} lines per axis · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
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

const resizeObserver = new ResizeObserver(() => { render(); });

resizeObserver.observe(stage);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});