import {
  complex,
  createBilinearAffineField as createAffineGridHandle,
  type AffineGridSpec,
} from "./lib/affine-grid.js";

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TangentSample extends Point {
  readonly tangent: Point;
}

interface WarpValue {
  readonly warpedX: number;
  readonly warpedY: number;
}

interface Jacobian {
  readonly xx: number;
  readonly xy: number;
  readonly yx: number;
  readonly yy: number;
}

interface Bounds {
  readonly width: number;
  readonly height: number;
}

interface WarpField {
  valueAt(screenX: number, screenY: number): WarpValue;
  jacobianAt(screenX: number, screenY: number): Jacobian;
  bounds(): Bounds;
}

interface ValueOnlyWarpField {
  valueAt(screenX: number, screenY: number): WarpValue;
  bounds(): Bounds;
}

interface ScreenNode extends WarpValue {
  readonly screenX: number;
  readonly screenY: number;
}

interface Cell {
  readonly tl: ScreenNode;
  readonly tr: ScreenNode;
  readonly br: ScreenNode;
  readonly bl: ScreenNode;
}

interface FieldContext {
  readonly width: number;
  readonly height: number;
  value(axis: Axis, offset: number, x: number, y: number): number;
  gradient(axis: Axis, offset: number, x: number, y: number): Point;
}

interface TracedComponent {
  readonly closed: boolean;
  readonly samples: TangentSample[];
}

interface PointIndex {
  hasNearby(point: Point, maxDistance: number): boolean;
  addPoint(point: Point): void;
}

interface BilinearAffineFieldConfig {
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly columns: number;
  readonly rows: number;
}

type Axis = keyof WarpValue;
type Segment = readonly [Point, Point];

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

// ---------------------------------------------------------------------------
// Warp field abstraction.
// ---------------------------------------------------------------------------

function withFiniteDifferenceJacobian(warpField: ValueOnlyWarpField, epsilon = 0.75): WarpField {
  const { width, height } = warpField.bounds();
  return {
    valueAt: (x: number, y: number) => warpField.valueAt(x, y),
    jacobianAt(x: number, y: number): Jacobian {
      const x0 = clamp(x - epsilon, 0, width);
      const x1 = clamp(x + epsilon, 0, width);
      const y0 = clamp(y - epsilon, 0, height);
      const y1 = clamp(y + epsilon, 0, height);
      const sx1 = warpField.valueAt(x1, y);
      const sx0 = warpField.valueAt(x0, y);
      const sy1 = warpField.valueAt(x, y1);
      const sy0 = warpField.valueAt(x, y0);
      const dx = Math.max(1e-6, x1 - x0);
      const dy = Math.max(1e-6, y1 - y0);
      return {
        xx: (sx1.warpedX - sx0.warpedX) / dx,
        xy: (sy1.warpedX - sy0.warpedX) / dy,
        yx: (sx1.warpedY - sx0.warpedY) / dx,
        yy: (sy1.warpedY - sy0.warpedY) / dy,
      };
    },
    bounds: () => ({ width, height }),
  };
}

