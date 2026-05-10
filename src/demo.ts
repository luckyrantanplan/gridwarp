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
import { satur } from "./lib/saturation.js";
import type { Cell, Point, WarpField } from "./demo/types.js";
import {
  mapPlotPoint,
  sampleTransferCurve,
  transferCurvePathData,
  type PlotBounds,
  type PlotFrame,
} from "./demo/transfer-curve.js";
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
const VIEWPORT_MIN_SCALE = 0.15;
const VIEWPORT_MAX_SCALE = 6.0;
const VIEWPORT_MARGIN_FACTOR = 0.75;
const TRANSFER_PLOT_SAMPLE_COUNT = 48;
const TRANSFER_PLOT_FRAME: PlotFrame = {
  width: 180,
  height: 120,
  paddingLeft: 22,
  paddingRight: 12,
  paddingTop: 12,
  paddingBottom: 22,
};

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

interface SceneViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface StageSize {
  readonly width: number;
  readonly height: number;
}

interface PanState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly originViewport: SceneViewport;
}

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
const transferPlot = getRequiredElement("transfer-plot", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const viewResetButton = getRequiredElement("view-reset", (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const gridEnabled = getRequiredElement("grid-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const diagonalsEnabled = getRequiredElement("diagonals-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const stage = getRequiredParentElement(scene);
const minTime = Number(timeSlider.min);
const maxTime = Number(timeSlider.max);
const minGain = Number(gainSlider.min);
const maxGain = Number(gainSlider.max);
const minPlateau = Number(plateauSlider.min);
const maxPlateau = Number(plateauSlider.max);
let stageSize: StageSize = { width: 0, height: 0 };
let sceneViewport: SceneViewport = createDefaultSceneViewport(1, 1);
let viewportMode: "default" | "custom" = "default";
let panState: PanState | null = null;

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

function createDefaultSceneViewport(width: number, height: number): SceneViewport {
  return {
    x: 0.0,
    y: 0.0,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

function scaleViewportToStage(viewport: SceneViewport, fromStage: StageSize, toStage: StageSize): SceneViewport {
  if (fromStage.width <= 0 || fromStage.height <= 0) {
    return createDefaultSceneViewport(toStage.width, toStage.height);
  }

  return {
    x: viewport.x * (toStage.width / fromStage.width),
    y: viewport.y * (toStage.height / fromStage.height),
    width: viewport.width * (toStage.width / fromStage.width),
    height: viewport.height * (toStage.height / fromStage.height),
  };
}

function constrainViewport(viewport: SceneViewport, defaultViewport: SceneViewport): SceneViewport {
  const width = clamp(viewport.width, defaultViewport.width * VIEWPORT_MIN_SCALE, defaultViewport.width * VIEWPORT_MAX_SCALE);
  const height = clamp(viewport.height, defaultViewport.height * VIEWPORT_MIN_SCALE, defaultViewport.height * VIEWPORT_MAX_SCALE);
  const marginX = defaultViewport.width * VIEWPORT_MARGIN_FACTOR;
  const marginY = defaultViewport.height * VIEWPORT_MARGIN_FACTOR;
  const minX = defaultViewport.x - marginX;
  const maxX = defaultViewport.x + defaultViewport.width + marginX - width;
  const minY = defaultViewport.y - marginY;
  const maxY = defaultViewport.y + defaultViewport.height + marginY - height;

  return {
    x: minX <= maxX ? clamp(viewport.x, minX, maxX) : defaultViewport.x + 0.5 * (defaultViewport.width - width),
    y: minY <= maxY ? clamp(viewport.y, minY, maxY) : defaultViewport.y + 0.5 * (defaultViewport.height - height),
    width,
    height,
  };
}

function syncViewportWithStage(width: number, height: number): void {
  const nextStageSize = { width, height };
  const defaultViewport = createDefaultSceneViewport(width, height);
  if (stageSize.width === 0 || stageSize.height === 0) {
    stageSize = nextStageSize;
    sceneViewport = defaultViewport;
    viewportMode = "default";
    return;
  }

  if (stageSize.width === nextStageSize.width && stageSize.height === nextStageSize.height) {
    return;
  }

  sceneViewport = viewportMode === "default"
    ? defaultViewport
    : constrainViewport(scaleViewportToStage(sceneViewport, stageSize, nextStageSize), defaultViewport);
  stageSize = nextStageSize;
}

function setViewport(nextViewport: SceneViewport, mode: "default" | "custom"): void {
  const defaultViewport = createDefaultSceneViewport(stageSize.width, stageSize.height);
  sceneViewport = constrainViewport(nextViewport, defaultViewport);
  viewportMode = mode;
}

function resetViewport(): void {
  setViewport(createDefaultSceneViewport(stageSize.width, stageSize.height), "default");
  applySceneViewBox();
}

function scenePointFromClient(clientX: number, clientY: number): Point {
  const rect = scene.getBoundingClientRect();
  const normalizedX = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const normalizedY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return {
    x: sceneViewport.x + normalizedX * sceneViewport.width,
    y: sceneViewport.y + normalizedY * sceneViewport.height,
  };
}

function applySceneViewBox(): void {
  scene.setAttribute(
    "viewBox",
    `${sceneViewport.x.toFixed(2)} ${sceneViewport.y.toFixed(2)} ${sceneViewport.width.toFixed(2)} ${sceneViewport.height.toFixed(2)}`,
  );
}

function renderTransferPlot(): void {
  const bounds: PlotBounds = {
    minX: 0.0,
    maxX: 1.0,
    minY: 0.0,
    maxY: maxPlateau,
  };
  const samples = sampleTransferCurve(currentGain, currentPlateau, TRANSFER_PLOT_SAMPLE_COUNT);
  const pathData = transferCurvePathData(samples, bounds, TRANSFER_PLOT_FRAME);
  transferPlot.setAttribute("viewBox", `0 0 ${String(TRANSFER_PLOT_FRAME.width)} ${String(TRANSFER_PLOT_FRAME.height)}`);
  transferPlot.replaceChildren();

  const axisColor = "#6a675f";
  const curveColor = "#161616";
  const plateauColor = "#148a45";
  const referenceColor = "#d4372f";
  const origin = mapPlotPoint({ x: bounds.minX, y: bounds.minY }, bounds, TRANSFER_PLOT_FRAME);
  const xEnd = mapPlotPoint({ x: bounds.maxX, y: bounds.minY }, bounds, TRANSFER_PLOT_FRAME);
  const yEnd = mapPlotPoint({ x: bounds.minX, y: bounds.maxY }, bounds, TRANSFER_PLOT_FRAME);
  const plateauStart = mapPlotPoint({ x: bounds.minX, y: currentPlateau }, bounds, TRANSFER_PLOT_FRAME);
  const plateauEnd = mapPlotPoint({ x: bounds.maxX, y: currentPlateau }, bounds, TRANSFER_PLOT_FRAME);
  const kneeX = currentGain > 0.0 ? clamp(currentPlateau / currentGain, bounds.minX, bounds.maxX) : bounds.maxX;
  const kneePoint = mapPlotPoint({ x: kneeX, y: Math.min(currentPlateau, bounds.maxY) }, bounds, TRANSFER_PLOT_FRAME);

  transferPlot.append(
    createSvgLine(origin.x, origin.y, xEnd.x, xEnd.y, axisColor, 1.2, "4 4"),
    createSvgLine(origin.x, origin.y, yEnd.x, yEnd.y, axisColor, 1.2, "4 4"),
    createSvgLine(plateauStart.x, plateauStart.y, plateauEnd.x, plateauEnd.y, plateauColor, 1.0, "3 3"),
    createSvgLine(kneePoint.x, origin.y, kneePoint.x, kneePoint.y, referenceColor, 1.0, "3 3"),
    createSvgText(xEnd.x + 2, xEnd.y - 4, "x", "end"),
    createSvgText(origin.x + 4, yEnd.y - 4, "y", "start"),
    createSvgText(kneePoint.x + 4, kneePoint.y - 6, `f(1)=${satur(currentGain, currentPlateau).toFixed(2)}`, "start", "0.75rem"),
    createSvgPath(pathData, curveColor, 2.2),
  );
}

function createSvgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  strokeWidth: number,
  strokeDasharray: string,
): SVGLineElement {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", x1.toFixed(2));
  line.setAttribute("y1", y1.toFixed(2));
  line.setAttribute("x2", x2.toFixed(2));
  line.setAttribute("y2", y2.toFixed(2));
  line.setAttribute("stroke", stroke);
  line.setAttribute("stroke-width", strokeWidth.toFixed(2));
  line.setAttribute("stroke-dasharray", strokeDasharray);
  return line;
}

function createSvgText(x: number, y: number, content: string, textAnchor: "start" | "middle" | "end", fontSize = "0.78rem"): SVGTextElement {
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", x.toFixed(2));
  text.setAttribute("y", y.toFixed(2));
  text.setAttribute("fill", "#6a675f");
  text.setAttribute("font-size", fontSize);
  text.setAttribute("font-family", "IBM Plex Sans, Segoe UI, sans-serif");
  text.setAttribute("text-anchor", textAnchor);
  text.textContent = content;
  return text;
}

function createSvgPath(pathData: string, stroke: string, strokeWidth: number): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathData);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", strokeWidth.toFixed(2));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  return path;
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
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  syncViewportWithStage(width, height);
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

  applySceneViewBox();
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
  renderTransferPlot();
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

viewResetButton.addEventListener("click", () => {
  resetViewport();
});

gridEnabled.addEventListener("change", () => {
  render();
});

diagonalsEnabled.addEventListener("change", () => {
  render();
});

scene.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  if (stageSize.width <= 0 || stageSize.height <= 0) {
    return;
  }
  const anchor = scenePointFromClient(event.clientX, event.clientY);
  const zoomFactor = Math.exp(event.deltaY * 0.0015);
  const nextWidth = sceneViewport.width * zoomFactor;
  const nextHeight = sceneViewport.height * zoomFactor;
  const anchorRatioX = sceneViewport.width > 0.0 ? (anchor.x - sceneViewport.x) / sceneViewport.width : 0.5;
  const anchorRatioY = sceneViewport.height > 0.0 ? (anchor.y - sceneViewport.y) / sceneViewport.height : 0.5;
  setViewport({
    x: anchor.x - anchorRatioX * nextWidth,
    y: anchor.y - anchorRatioY * nextHeight,
    width: nextWidth,
    height: nextHeight,
  }, "custom");
  applySceneViewBox();
}, { passive: false });

scene.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) {
    return;
  }
  panState = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    originViewport: sceneViewport,
  };
  stage.classList.add("is-panning");
  scene.setPointerCapture(event.pointerId);
});

scene.addEventListener("pointermove", (event: PointerEvent) => {
  if (panState?.pointerId !== event.pointerId) {
    return;
  }
  const rect = scene.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const deltaX = (event.clientX - panState.clientX) / rect.width * panState.originViewport.width;
  const deltaY = (event.clientY - panState.clientY) / rect.height * panState.originViewport.height;
  setViewport({
    x: panState.originViewport.x - deltaX,
    y: panState.originViewport.y - deltaY,
    width: panState.originViewport.width,
    height: panState.originViewport.height,
  }, "custom");
  applySceneViewBox();
});

function clearPanState(pointerId: number): void {
  if (panState?.pointerId !== pointerId) {
    return;
  }
  panState = null;
  stage.classList.remove("is-panning");
}

scene.addEventListener("pointerup", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

scene.addEventListener("pointercancel", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

scene.addEventListener("lostpointercapture", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

const resizeObserver = new ResizeObserver(() => { render(); });

resizeObserver.observe(stage);
render();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
});
