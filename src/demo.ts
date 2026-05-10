/**
 * Demo entry point: wires the viewport, tracing pipeline, and SVG rendering together.
 */
import { ContourTracer, type ContourTracerSettings } from "./demo/contour-tracer.js";
import { maxWarpedRadius } from "./demo/visible-warp-bounds.js";
import {
  LeafCellCollector,
  smallestLeafCellSize,
  type LeafCellCollectorSettings,
} from "./demo/leaf-cell-collector.js";
import { createWarpedOctagonOverlay, type OctagonOverlaySettings } from "./demo/octagon-overlay.js";
import { regularPolygonVertices } from "./demo/polyline-overlay.js";
import { SvgContourRenderer } from "./demo/svg-contour-renderer.js";
import { BicubicGridSampler } from "./lib/bicubic-grid-sampler.js";
import {
  INNER_OCTAGON_RADIUS,
  OUTER_OCTAGON_RADIUS,
} from "./lib/octagon-constants.js";
import { createDirectionGrid } from "./lib/direction-grid.js";
import { PolygonShape } from "./lib/polygon-shape.js";
import { AngleDirectedSurfaceWarpField } from "./lib/scalar-surface-warp-field.js";
import { countNonZeroSamples, createPolygonScalarGrid } from "./lib/scalar-grid.js";
import type { Cell, Point, WarpField } from "./demo/types.js";
import { WarpLinearField } from "./demo/warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_TIME = 16.0;
const GRID_LINE_DENSITY_MULTIPLIER = 4;
const GRID_LINE_SPACING = 1 / GRID_LINE_DENSITY_MULTIPLIER;
const GRID_LINE_OFFSET = 0.5 * GRID_LINE_SPACING;

const POLYGON_SCALAR_GRID_COLUMNS = 240;
const POLYGON_SCALAR_GRID_ROWS = 240;
const POLYGON_SCALAR_GRID_PADDING = 0.5;
const DEFAULT_SCALAR_GAIN = 0.75;
const DEFAULT_SCALAR_PLATEAU = 0.75;
const SCALAR_CONTROL_DECIMALS = 2;
const SURFACE_WARP_JACOBIAN_EPSILON = 0.75;
const SURFACE_WARP_REFERENCE_TIME = DEFAULT_TIME;
const SURFACE_WARP_AMPLITUDE = 1.0;
const SURFACE_WARP_ANGLE_OFFSET = 0.0;

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
let currentTime = DEFAULT_TIME;
let currentGain = DEFAULT_SCALAR_GAIN;
let currentPlateau = DEFAULT_SCALAR_PLATEAU;
let scalarGrid = createAmplitudeGrid(currentGain, currentPlateau);
const directionGrid = createDirectionGrid(scalarGrid.spec, {
  columns: scalarGrid.spec.columns,
  rows: scalarGrid.spec.rows,
  angleOffset: SURFACE_WARP_ANGLE_OFFSET,
});
let amplitudeSurface = new BicubicGridSampler(scalarGrid);
const directionSurface = new BicubicGridSampler(directionGrid);

