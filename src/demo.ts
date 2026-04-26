import {
  createAffineFieldGrid,
  type AffineGridSpec,
} from "./lib/affine-field-grid.js";
import { createCenteredRadialAffinePair } from "./lib/deformation-field.js";
import { AffineGridWarpField } from "./lib/warp-field.js";
import { WarpFieldContext } from "./demo/field-context.js";
import { LeafCellCollector, LeafCellCollectorSettings } from "./demo/leaf-cell-collector.js";
import { PointBucketIndex } from "./demo/point-bucket-index.js";
import { SvgContourRenderer } from "./demo/svg-contour-renderer.js";
import type {
  Axis,
  Cell,
  FieldContext,
  Point,
  ScreenNode,
  Segment,
  TangentSample,
  TracedComponent,
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
const STROKE_WIDTH = 2.2;
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

function mix(a: number, b: number, amount: number): number {
  return a * (1 - amount) + b * amount;
}

function distance(pointA: Point, pointB: Point): number {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function dot(vectorA: Point, vectorB: Point): number {
  return vectorA.x * vectorB.x + vectorA.y * vectorB.y;
}

function normalize(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-9) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function reverseSamples(samples: readonly TangentSample[]): TangentSample[] {
  return samples.slice().reverse().map((sample) => ({
    x: sample.x,
    y: sample.y,
    tangent: {
      x: -sample.tangent.x,
      y: -sample.tangent.y,
    },
  }));
}

function createBilinearAffineWarpField(
  width: number,
  height: number,
  time: number,
  columns: number,
  rows: number,
): WarpField {
  const { xMax, yMax } = visibleBounds(width, height);
  const spec: AffineGridSpec = {
    columns,
    rows,
    minReal: -xMax,
    maxReal: xMax,
    minImag: -yMax,
    maxImag: yMax,
    time,
  };
  const affineFieldGrid = createAffineFieldGrid(spec, createCenteredRadialAffinePair);
  return new AffineGridWarpField(width, height, spec, affineFieldGrid, AFFINE_GRID_JACOBIAN_EPSILON);
}

// ---------------------------------------------------------------------------
// Viewport bounds / grid level sets
// ---------------------------------------------------------------------------

function visibleBounds(width: number, height: number): { xMax: number; yMax: number } {
  return {
    xMax: 5 * width / height,
    yMax: 5,
  };
}

function maxWarpedRadius(width: number, height: number, warp: WarpField): number {
  const { xMax, yMax } = visibleBounds(width, height);
  const planeScale = height / 10;
  let maximum = 0;
  for (let step = 0; step <= 256; step += 1) {
    const t = step / 256;
    const screenX = width * 0.5 + planeScale * t * xMax;
    const screenY = height * 0.5 - planeScale * t * yMax;
    const v = warp.valueAt(screenX, screenY);
    maximum = Math.max(maximum, Math.hypot(v.warpedX, v.warpedY));
  }
  return maximum + 1;
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

// ---------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------

function interpolateZero(nodeA: ScreenNode, valueA: number, nodeB: ScreenNode, valueB: number): Point {
  const amount = Math.abs(valueA - valueB) < 1e-6 ? 0.5 : clamp(valueA / (valueA - valueB), 0, 1);
  return {
    x: mix(nodeA.screenX, nodeB.screenX, amount),
    y: mix(nodeA.screenY, nodeB.screenY, amount),
  };
}

function pushCellSegments(segments: Segment[], cell: Cell, axis: Axis, offset: number, warp: WarpField): void {
  const { tl, tr, br, bl } = cell;
  const vTL = tl[axis] - offset;
  const vTR = tr[axis] - offset;
  const vBR = br[axis] - offset;
  const vBL = bl[axis] - offset;

  const maxV = Math.max(vTL, vTR, vBR, vBL);
  const minV = Math.min(vTL, vTR, vBR, vBL);
  if (minV > 0 || maxV < 0) return;

  const mask = (vTL > 0 ? 1 : 0) | (vTR > 0 ? 2 : 0) | (vBR > 0 ? 4 : 0) | (vBL > 0 ? 8 : 0);
  if (mask === 0 || mask === 15) return;

  const top = (): Point => interpolateZero(tl, vTL, tr, vTR);
  const right = (): Point => interpolateZero(tr, vTR, br, vBR);
  const bottom = (): Point => interpolateZero(br, vBR, bl, vBL);
  const left = (): Point => interpolateZero(bl, vBL, tl, vTL);

  switch (mask) {
    case 1:
    case 14:
      segments.push([top(), left()]);
      return;
    case 2:
    case 13:
      segments.push([top(), right()]);
      return;
    case 3:
    case 12:
      segments.push([left(), right()]);
      return;
    case 4:
    case 11:
      segments.push([right(), bottom()]);
      return;
    case 6:
    case 9:
      segments.push([top(), bottom()]);
      return;
    case 7:
    case 8:
      segments.push([left(), bottom()]);
      return;
    case 5: {
      const cx = 0.25 * (tl.screenX + tr.screenX + br.screenX + bl.screenX);
      const cy = 0.25 * (tl.screenY + tr.screenY + br.screenY + bl.screenY);
      const centreValue = warp.valueAt(cx, cy)[axis] - offset;
      if (centreValue > 0) {
        segments.push([top(), right()]);
        segments.push([bottom(), left()]);
      } else {
        segments.push([top(), left()]);
        segments.push([bottom(), right()]);
      }
      return;
    }
    case 10: {
      const cx = 0.25 * (tl.screenX + tr.screenX + br.screenX + bl.screenX);
      const cy = 0.25 * (tl.screenY + tr.screenY + br.screenY + bl.screenY);
      const centreValue = warp.valueAt(cx, cy)[axis] - offset;
      if (centreValue > 0) {
        segments.push([top(), left()]);
        segments.push([bottom(), right()]);
      } else {
        segments.push([top(), right()]);
        segments.push([bottom(), left()]);
      }
      return;
    }
    default:
      return;
  }
}

function buildSegmentsForLevel(offset: number, axis: Axis, leafCells: readonly Cell[], warp: WarpField): Segment[] {
  const segments: Segment[] = [];
  for (const cell of leafCells) {
    pushCellSegments(segments, cell, axis, offset, warp);
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Field adapter + contour tracer
// ---------------------------------------------------------------------------

function projectToContour(field: FieldContext, axis: Axis, offset: number, point: Point): Point | null {
  let x = point.x;
  let y = point.y;

  for (let iteration = 0; iteration < MAX_PROJECTION_ITERATIONS; iteration += 1) {
    const value = field.value(axis, offset, x, y);
    if (Math.abs(value) < NEWTON_TOLERANCE) return { x, y };

    const gradient = field.gradient(axis, offset, x, y);
    const normSquared = gradient.x * gradient.x + gradient.y * gradient.y;
    if (normSquared < MIN_GRADIENT_NORM * MIN_GRADIENT_NORM) return null;

    let dx = -value * gradient.x / normSquared;
    let dy = -value * gradient.y / normSquared;
    const displacement = Math.hypot(dx, dy);
    if (displacement > MAX_NEWTON_DISPLACEMENT) {
      const scale = MAX_NEWTON_DISPLACEMENT / displacement;
      dx *= scale;
      dy *= scale;
    }

    x = clamp(x + dx, 0, field.width);
    y = clamp(y + dy, 0, field.height);
  }

  return Math.abs(field.value(axis, offset, x, y)) < NEWTON_TOLERANCE * 4 ? { x, y } : null;
}

function tangentFromGradient(gradient: Point, previousTangent: Point | null): Point | null {
  const tangent = normalize({ x: -gradient.y, y: gradient.x });
  if (!tangent) return null;
  if (previousTangent && dot(tangent, previousTangent) < 0) {
    return { x: -tangent.x, y: -tangent.y };
  }
  return tangent;
}

function isOnBoundary(point: Point, field: FieldContext): boolean {
  return point.x <= 0.5
    || point.x >= field.width - 0.5
    || point.y <= 0.5
    || point.y >= field.height - 0.5;
}

function traceDirection(
  field: FieldContext,
  axis: Axis,
  offset: number,
  seedSample: TangentSample,
  direction: number,
): TracedComponent {
  const seedDirectionTangent = {
    x: seedSample.tangent.x * direction,
    y: seedSample.tangent.y * direction,
  };
  let current: TangentSample = {
    x: seedSample.x,
    y: seedSample.y,
    tangent: seedDirectionTangent,
  };
  let step = INITIAL_TRACE_STEP;
  let arcLength = 0;
  const samples: TangentSample[] = [];

  for (let iteration = 0; iteration < MAX_TRACE_STEPS; iteration += 1) {
    let attempt = step;
    let accepted: TangentSample | null = null;

    while (attempt >= TRACE_MIN_STEP) {
      const midpointGuess = {
        x: current.x + current.tangent.x * attempt * 0.5,
        y: current.y + current.tangent.y * attempt * 0.5,
      };
      const projectedMidpoint = projectToContour(field, axis, offset, midpointGuess);
      if (!projectedMidpoint) { attempt *= 0.5; continue; }

      const midpointGradient = field.gradient(axis, offset, projectedMidpoint.x, projectedMidpoint.y);
      if (Math.hypot(midpointGradient.x, midpointGradient.y) < MIN_GRADIENT_NORM) { attempt *= 0.5; continue; }

      const midpointTangent = tangentFromGradient(midpointGradient, current.tangent);
      if (!midpointTangent) { attempt *= 0.5; continue; }

      const predicted = {
        x: current.x + midpointTangent.x * attempt,
        y: current.y + midpointTangent.y * attempt,
      };
      const projected = projectToContour(field, axis, offset, predicted);
      if (!projected) { attempt *= 0.5; continue; }

      const gradient = field.gradient(axis, offset, projected.x, projected.y);
      if (Math.hypot(gradient.x, gradient.y) < MIN_GRADIENT_NORM) { attempt *= 0.5; continue; }

      const tangent = tangentFromGradient(gradient, current.tangent);
      if (!tangent) { attempt *= 0.5; continue; }

      const correction = distance(predicted, projected);
      const turn = Math.acos(clamp(dot(current.tangent, tangent), -1, 1));
      if (turn > MAX_TRACE_TURN || correction > TRACE_TARGET_CORRECTION * 3) {
        attempt *= 0.5;
        continue;
      }

      accepted = { x: projected.x, y: projected.y, tangent };
      const safeCorrection = Math.max(correction, TRACE_TARGET_CORRECTION * 0.01);
      const stepFactor = clamp(Math.sqrt(TRACE_TARGET_CORRECTION / safeCorrection), 0.3, 2);
      step = clamp(attempt * stepFactor, TRACE_MIN_STEP, MAX_TRACE_STEP);
      break;
    }

    if (!accepted) return { samples, closed: false };

    arcLength += distance(current, accepted);
    if (arcLength > MIN_LOOP_ARC_LENGTH
        && distance(accepted, seedSample) < LOOP_CLOSURE_DISTANCE
        && dot(accepted.tangent, seedDirectionTangent) > 0.5) {
      return { samples, closed: true };
    }

    samples.push(accepted);
    current = accepted;

    if (isOnBoundary(current, field) && arcLength > INITIAL_TRACE_STEP) {
      return { samples, closed: false };
    }
  }

  return { samples, closed: false };
}

function traceContourComponent(field: FieldContext, axis: Axis, offset: number, seed: Point): TracedComponent | null {
  const projectedSeed = projectToContour(field, axis, offset, seed);
  if (!projectedSeed) return null;

  const seedGradient = field.gradient(axis, offset, projectedSeed.x, projectedSeed.y);
  if (Math.hypot(seedGradient.x, seedGradient.y) < MIN_GRADIENT_NORM) return null;

  const seedTangent = tangentFromGradient(seedGradient, null);
  if (!seedTangent) return null;

  const seedSample: TangentSample = { x: projectedSeed.x, y: projectedSeed.y, tangent: seedTangent };
  const forward = traceDirection(field, axis, offset, seedSample, 1);
  if (forward.closed) return { closed: true, samples: [seedSample, ...forward.samples] };

  const backward = traceDirection(field, axis, offset, seedSample, -1);
  if (backward.closed) return { closed: true, samples: [seedSample, ...backward.samples] };

  const samples = [...reverseSamples(backward.samples), seedSample, ...forward.samples];
  return samples.length > 1 ? { closed: false, samples } : null;
}

function collectSeedCandidates(offset: number, axis: Axis, leafCells: readonly Cell[], warp: WarpField): Point[] {
  const segments = buildSegmentsForLevel(offset, axis, leafCells, warp);
  const seedIndex = new PointBucketIndex(SEED_DEDUP_DISTANCE * 2);
  const seeds: Point[] = [];
  for (const [startPoint, endPoint] of segments) {
    const seed = {
      x: 0.5 * (startPoint.x + endPoint.x),
      y: 0.5 * (startPoint.y + endPoint.y),
    };
    if (seedIndex.hasNearby(seed, SEED_DEDUP_DISTANCE)) continue;
    seedIndex.addPoint(seed);
    seeds.push(seed);
  }
  return seeds;
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
  for (const offset of offsets) {
    const seeds = collectSeedCandidates(offset, axis, leafCells, warp);
    const visitedSeeds = new PointBucketIndex(VISITED_BUCKET_SIZE);

    for (const seed of seeds) {
      if (visitedSeeds.hasNearby(seed, VISITED_SEED_DISTANCE)) continue;

      const component = traceContourComponent(field, axis, offset, seed);
      if (!component) continue;

      for (const sample of component.samples) {
        visitedSeeds.addPoint(sample);
      }
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

function smallestLeafSize(leafCells: readonly Cell[]): number {
  let smallest = Infinity;
  for (const cell of leafCells) {
    const w = cell.tr.screenX - cell.tl.screenX;
    const h = cell.bl.screenY - cell.tl.screenY;
    smallest = Math.min(smallest, w, h);
  }
  return Number.isFinite(smallest) ? smallest : MAX_CONTOUR_CELL_SIZE;
}

function render(): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;

  const warp = createBilinearAffineWarpField(
    width,
    height,
    currentTime,
    AFFINE_GRID_COLUMNS,
    AFFINE_GRID_ROWS,
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
  const smallestCell = smallestLeafSize(leafCells).toFixed(1);
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