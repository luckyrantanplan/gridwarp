import {
  mapPlotPoint,
  sampleTransferCurve,
  transferCurvePathData,
  type PlotBounds,
  type PlotFrame,
} from "./transfer-curve.js";
import { initializeNoisePreview } from "./noise-preview.js";
import { createInitialGeometry } from "./initial-geometry.js";
import { satur } from "../lib/saturation.js";
import type { WarpGeometry, WarpRequest, WarpResponse } from "../shared/warp-request.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALAR_CONTROL_DECIMALS = 2;
const VIEWPORT_MAX_SCALE = 6.0;
const VIEWPORT_MARGIN_FACTOR = 0.75;
const VIEWBOX_PRECISION = 12;
const TRANSFER_PLOT_SAMPLE_COUNT = 48;
const TRANSFER_PLOT_LABEL_MARGIN = 8;
const TRANSFER_PLOT_RIGHT_LABEL_THRESHOLD = 44;
const TRANSFER_PLOT_FRAME: PlotFrame = {
  width: 180,
  height: 120,
  paddingLeft: 22,
  paddingRight: 12,
  paddingTop: 12,
  paddingBottom: 22,
};

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

interface EditableNoiseParameters {
  readonly force: number;
  readonly scale: number;
  readonly silenceCutoffPercent: number;
  readonly gridSparseness: number;
  readonly showHeatmap: boolean;
  readonly vectorOverlayDensity: number;
  readonly spectralSlopeDbPerOct: number;
  readonly amplitudeContrast: number;
  readonly swirlDensity: number;
  readonly swirlMinimumAngleDegrees: number;
  readonly swirlStrengthPercent: number;
  readonly swirlFalloff: number;
  readonly swirlDirectionBias: number;
  readonly directionNoiseMix: number;
  readonly randomSeed: string;
}

interface PanState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly originViewport: SceneViewport;
}

