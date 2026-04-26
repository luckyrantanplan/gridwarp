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

interface ParametricSample {
  readonly sample: TangentSample;
  readonly t: number;
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
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", settings.stroke);
  group.setAttribute("stroke-width", String(settings.strokeWidth));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  group.setAttribute("vector-effect", "non-scaling-stroke");

  const endpointSolver = new EndpointSolver(warp);

  for (const segment of octagonEdges(settings.outerRadius)) {
    appendSegment(group, segment, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  }
  for (const segment of octagonEdges(settings.innerRadius)) {
    appendSegment(group, segment, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  }

  const diagonals = document.createElementNS(SVG_NS, "g");
  diagonals.setAttribute("opacity", String(settings.diagonalOpacity));
  for (const segment of octagonDiagonals(settings.outerRadius)) {
    appendSegment(diagonals, segment, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  }
  group.appendChild(diagonals);

  return group;
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
  const direction = normalize({
    x: segment.end.x - segment.start.x,
    y: segment.end.y - segment.start.y,
  });
  if (!direction) return;

  const normal: Point = { x: -direction.y, y: direction.x };
  const lineOffset = normal.x * segment.start.x + normal.y * segment.start.y;
  const tStart = direction.x * segment.start.x + direction.y * segment.start.y;
  const tEnd = direction.x * segment.end.x + direction.y * segment.end.y;
  const field = new WarpLinearField(warp, normal, lineOffset);
  const startPoint = endpointSolver.solve(segment.start);
  const endPoint = endpointSolver.solve(segment.end);

  const components = tracer.trace(field, leafCells);
  for (const component of components) {
    for (const clipped of clipComponentToRange(component, warp, direction, tStart, tEnd, startPoint, endPoint)) {
      parent.appendChild(renderer.createPathElement(clipped, stroke));
    }
  }
}

function clipComponentToRange(
  component: TracedComponent,
  warp: WarpField,
  direction: Point,
  tStart: number,
  tEnd: number,
  startPoint: Point | null,
  endPoint: Point | null,
): TracedComponent[] {
  const tMin = Math.min(tStart, tEnd);
  const tMax = Math.max(tStart, tEnd);
  const samples = component.closed
    ? [...component.samples, component.samples[0]]
    : component.samples;

  const insideRuns: ParametricSample[][] = [];
  let currentRun: ParametricSample[] = [];

  for (const sample of samples) {
    const t = sampleParameter(sample, warp, direction);
    if (t >= tMin - SEGMENT_RANGE_EPSILON && t <= tMax + SEGMENT_RANGE_EPSILON) {
      currentRun.push({ sample, t });
    } else if (currentRun.length > 0) {
      insideRuns.push(currentRun);
      currentRun = [];
    }
  }
  if (currentRun.length > 0) insideRuns.push(currentRun);

  const result: TracedComponent[] = [];
  for (const run of insideRuns) {
    if (run.length < 2) continue;
    const orientedRun = tStart <= tEnd ? run : reverseParametricSamples(run);
    const samplesForPath = orientedRun.map(({ sample }) => sample);
    result.push({
      closed: false,
      samples: snapRunEndpoints(samplesForPath, startPoint, endPoint),
    });
  }
  return result;
}

function sampleParameter(sample: TangentSample, warp: WarpField, direction: Point): number {
  const warped = warp.valueAt(sample.x, sample.y);
  return direction.x * warped.warpedX + direction.y * warped.warpedY;
}

function reverseParametricSamples(samples: readonly ParametricSample[]): ParametricSample[] {
  return samples.slice().reverse().map(({ sample, t }) => ({
    t,
    sample: {
      x: sample.x,
      y: sample.y,
      tangent: {
        x: -sample.tangent.x,
        y: -sample.tangent.y,
      },
    },
  }));
}

function snapRunEndpoints(samples: readonly TangentSample[], startPoint: Point | null, endPoint: Point | null): TangentSample[] {
  const first = samples[0];
  const last = samples[samples.length - 1];
  return [
    pointWithTangent(startPoint, first),
    ...samples.slice(1, -1),
    pointWithTangent(endPoint, last),
  ];
}

function pointWithTangent(point: Point | null, sample: TangentSample): TangentSample {
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