function createCenteredRadialWarp(width: number, height: number, time: number): WarpField {
  const planeScale = height / 10;

  function toPlane(x: number, y: number): Point {
    return {
      x: (x - width * 0.5) / planeScale,
      y: (height * 0.5 - y) / planeScale,
    };
  }

  function radialCoefficients(radius: number): { angle: number; sigma: number; sigmaROverR: number; thetaROverR: number } {
    const weight = Math.exp(-0.16 * radius * radius);
    const angle = time * (0.0022 + 0.01 * weight) * weight;
    const pullBase = time * (0.015 + 0.075 * weight);
    const u = 1 + pullBase * weight;
    const softness = 0.2;
    const ttRaw = (u - 3 + softness) / (2 * softness);
    const tt = clamp(ttRaw, 0, 1);
    const h = tt * tt * tt * (tt * (tt * 6 - 15) + 10);
    const sigma = u + h * (3 - u);

    const wOverR = -0.32 * weight;
    const uROverR = wOverR * time * (0.015 + 0.15 * weight);
    const thetaROverR = wOverR * time * (0.0022 + 0.02 * weight);

    let bracket = 1 - h;
    if (ttRaw > 0 && ttRaw < 1) {
      const dhdtt = 30 * tt * tt * (1 - tt) * (1 - tt);
      bracket += (3 - u) * dhdtt / (2 * softness);
    }
    const sigmaROverR = uROverR * bracket;

    return { angle, sigma, sigmaROverR, thetaROverR };
  }

  function valueAt(x: number, y: number): WarpValue {
    const p = toPlane(x, y);
    const r = Math.hypot(p.x, p.y);
    const { angle, sigma } = radialCoefficients(r);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    return {
      warpedX: sigma * (cosA * p.x - sinA * p.y),
      warpedY: sigma * (sinA * p.x + cosA * p.y),
    };
  }

  function jacobianAt(x: number, y: number): Jacobian {
    const p = toPlane(x, y);
    const r = Math.hypot(p.x, p.y);
    const { angle, sigma, sigmaROverR, thetaROverR } = radialCoefficients(r);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const rhoX = cosA * p.x - sinA * p.y;
    const rhoY = sinA * p.x + cosA * p.y;
    const rPerpPX = -cosA * p.y - sinA * p.x;
    const rPerpPY = -sinA * p.y + cosA * p.x;

    const kx = sigmaROverR * rhoX + sigma * thetaROverR * rPerpPX;
    const ky = sigmaROverR * rhoY + sigma * thetaROverR * rPerpPY;

    const jPlaneXX = sigma * cosA + kx * p.x;
    const jPlaneXY = -sigma * sinA + kx * p.y;
    const jPlaneYX = sigma * sinA + ky * p.x;
    const jPlaneYY = sigma * cosA + ky * p.y;

    const invS = 1 / planeScale;
    return {
      xx: jPlaneXX * invS,
      xy: -jPlaneXY * invS,
      yx: jPlaneYX * invS,
      yy: -jPlaneYY * invS,
    };
  }

  return {
    valueAt,
    jacobianAt,
    bounds: () => ({ width, height }),
  };
}