const scene = getRequiredElement("scene", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const sourceScene = getRequiredElement("source-scene", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const caption = getRequiredElement("caption", (element): element is HTMLDivElement => element instanceof HTMLDivElement);
const sampleDensitySlider = getRequiredElement("sample-density-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const sampleDensityInput = getRequiredElement("sample-density-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const sampleDensityValue = getRequiredElement("sample-density-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const gainSlider = getRequiredElement("gain-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const gainInput = getRequiredElement("gain-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const gainValue = getRequiredElement("gain-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const plateauSlider = getRequiredElement("plateau-slider", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const plateauInput = getRequiredElement("plateau-input", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const plateauValue = getRequiredElement("plateau-value", (element): element is HTMLOutputElement => element instanceof HTMLOutputElement);
const transferPlot = getRequiredElement("transfer-plot", (element): element is SVGSVGElement => element instanceof SVGSVGElement);
const viewResetButton = getRequiredElement("view-reset", (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const sourceViewResetButton = getRequiredElement("source-view-reset", (element): element is HTMLButtonElement => element instanceof HTMLButtonElement);
const gridEnabled = getRequiredElement("grid-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const diagonalsEnabled = getRequiredElement("diagonals-enabled", (element): element is HTMLInputElement => element instanceof HTMLInputElement);
const stage = getRequiredParentElement(scene);
const sourceFrame = getRequiredParentElement(sourceScene);
const minSampleDensity = Number(sampleDensitySlider.min);
const maxSampleDensity = Number(sampleDensitySlider.max);
const minGain = Number(gainSlider.min);
const maxGain = Number(gainSlider.max);
const minPlateau = Number(plateauSlider.min);
const maxPlateau = Number(plateauSlider.max);

let currentSampleDensity = Number(sampleDensityInput.value);
let currentGain = Number(gainInput.value);
let currentPlateau = Number(plateauInput.value);
let currentNoiseParameters: EditableNoiseParameters | null = null;
let stageSize: StageSize = { width: 0, height: 0 };
let sceneViewport: SceneViewport = createDefaultSceneViewport(1, 1);
let viewportMode: "default" | "custom" = "default";
let panState: PanState | null = null;
let sourceDefaultViewport: SceneViewport = createDefaultSceneViewport(1, 1);
let sourceViewport: SceneViewport = createDefaultSceneViewport(1, 1);
let sourceViewportMode: "default" | "custom" = "default";
let sourcePanState: PanState | null = null;
let activeRequestId = 0;
let activeController: AbortController | null = null;

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
  const width = Math.min(viewport.width, defaultViewport.width * VIEWPORT_MAX_SCALE);
  const height = Math.min(viewport.height, defaultViewport.height * VIEWPORT_MAX_SCALE);
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

function viewportCenter(viewport: SceneViewport): Point {
  return {
    x: viewport.x + 0.5 * viewport.width,
    y: viewport.y + 0.5 * viewport.height,
  };
}

function zoomViewport(viewport: SceneViewport, zoomFactor: number, anchor: Point): SceneViewport {
  const nextWidth = viewport.width * zoomFactor;
  const nextHeight = viewport.height * zoomFactor;
  const anchorRatioX = viewport.width > 0.0 ? (anchor.x - viewport.x) / viewport.width : 0.5;
  const anchorRatioY = viewport.height > 0.0 ? (anchor.y - viewport.y) / viewport.height : 0.5;

  return {
    x: anchor.x - anchorRatioX * nextWidth,
    y: anchor.y - anchorRatioY * nextHeight,
    width: nextWidth,
    height: nextHeight,
  };
}

function applySceneViewBox(): void {
  applyViewBox(scene, sceneViewport);
}

function applySourceViewBox(): void {
  applyViewBox(sourceScene, sourceViewport);
}

function applyViewBox(target: SVGSVGElement, viewport: SceneViewport): void {
  target.setAttribute(
    "viewBox",
    `${formatViewBoxNumber(viewport.x)} ${formatViewBoxNumber(viewport.y)} ${formatViewBoxNumber(viewport.width)} ${formatViewBoxNumber(viewport.height)}`,
  );
}

function formatViewBoxNumber(value: number): string {
  return Number(value.toPrecision(VIEWBOX_PRECISION)).toString();
}

function setSourceViewport(nextViewport: SceneViewport, mode: "default" | "custom"): void {
  sourceViewport = constrainViewport(nextViewport, sourceDefaultViewport);
  sourceViewportMode = mode;
  applySourceViewBox();
}

function resetSourceViewport(): void {
  setSourceViewport(copyViewport(sourceDefaultViewport), "default");
}

function copyViewport(viewport: SceneViewport): SceneViewport {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
}

function parseViewBoxValue(viewBoxValue: string | null): SceneViewport {
  if (viewBoxValue === null) {
    throw new Error("SVG preview is missing a viewBox.");
  }

  const tokens = viewBoxValue.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length !== 4) {
    throw new Error("SVG preview viewBox must contain four numbers.");
  }

  const x = Number(tokens[0]);
  const y = Number(tokens[1]);
  const width = Number(tokens[2]);
  const height = Number(tokens[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("SVG preview viewBox is invalid.");
  }

  return { x, y, width, height };
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
  const kneeLabel = transferPlotValueLabel(kneePoint.x, kneePoint.y, `f(1)=${satur(currentGain, currentPlateau).toFixed(2)}`);

  transferPlot.append(
    createSvgLine(origin.x, origin.y, xEnd.x, xEnd.y, axisColor, 1.2, "4 4"),
    createSvgLine(origin.x, origin.y, yEnd.x, yEnd.y, axisColor, 1.2, "4 4"),
    createSvgLine(plateauStart.x, plateauStart.y, plateauEnd.x, plateauEnd.y, plateauColor, 1.0, "3 3"),
    createSvgLine(kneePoint.x, origin.y, kneePoint.x, kneePoint.y, referenceColor, 1.0, "3 3"),
    createSvgText(xEnd.x + 2, xEnd.y - 4, "x", "end"),
    createSvgText(origin.x + 4, yEnd.y - 4, "y", "start"),
    createSvgText(kneeLabel.x, kneeLabel.y, kneeLabel.content, kneeLabel.anchor, "0.75rem"),
    createSvgPath(pathData, curveColor, 2.2),
  );
}

function transferPlotValueLabel(x: number, y: number, content: string): { x: number; y: number; content: string; anchor: "start" | "end" } {
  const rightEdge = TRANSFER_PLOT_FRAME.width - TRANSFER_PLOT_FRAME.paddingRight;
  if (x >= rightEdge - TRANSFER_PLOT_RIGHT_LABEL_THRESHOLD) {
    return {
      x: x - TRANSFER_PLOT_LABEL_MARGIN,
      y: y - 6,
      content,
      anchor: "end",
    };
  }

  return {
    x: x + TRANSFER_PLOT_LABEL_MARGIN,
    y: y - 6,
    content,
    anchor: "start",
  };
}

function createSvgLine(x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth: number, strokeDasharray: string): SVGLineElement {
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

function syncScalarControls(): void {
  const formattedSampleDensity = currentSampleDensity.toFixed(SCALAR_CONTROL_DECIMALS);
  const formattedGain = currentGain.toFixed(SCALAR_CONTROL_DECIMALS);
  const formattedPlateau = currentPlateau.toFixed(SCALAR_CONTROL_DECIMALS);
  sampleDensitySlider.value = formattedSampleDensity;
  sampleDensityInput.value = formattedSampleDensity;
  sampleDensityValue.textContent = formattedSampleDensity;
  gainSlider.value = formattedGain;
  gainInput.value = formattedGain;
  gainValue.textContent = formattedGain;
  plateauSlider.value = formattedPlateau;
  plateauInput.value = formattedPlateau;
  plateauValue.textContent = formattedPlateau;
}

function setCurrentSampleDensity(nextSampleDensity: number): void {
  if (!Number.isFinite(nextSampleDensity)) {
    syncScalarControls();
    return;
  }
  currentSampleDensity = clamp(nextSampleDensity, minSampleDensity, maxSampleDensity);
  syncScalarControls();
  renderTransferPlot();
  void requestScene();
}

function setCurrentGain(nextGain: number): void {
  if (!Number.isFinite(nextGain)) {
    syncScalarControls();
    return;
  }
  currentGain = clamp(nextGain, minGain, maxGain);
  syncScalarControls();
  renderTransferPlot();
  void requestScene();
}

function setCurrentPlateau(nextPlateau: number): void {
  if (!Number.isFinite(nextPlateau)) {
    syncScalarControls();
    return;
  }
  currentPlateau = clamp(nextPlateau, minPlateau, maxPlateau);
  syncScalarControls();
  renderTransferPlot();
  void requestScene();
}

function commitSampleDensityInputValue(): void {
  const rawValue = sampleDensityInput.value.trim();
  if (rawValue === "") {
    syncScalarControls();
    return;
  }
  setCurrentSampleDensity(Number(rawValue));
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

async function requestScene(): Promise<void> {
  const width = Math.max(stage.clientWidth, 1);
  const height = Math.max(stage.clientHeight, 1);
  syncViewportWithStage(width, height);
  applySceneViewBox();

  const geometry = createCurrentGeometry(width, height);
  applySourceSvg(geometry.svg);
  if (currentNoiseParameters === null) {
    return;
  }

  const requestPayload: WarpRequest = {
    geometry,
    renderWidth: width,
    renderHeight: height,
    samplesPerUnit: currentSampleDensity,
    gain: currentGain,
    plateau: currentPlateau,
    noiseParameters: currentNoiseParameters,
  };

  activeRequestId += 1;
  const requestId = activeRequestId;
  activeController?.abort();
  const controller = new AbortController();
  activeController = controller;
  caption.textContent = "Updating…";

  try {
    const response = await fetch("/api/warp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Warp request failed with status ${String(response.status)}.`);
    }

    const payload = await response.json() as WarpResponse;
    if (requestId !== activeRequestId) {
      return;
    }

    applyServerSvg(payload.svg);
    applySceneViewBox();
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    const message = error instanceof Error ? error.message : "Unknown render error";
    scene.replaceChildren();
    caption.textContent = message;
  } finally {
    if (activeController === controller) {
      activeController = null;
    }
  }
}

function createCurrentGeometry(renderWidth: number, renderHeight: number): WarpGeometry {
  return createInitialGeometry(renderWidth, renderHeight, gridEnabled.checked, diagonalsEnabled.checked);
}

function createCurrentStageGeometry(): WarpGeometry {
  return createCurrentGeometry(Math.max(stage.clientWidth, 1), Math.max(stage.clientHeight, 1));
}

function applySourceSvg(svgMarkup: string): void {
  const parsedScene = parseSvgDocument(svgMarkup);
  replaceSvgChildren(sourceScene, parsedScene);
  sourceDefaultViewport = parseViewBoxValue(parsedScene.getAttribute("viewBox"));
  sourceViewport = sourceViewportMode === "default"
    ? copyViewport(sourceDefaultViewport)
    : constrainViewport(sourceViewport, sourceDefaultViewport);
  applySourceViewBox();
}

function applyServerSvg(svgMarkup: string): void {
  const parsedScene = parseSvgDocument(svgMarkup);
  replaceSvgChildren(scene, parsedScene);
  caption.textContent = parsedScene.getAttribute("data-caption") ?? "";
}

function parseSvgDocument(svgMarkup: string): SVGSVGElement {
  const documentParser = new DOMParser();
  const parsedDocument = documentParser.parseFromString(svgMarkup, "image/svg+xml");
  const parsedScene = parsedDocument.documentElement;
  if (parsedScene.localName !== "svg") {
    throw new Error("Server returned an invalid SVG document.");
  }

  const parserError = parsedDocument.querySelector("parsererror");
  if (parserError) {
    throw new Error("Server returned malformed SVG markup.");
  }

  return parsedScene as unknown as SVGSVGElement;
}

function replaceSvgChildren(target: SVGSVGElement, source: SVGSVGElement): void {
  const viewBox = source.getAttribute("viewBox");
  if (viewBox) {
    target.setAttribute("viewBox", viewBox);
  } else {
    target.removeAttribute("viewBox");
  }

  const importedChildren = Array.from(source.childNodes, (child) => document.importNode(child, true));
  target.replaceChildren(...importedChildren);
}

sampleDensitySlider.addEventListener("input", () => {
  setCurrentSampleDensity(Number(sampleDensitySlider.value));
});

sampleDensityInput.addEventListener("change", () => {
  commitSampleDensityInputValue();
});

sampleDensityInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  commitSampleDensityInputValue();
});

gainSlider.addEventListener("input", () => {
  setCurrentGain(Number(gainSlider.value));
});

gainInput.addEventListener("change", () => {
  commitGainInputValue();
});

gainInput.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.key !== "Enter") {
    return;
  }
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
  if (event.key !== "Enter") {
    return;
  }
  event.preventDefault();
  commitPlateauInputValue();
});

viewResetButton.addEventListener("click", () => {
  resetViewport();
});

sourceViewResetButton.addEventListener("click", () => {
  resetSourceViewport();
});

gridEnabled.addEventListener("change", () => {
  void requestScene();
});

diagonalsEnabled.addEventListener("change", () => {
  void requestScene();
});

scene.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  if (stageSize.width <= 0 || stageSize.height <= 0) {
    return;
  }
  const zoomFactor = Math.exp(event.deltaY * 0.0015);
  setViewport(zoomViewport(sceneViewport, zoomFactor, viewportCenter(sceneViewport)), "custom");
  applySceneViewBox();
}, { passive: false });

sourceScene.addEventListener("wheel", (event: WheelEvent) => {
  event.preventDefault();
  const zoomFactor = Math.exp(event.deltaY * 0.0015);
  setSourceViewport(zoomViewport(sourceViewport, zoomFactor, viewportCenter(sourceViewport)), "custom");
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

sourceScene.addEventListener("pointerdown", (event: PointerEvent) => {
  if (event.button !== 0) {
    return;
  }
  sourcePanState = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    originViewport: sourceViewport,
  };
  sourceFrame.classList.add("is-panning");
  sourceScene.setPointerCapture(event.pointerId);
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

sourceScene.addEventListener("pointermove", (event: PointerEvent) => {
  if (sourcePanState?.pointerId !== event.pointerId) {
    return;
  }
  const rect = sourceScene.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const deltaX = (event.clientX - sourcePanState.clientX) / rect.width * sourcePanState.originViewport.width;
  const deltaY = (event.clientY - sourcePanState.clientY) / rect.height * sourcePanState.originViewport.height;
  setSourceViewport({
    x: sourcePanState.originViewport.x - deltaX,
    y: sourcePanState.originViewport.y - deltaY,
    width: sourcePanState.originViewport.width,
    height: sourcePanState.originViewport.height,
  }, "custom");
});

function clearPanState(pointerId: number): void {
  if (panState?.pointerId !== pointerId) {
    return;
  }
  panState = null;
  stage.classList.remove("is-panning");
}

function clearSourcePanState(pointerId: number): void {
  if (sourcePanState?.pointerId !== pointerId) {
    return;
  }
  sourcePanState = null;
  sourceFrame.classList.remove("is-panning");
}

scene.addEventListener("pointerup", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

sourceScene.addEventListener("pointerup", (event: PointerEvent) => {
  clearSourcePanState(event.pointerId);
});

scene.addEventListener("pointercancel", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

sourceScene.addEventListener("pointercancel", (event: PointerEvent) => {
  clearSourcePanState(event.pointerId);
});

scene.addEventListener("lostpointercapture", (event: PointerEvent) => {
  clearPanState(event.pointerId);
});

sourceScene.addEventListener("lostpointercapture", (event: PointerEvent) => {
  clearSourcePanState(event.pointerId);
});

const resizeObserver = new ResizeObserver(() => {
  void requestScene();
});

resizeObserver.observe(stage);
void initializeApplication();

window.addEventListener("beforeunload", () => {
  resizeObserver.disconnect();
  activeController?.abort();
});

async function initializeApplication(): Promise<void> {
  await initializeNoisePreview(createCurrentStageGeometry, (nextParameters: EditableNoiseParameters) => {
    currentNoiseParameters = nextParameters;
    void requestScene();
  });
  syncScalarControls();
  renderTransferPlot();
  await requestScene();
}

interface Point {
  readonly x: number;
  readonly y: number;
}