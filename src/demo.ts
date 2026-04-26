/**
 * Demo entry point: wires the viewport, tracing pipeline, and SVG rendering together.
 */
import { ContourTracer, ContourTracerSettings } from "./demo/contour-tracer.js";
import { createCenteredRadialWarpField, maxWarpedRadius } from "./demo/centered-radial-warp.js";
import { WarpFieldContext } from "./demo/field-context.js";
import { LeafCellCollector, LeafCellCollectorSettings, smallestLeafCellSize } from "./demo/leaf-cell-collector.js";
import { SvgContourRenderer } from "./demo/svg-contour-renderer.js";
import type {
  Axis,
  Cell,
  FieldContext,
  WarpField,
} from "./demo/types.js";

// Adaptive seed grid.
const DEFAULT_TIME = 16.0;
const MAX_CONTOUR_CELL_SIZE = 8;
const MIN_CONTOUR_CELL_SIZE = 3;
const CURVATURE_ERROR_THRESHOLD = 0.02;
const MAX_ADAPTIVE_DEPTH = 3;
const GRID_OFFSET = 0.5;

// Contour tracing.
const MIN_GRADIENT_NORM = 1e-4;
const NEWTON_TOLERANCE = 1e-3;
const MAX_PROJECTION_ITERATIONS = 10;
const MAX_NEWTON_DISPLACEMENT = 2;
const INITIAL_TRACE_STEP = 4;
const MAX_TRACE_STEP = 8;
const TRACE_MIN_STEP = 0.25;
const TRACE_TARGET_CORRECTION = 0.4;
const MAX_TRACE_TURN = Math.PI / 6;
const MAX_TRACE_STEPS = 4000;
const LOOP_CLOSURE_DISTANCE = 3;
const MIN_LOOP_ARC_LENGTH = 40;
const SEED_DEDUP_DISTANCE = 4;
const VISITED_BUCKET_SIZE = 18;
const VISITED_SEED_DISTANCE = 10;

// SVG output and UI formatting.
const STROKE_WIDTH = 2.2;
const PATH_DECIMALS = 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const AFFINE_GRID_COLUMNS = 1000;
const AFFINE_GRID_ROWS = 1000;
const AFFINE_GRID_JACOBIAN_EPSILON = 0.75;
const leafCellCollectorSettings = new LeafCellCollectorSettings(
  MAX_CONTOUR_CELL_SIZE,
  MIN_CONTOUR_CELL_SIZE,
  MAX_ADAPTIVE_DEPTH,
  CURVATURE_ERROR_THRESHOLD,
);
const contourTracerSettings = new ContourTracerSettings(
  MIN_GRADIENT_NORM,
  NEWTON_TOLERANCE,
  MAX_PROJECTION_ITERATIONS,
  MAX_NEWTON_DISPLACEMENT,
  INITIAL_TRACE_STEP,
  MAX_TRACE_STEP,
  TRACE_MIN_STEP,
  TRACE_TARGET_CORRECTION,
  MAX_TRACE_TURN,
  MAX_TRACE_STEPS,
  LOOP_CLOSURE_DISTANCE,
  MIN_LOOP_ARC_LENGTH,
  SEED_DEDUP_DISTANCE,
  VISITED_BUCKET_SIZE,
  VISITED_SEED_DISTANCE,
);
const contourTracer = new ContourTracer(contourTracerSettings);
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
  for (let index = start; index <= end; index += 1) {
    values.push(index + GRID_OFFSET);
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

  const warp = createCenteredRadialWarpField(
    width,
    height,
    currentTime,
    AFFINE_GRID_COLUMNS,
    AFFINE_GRID_ROWS,
    AFFINE_GRID_JACOBIAN_EPSILON,
  );
  const field: FieldContext = new WarpFieldContext(warp);
  const leafCells: Cell[] = new LeafCellCollector(width, height, warp, leafCellCollectorSettings).collect();

  scene.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, warp);
  const offsets = lineOffsets(limit);
  const horizontalGroup = document.createElementNS(SVG_NS, "g");
  const verticalGroup = document.createElementNS(SVG_NS, "g");

  appendContourFamily(horizontalGroup, offsets, "warpedY", "#d4372f", leafCells, field, warp);
  appendContourFamily(verticalGroup, offsets, "warpedX", "#148a45", leafCells, field, warp);

  scene.append(horizontalGroup, verticalGroup);
  syncTimeControls();
  const offsetCount = String(offsets.length);
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, MAX_CONTOUR_CELL_SIZE).toFixed(1);
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