function createBilinearAffineField(config: BilinearAffineFieldConfig): WarpField {
  const planeScale = config.height / 10;
  const { xMax, yMax } = visibleBounds(config.width, config.height);
  const spec: AffineGridSpec = {
    columns: config.columns,
    rows: config.rows,
    minReal: -xMax,
    maxReal: xMax,
    minImag: -yMax,
    maxImag: yMax,
    time: config.time,
  };
  const handle = createAffineGridHandle(spec);

  return withFiniteDifferenceJacobian({
    valueAt(x: number, y: number): WarpValue {
      const planePoint = {
        x: (x - config.width * 0.5) / planeScale,
        y: (config.height * 0.5 - y) / planeScale,
      };
      const warped = handle.transform(complex(planePoint.x, planePoint.y), planePoint.x, planePoint.y);
      return {
        warpedX: warped.real,
        warpedY: warped.imag,
      };
    },
    bounds: () => ({ width: config.width, height: config.height }),
  });
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

function maxWarpedRadius(width: number, height: number, time: number): number {
  const { xMax, yMax } = visibleBounds(width, height);
  const probe = createCenteredRadialWarp(width, height, time);
  const planeScale = height / 10;
  let maximum = 0;
  for (let step = 0; step <= 256; step += 1) {
    const t = step / 256;
    const screenX = width * 0.5 + planeScale * t * xMax;
    const screenY = height * 0.5 - planeScale * t * yMax;
    const v = probe.valueAt(screenX, screenY);
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

function coordinateAxis(length: number, cellSize: number): number[] {
  const steps = Math.max(2, Math.ceil(length / cellSize));
  const coordinates: number[] = [];
  for (let index = 0; index <= steps; index += 1) {
    coordinates.push(length * index / steps);
  }
  return coordinates;
}

// ---------------------------------------------------------------------------
// Quadtree of leaf cells
// ---------------------------------------------------------------------------

function sampleNode(warp: WarpField, x: number, y: number): ScreenNode {
  const v = warp.valueAt(x, y);
  return { screenX: x, screenY: y, warpedX: v.warpedX, warpedY: v.warpedY };
}

function axisCurvatureError(
  topLeft: ScreenNode,
  topRight: ScreenNode,
  bottomRight: ScreenNode,
  bottomLeft: ScreenNode,
  topMid: ScreenNode,
  rightMid: ScreenNode,
  bottomMid: ScreenNode,
  leftMid: ScreenNode,
  center: ScreenNode,
  axis: Axis,
): number {
  return Math.max(
    Math.abs(center[axis] - 0.25 * (topLeft[axis] + topRight[axis] + bottomRight[axis] + bottomLeft[axis])),
    Math.abs(topMid[axis] - 0.5 * (topLeft[axis] + topRight[axis])),
    Math.abs(rightMid[axis] - 0.5 * (topRight[axis] + bottomRight[axis])),
    Math.abs(bottomMid[axis] - 0.5 * (bottomLeft[axis] + bottomRight[axis])),
    Math.abs(leftMid[axis] - 0.5 * (topLeft[axis] + bottomLeft[axis])),
  );
}

function collectLeafCells(width: number, height: number, warp: WarpField): Cell[] {
  const xCoords = coordinateAxis(width, MAX_CONTOUR_CELL_SIZE);
  const yCoords = coordinateAxis(height, MAX_CONTOUR_CELL_SIZE);
  const rows = yCoords.length - 1;
  const cols = xCoords.length - 1;

  const baseNodes: ScreenNode[][] = [];
  for (let row = 0; row <= rows; row += 1) {
    const nodeRow: ScreenNode[] = [];
    for (let col = 0; col <= cols; col += 1) {
      nodeRow.push(sampleNode(warp, xCoords[col], yCoords[row]));
    }
    baseNodes.push(nodeRow);
  }

  const leafCells: Cell[] = [];

  function refineCell(tl: ScreenNode, tr: ScreenNode, br: ScreenNode, bl: ScreenNode, depth: number): void {
    const cellWidth = tr.screenX - tl.screenX;
    const cellHeight = bl.screenY - tl.screenY;

    if (depth >= MAX_ADAPTIVE_DEPTH || Math.max(cellWidth, cellHeight) * 0.5 < MIN_CONTOUR_CELL_SIZE) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    const midX = 0.5 * (tl.screenX + tr.screenX);
    const midY = 0.5 * (tl.screenY + bl.screenY);
    const topMid = sampleNode(warp, midX, tl.screenY);
    const rightMid = sampleNode(warp, tr.screenX, midY);
    const bottomMid = sampleNode(warp, midX, bl.screenY);
    const leftMid = sampleNode(warp, tl.screenX, midY);
    const center = sampleNode(warp, midX, midY);

    const curvature = Math.max(
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedX"),
      axisCurvatureError(tl, tr, br, bl, topMid, rightMid, bottomMid, leftMid, center, "warpedY"),
    );

    if (curvature <= CURVATURE_ERROR_THRESHOLD) {
      leafCells.push({ tl, tr, br, bl });
      return;
    }

    refineCell(tl, topMid, center, leftMid, depth + 1);
    refineCell(topMid, tr, rightMid, center, depth + 1);
    refineCell(center, rightMid, br, bottomMid, depth + 1);
    refineCell(leftMid, center, bottomMid, bl, depth + 1);
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      refineCell(
        baseNodes[row][col],
        baseNodes[row][col + 1],
        baseNodes[row + 1][col + 1],
        baseNodes[row + 1][col],
        1,
      );
    }
  }

  return leafCells;
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
// Seed deduplication
// ---------------------------------------------------------------------------

function createPointIndex(bucketSize: number): PointIndex {
  const buckets = new Map<string, Point[]>();

  function baseBucket(point: Point): Point {
    return { x: Math.floor(point.x / bucketSize), y: Math.floor(point.y / bucketSize) };
  }

  function bucketKey(xBucket: number, yBucket: number): string {
    return `${String(xBucket)},${String(yBucket)}`;
  }

  return {
    hasNearby(point: Point, maxDistance: number): boolean {
      const bucket = baseBucket(point);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const entries = buckets.get(bucketKey(bucket.x + dx, bucket.y + dy));
          if (!entries) continue;
          for (const otherPoint of entries) {
            if (distance(point, otherPoint) <= maxDistance) return true;
          }
        }
      }
      return false;
    },
    addPoint(point: Point): void {
      const bucket = baseBucket(point);
      const key = bucketKey(bucket.x, bucket.y);
      const list = buckets.get(key);
      if (list) {
        list.push({ x: point.x, y: point.y });
        return;
      }
      buckets.set(key, [{ x: point.x, y: point.y }]);
    },
  };
}

// ---------------------------------------------------------------------------
// Field adapter + contour tracer
// ---------------------------------------------------------------------------

function createFieldContext(warp: WarpField): FieldContext {
  const { width, height } = warp.bounds();
  return {
    width,
    height,
    value(axis: Axis, offset: number, x: number, y: number): number {
      return warp.valueAt(clamp(x, 0, width), clamp(y, 0, height))[axis] - offset;
    },
    gradient(axis: Axis, offset: number, x: number, y: number): Point {
      const j = warp.jacobianAt(clamp(x, 0, width), clamp(y, 0, height));
      return axis === "warpedX"
        ? { x: j.xx, y: j.xy }
        : { x: j.yx, y: j.yy };
    },
  };
}

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
  const seedIndex = createPointIndex(SEED_DEDUP_DISTANCE * 2);
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

// ---------------------------------------------------------------------------
// SVG output
// ---------------------------------------------------------------------------

function formatNumber(value: number): string {
  return value.toFixed(PATH_DECIMALS);
}

function rotateSamples(samples: readonly TangentSample[], startIndex: number): TangentSample[] {
  return samples.slice(startIndex).concat(samples.slice(0, startIndex));
}

function directionBetween(start: Point, end: Point): Point | null {
  return normalize({ x: end.x - start.x, y: end.y - start.y });
}

function sampleTurnAngle(previousPoint: Point, point: Point, nextPoint: Point): number {
  const incoming = directionBetween(previousPoint, point);
  const outgoing = directionBetween(point, nextPoint);
  if (!incoming || !outgoing) return Math.PI;
  return Math.acos(clamp(dot(incoming, outgoing), -1, 1));
}

function chooseClosedPathSeam(samples: readonly TangentSample[]): number {
  if (samples.length < 3) return 0;
  let bestIndex = 0;
  let bestTurn = Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[(index - 1 + samples.length) % samples.length];
    const current = samples[index];
    const next = samples[(index + 1) % samples.length];
    const turn = sampleTurnAngle(previous, current, next);
    if (turn < bestTurn) {
      bestTurn = turn;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function preparePathSamples(component: TracedComponent): TangentSample[] {
  if (!component.closed) return component.samples;
  const seamIndex = chooseClosedPathSeam(component.samples);
  const rotated = rotateSamples(component.samples, seamIndex);
  const first = rotated[0];
  return [
    ...rotated,
    { x: first.x, y: first.y, tangent: { x: first.tangent.x, y: first.tangent.y } },
  ];
}

function createPathData(component: TracedComponent): string {
  const samples = preparePathSamples(component);
  if (samples.length < 2) return "";

  let pathData = `M ${formatNumber(samples[0].x)} ${formatNumber(samples[0].y)}`;
  const segmentCount = samples.length - 1;

  for (let index = 0; index < segmentCount; index += 1) {
    const start = samples[index];
    const end = samples[index + 1];
    const segmentLength = distance(start, end);
    const handleLength = segmentLength / 3;
    const control1 = {
      x: start.x + start.tangent.x * handleLength,
      y: start.y + start.tangent.y * handleLength,
    };
    const control2 = {
      x: end.x - end.tangent.x * handleLength,
      y: end.y - end.tangent.y * handleLength,
    };
    pathData += ` C ${formatNumber(control1.x)} ${formatNumber(control1.y)} ${formatNumber(control2.x)} ${formatNumber(control2.y)} ${formatNumber(end.x)} ${formatNumber(end.y)}`;
  }

  if (component.closed) pathData += " Z";
  return pathData;
}

function createPathElement(component: TracedComponent, stroke: string): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", String(STROKE_WIDTH));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  path.dataset.closed = String(component.closed);
  path.setAttribute("d", createPathData(component));
  return path;
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
    const visitedSeeds = createPointIndex(VISITED_BUCKET_SIZE);

    for (const seed of seeds) {
      if (visitedSeeds.hasNearby(seed, VISITED_SEED_DISTANCE)) continue;

      const component = traceContourComponent(field, axis, offset, seed);
      if (!component) continue;

      for (const sample of component.samples) {
        visitedSeeds.addPoint(sample);
      }
      group.appendChild(createPathElement(component, stroke));
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

  const warp = createBilinearAffineField({
    width,
    height,
    time: currentTime,
    columns: AFFINE_GRID_COLUMNS,
    rows: AFFINE_GRID_ROWS,
  });
  const field = createFieldContext(warp);
  const leafCells = collectLeafCells(width, height, warp);

  scene.setAttribute("viewBox", `0 0 ${String(width)} ${String(height)}`);
  scene.replaceChildren();

  const limit = maxWarpedRadius(width, height, currentTime);
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