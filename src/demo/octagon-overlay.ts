/**
 * SVG overlay drawing the two octagons and four diagonals through the unified
 * level-set tracing pipeline.
 *
 * Every line / segment is described in plane coordinates (the warp output space).
 * The screen-space curve we want to draw is the preimage of that line under the
 * warp, i.e. the zero level set of `n · warp(p) - c` where (n, c) describe the
 * line. We trace the level set with `ContourTracer`, clip the resulting samples
 * to the segment's parametric range along the line direction, and render each
 * clipped run with `SvgContourRenderer`.
 */
import type { ContourTracer } from "./contour-tracer.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, Point, TangentSample, TracedComponent, WarpField } from "./types.js";
import { WarpLinearField } from "./warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEGMENT_RANGE_EPSILON = 1e-6;
const ENDPOINT_SOLVER_TOLERANCE = 1e-6;
const ENDPOINT_SOLVER_MAX_DISPLACEMENT = 12;
const ENDPOINT_SOLVER_ITERATIONS = 20;

export interface OctagonOverlaySettings {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly diagonalOpacity: number;
}

interface PlaneSegment {
  readonly start: Point;
  readonly end: Point;
}

interface SegmentGeometry {
  readonly direction: Point;
  readonly normal: Point;
  readonly lineOffset: number;
  readonly startParameter: number;
  readonly endParameter: number;
}

/**
 * Builds an SVG group containing the warped outer octagon, inner octagon, and four diagonals,
 * all rendered through the same contour-tracing + cubic-Bézier smoothing pipeline as the grid.
 */