const scene = getRequiredElement("scene", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const caption = getRequiredElement("caption", (element): element is HTMLDivElement => element instanceof HTMLDivElement);
const timeSlider = getRequiredElement("time-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeInput = getRequiredElement("time-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const timeValue = getRequiredElement("time-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const gainSlider = getRequiredElement("gain-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const gainInput = getRequiredElement("gain-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const gainValue = getRequiredElement("gain-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const plateauSlider = getRequiredElement("plateau-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const plateauInput = getRequiredElement("plateau-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const plateauValue = getRequiredElement("plateau-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const gridEnabled = getRequiredElement("grid-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const diagonalsEnabled = getRequiredElement("diagonals-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const stage = getRequiredParentElement(scene);
const minTime = Number(timeSlider.min);
const maxTime = Number(timeSlider.max);
const minGain = Number(gainSlider.min);
const maxGain = Number(gainSlider.max);
const minPlateau = Number(plateauSlider.min);
const maxPlateau = Number(plateauSlider.max);

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

function createAmplitudeGrid(gain: number, plateau: number) {
  return createPolygonScalarGrid(outerOctagonShape, {
    columns: POLYGON_SCALAR_GRID_COLUMNS,
    rows: POLYGON_SCALAR_GRID_ROWS,
    padding: POLYGON_SCALAR_GRID_PADDING,
    gain,
    plateau,
  });
}

function rebuildAmplitudeSurface(): void {
  scalarGrid = createAmplitudeGrid(currentGain, currentPlateau);
  amplitudeSurface = new BicubicGridSampler(scalarGrid);
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

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function syncTimeControls(): void {
  const formattedTime = currentTime.toFixed(1);
  timeSlider.value = formattedTime;
  timeInput.value = formattedTime;
  timeValue.textContent = formattedTime;
}

function syncScalarControls(): void {
  const formattedGain = formatScalarControlValue(currentGain);
  const formattedPlateau = formatScalarControlValue(currentPlateau);
  gainSlider.value = formattedGain;
  gainInput.value = formattedGain;
  gainValue.textContent = formattedGain;
  plateauSlider.value = formattedPlateau;
  plateauInput.value = formattedPlateau;
  plateauValue.textContent = formattedPlateau;
}

function formatScalarControlValue(value: number): string {
  return value.toFixed(SCALAR_CONTROL_DECIMALS);
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

function setCurrentGain(nextGain: number): void {
  if (!Number.isFinite(nextGain)) {
    syncScalarControls();
    return;
  }
  const clampedGain = clamp(nextGain, minGain, maxGain);
  if (clampedGain === currentGain) {
    syncScalarControls();
    return;
  }
  currentGain = clampedGain;
  rebuildAmplitudeSurface();
  render();
}

function setCurrentPlateau(nextPlateau: number): void {
  if (!Number.isFinite(nextPlateau)) {
    syncScalarControls();
    return;
  }
  const clampedPlateau = clamp(nextPlateau, minPlateau, maxPlateau);
  if (clampedPlateau === currentPlateau) {
    syncScalarControls();
    return;
  }
  currentPlateau = clampedPlateau;
  rebuildAmplitudeSurface();
  render();
}

function commitGainInputValue(): void {
  const rawValue = gainInput.value.trim();
  if (rawValue === "") {
    syncScalarControls();
    return;
  }
  setCurrentGain(Number(rawValue));
}

function commitPlateauInputValue(): void {
  const rawValue = plateauInput.value.trim();
  if (rawValue === "") {
    syncScalarControls();
    return;
  }
  setCurrentPlateau(Number(rawValue));
}

function render(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const amplitudeScale = SURFACE_WARP_AMPLITUDE * Math.max(currentTime / SURFACE_WARP_REFERENCE_TIME, 0.0);
  const warp = new AngleDirectedSurfaceWarpField(
    width,
    height,
    outerOctagonShape,
    amplitudeSurface,
    directionSurface,
    {
      finiteDifferenceEpsilon: SURFACE_WARP_JACOBIAN_EPSILON,
      amplitudeScale,
    },
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
  syncScalarControls();
  const leafCellCount = String(leafCells.length);
  const smallestCell = smallestLeafCellSize(leafCells, leafCellSettings.maxContourCellSize).toFixed(1);
  const activeSampleCount = String(countNonZeroSamples(scalarGrid));
  caption.textContent = width < 720
    ? compactCaption(currentTime, activeSampleCount, offsetCount, leafCellCount, smallestCell, gridEnabled.checked)
    : fullCaption(currentTime, activeSampleCount, offsetCount, leafCellCount, smallestCell, gridEnabled.checked);
}

function compactCaption(
  time: number,
  activeSampleCount: string,
  offsetCount: string,
  leafCellCount: string,
  smallestCell: string,
  gridIsEnabled: boolean,
): string {
  const gridLabel = gridIsEnabled ? `${offsetCount}/axis` : "grid off";
  return `t=${time.toFixed(1)} · ${activeSampleCount} active · ${gridLabel} · ${leafCellCount} cells · min ${smallestCell}px`;
}

function fullCaption(
  time: number,
  activeSampleCount: string,
  offsetCount: string,
  leafCellCount: string,
  smallestCell: string,
  gridIsEnabled: boolean,
): string {
  const gridLabel = gridIsEnabled ? `${offsetCount} lines per axis` : "grid tracing disabled";
  return `C1 scalar-amplitude warp at t=${time.toFixed(1)} · ${activeSampleCount} active samples · ${gridLabel} · ${leafCellCount} leaf cells, smallest ${smallestCell}px`;
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

gainSlider.addEventListener("input", () => {
  setCurrentGain(Number(gainSlider.value));
});

gainInput.addEventListener("change", () => {
  commitGainInputValue();
});

gainInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitGainInputValue();
});

plateauSlider.addEventListener("input", () => {
  setCurrentPlateau(Number(plateauSlider.value));
});

plateauInput.addEventListener("change", () => {
  commitPlateauInputValue();
});

plateauInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  commitPlateauInputValue();
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