export function createWarpedOctagonOverlay(
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  settings: OctagonOverlaySettings,
): SVGGElement {
  const group = createOverlayGroup(settings.stroke, settings.strokeWidth);
  const endpointSolver = new EndpointSolver(warp);

  appendSegments(group, octagonEdges(settings.outerRadius), warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  appendSegments(group, octagonEdges(settings.innerRadius), warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);

  const diagonals = createOverlayGroup(settings.stroke, settings.strokeWidth);
  diagonals.setAttribute("opacity", String(settings.diagonalOpacity));
  appendSegments(diagonals, octagonDiagonals(settings.outerRadius), warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  group.appendChild(diagonals);

  return group;
}

function createOverlayGroup(stroke: string, strokeWidth: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", stroke);
  group.setAttribute("stroke-width", String(strokeWidth));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  group.setAttribute("vector-effect", "non-scaling-stroke");
  return group;
}

function appendSegments(
  parent: SVGGElement,
  segments: readonly PlaneSegment[],
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  stroke: string,
  endpointSolver: EndpointSolver,
): void {
  for (const segment of segments) {
    appendSegment(parent, segment, warp, leafCells, tracer, renderer, stroke, endpointSolver);
  }
}

function octagonEdges(radius: number): PlaneSegment[] {
  const vertices: Point[] = [];
  for (let vertex = 0; vertex < 8; vertex += 1) {
    const angle = vertex * Math.PI / 4;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }

  const segments: PlaneSegment[] = [];
  for (let vertex = 0; vertex < 8; vertex += 1) {
    segments.push({ start: vertices[vertex], end: vertices[(vertex + 1) % 8] });
  }
  return segments;
}

function octagonDiagonals(outerRadius: number): PlaneSegment[] {
  const segments: PlaneSegment[] = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    segments.push({
      start: { x: -cos * outerRadius, y: -sin * outerRadius },
      end: { x: cos * outerRadius, y: sin * outerRadius },
    });
  }
  return segments;
}

function appendSegment(
  parent: SVGGElement,
  segment: PlaneSegment,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  stroke: string,
  endpointSolver: EndpointSolver,
): void {
  const geometry = segmentGeometry(segment);
  if (!geometry) return;

  const field = new WarpLinearField(warp, geometry.normal, geometry.lineOffset);
  const startPoint = endpointSolver.solve(segment.start);
  const endPoint = endpointSolver.solve(segment.end);
  const components = tracer.trace(field, leafCells);

  for (const component of components) {
    const clippedComponents = clipComponentToRange(
      component,
      warp,
      geometry.direction,
      geometry.startParameter,
      geometry.endParameter,
      startPoint,
      endPoint,
    );
    for (const clipped of clippedComponents) {
      parent.appendChild(renderer.createPathElement(clipped, stroke));
    }
  }
}

function segmentGeometry(segment: PlaneSegment): SegmentGeometry | null {
  const direction = normalize({
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y,
  });
  if (!direction) return null;

  const normal: Point = { x: -direction.y, y: direction.x };
  return {
    direction,
    normal,
    lineOffset: normal.x * segment.start.x + normal.y * segment.start.y,
    startParameter: direction.x * segment.start.x + direction.y * segment.start.y,
    endParameter: direction.x * segment.end.x + direction.y * segment.end.y,
  };
}

interface ClipRun {
  readonly samples: TangentSample[];
  readonly clippedAtStart: boolean;
  readonly clippedAtEnd: boolean;
}

function clipComponentToRange(
  component: TracedComponent,
  warp: WarpField,
  direction: Point,
  startParameter: number,
  endParameter: number,
  startPoint: Point | null,
  endPoint: Point | null,
): TracedComponent[] {
  const minParameter = Math.min(startParameter, endParameter);
  const maxParameter = Math.max(startParameter, endParameter);
  const samples = component.closed
    ? [...component.samples, component.samples[0]]
    : component.samples;

  const runs: ClipRun[] = [];
  let currentSamples: TangentSample[] = [];
  let currentClippedAtStart = false;
  let sawOutOfRange = false;

  for (const sample of samples) {
    const parameter = sampleParameter(sample, warp, direction);
    const inRange = parameter >= minParameter - SEGMENT_RANGE_EPSILON
      && parameter <= maxParameter + SEGMENT_RANGE_EPSILON;
    if (inRange) {
      if (currentSamples.length === 0) currentClippedAtStart = sawOutOfRange;
      currentSamples.push(sample);
      continue;
    }
    sawOutOfRange = true;
    if (currentSamples.length > 0) {
      runs.push({ samples: currentSamples, clippedAtStart: currentClippedAtStart, clippedAtEnd: true });
      currentSamples = [];
      currentClippedAtStart = false;
    }
  }
  if (currentSamples.length > 0) {
    runs.push({ samples: currentSamples, clippedAtStart: currentClippedAtStart, clippedAtEnd: false });
  }

  // A closed input component fully inside the parameter range produces a single run that
  // was never broken by clipping. Emit it as a closed loop so its first/last samples are
  // not snapped to the segment endpoints.
  if (component.closed && runs.length === 1 && !runs[0].clippedAtStart && !runs[0].clippedAtEnd) {
    const closedSamples = runs[0].samples.slice(0, -1);
    if (closedSamples.length < 2) return [];
    return [{ closed: true, samples: closedSamples }];
  }

  const clippedComponents: TracedComponent[] = [];
  for (const run of runs) {
    if (run.samples.length < 2) continue;
    const oriented = startParameter <= endParameter
      ? { samples: run.samples, clippedAtStart: run.clippedAtStart, clippedAtEnd: run.clippedAtEnd }
      : { samples: reverseSamples(run.samples), clippedAtStart: run.clippedAtEnd, clippedAtEnd: run.clippedAtStart };
    clippedComponents.push({
      closed: false,
      samples: snapRunEndpoints(oriented.samples, oriented.clippedAtStart ? startPoint : null, oriented.clippedAtEnd ? endPoint : null),
    });
  }
  return clippedComponents;
}

function sampleParameter(sample: TangentSample, warp: WarpField, direction: Point): number {
  const warped = warp.valueAt(sample.x, sample.y);
  return direction.x * warped.warpedX + direction.y * warped.warpedY;
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

function snapRunEndpoints(samples: readonly TangentSample[], startPoint: Point | null, endPoint: Point | null): TangentSample[] {
  if (!startPoint && !endPoint) return samples.slice();
  const first = samples[0];
  const last = samples[samples.length - 1];
  return [
    replacePoint(first, startPoint),
    ...samples.slice(1, -1),
    replacePoint(last, endPoint),
  ];
}

function replacePoint(sample: TangentSample, point: Point | null): TangentSample {
  return point
    ? { x: point.x, y: point.y, tangent: sample.tangent }
    : sample;
}

class EndpointSolver {
  private readonly width: number;
  private readonly height: number;
  private readonly planeScale: number;
  private readonly cache = new Map<string, Point | null>();

  constructor(private readonly warp: WarpField) {
    const bounds = warp.bounds();
    this.width = bounds.width;
    this.height = bounds.height;
    this.planeScale = bounds.height / 10;
  }

  solve(target: Point): Point | null {
    const key = `${target.x.toFixed(12)},${target.y.toFixed(12)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    let x = clamp(this.width * 0.5 + target.x * this.planeScale, 0, this.width);
    let y = clamp(this.height * 0.5 - target.y * this.planeScale, 0, this.height);

    for (let iteration = 0; iteration < ENDPOINT_SOLVER_ITERATIONS; iteration += 1) {
      const value = this.warp.valueAt(x, y);
      const errorX = value.warpedX - target.x;
      const errorY = value.warpedY - target.y;
      if (Math.hypot(errorX, errorY) < ENDPOINT_SOLVER_TOLERANCE) {
        const solved = { x, y };
        this.cache.set(key, solved);
        return solved;
      }

      const jacobian = this.warp.jacobianAt(x, y);
      const determinant = jacobian.xx * jacobian.yy - jacobian.xy * jacobian.yx;
      if (Math.abs(determinant) < 1e-12) break;

      let dx = (jacobian.yy * errorX - jacobian.xy * errorY) / determinant;
      let dy = (-jacobian.yx * errorX + jacobian.xx * errorY) / determinant;
      const displacement = Math.hypot(dx, dy);
      if (displacement > ENDPOINT_SOLVER_MAX_DISPLACEMENT) {
        const scale = ENDPOINT_SOLVER_MAX_DISPLACEMENT / displacement;
        dx *= scale;
        dy *= scale;
      }

      x = clamp(x - dx, 0, this.width);
      y = clamp(y - dy, 0, this.height);
    }

    this.cache.set(key, null);
    return null;
  }
}

function normalize(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-12) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
