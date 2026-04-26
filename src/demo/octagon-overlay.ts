/**
 * SVG overlay drawing the two octagons and four diagonals through the unified
 * contour-tracing pipeline.
 *
 * Each overlay edge is still traced as the preimage of its supporting line, but the
 * finite segment topology is enforced after tracing in output-space segment
 * coordinates. Every clipped preimage run is rendered, including disconnected extra
 * images and fully in-range closed loops that appear once the warp folds.
 */
import type { ContourTracer } from "./contour-tracer.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, Point, TangentSample, TracedComponent, WarpField } from "./types.js";
import { WarpLinearField } from "./warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEGMENT_RANGE_EPSILON = 1e-6;
const MAX_ENDPOINT_SNAP_DISTANCE = 24;
const MAX_RING_JOIN_DISTANCE = 40;
const MAX_RING_ENDPOINT_CLUSTER_DISTANCE = 16;
const ENDPOINT_SOLVER_TOLERANCE = 1e-3;
const ENDPOINT_SOLVER_MAX_DISPLACEMENT = 48;
const ENDPOINT_SOLVER_ITERATIONS = 60;

export interface OctagonOverlaySettings {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly diagonalOpacity: number;
  readonly showDiagonals?: boolean;
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

interface ClipRun {
  readonly samples: TangentSample[];
  readonly clippedAtStart: boolean;
  readonly clippedAtEnd: boolean;
}

/**
 * Builds an SVG group containing the warped outer octagon, inner octagon, and four diagonals.
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

  appendOctagon(group, settings.outerRadius, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  appendOctagon(group, settings.innerRadius, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);

  if (settings.showDiagonals === false) return group;

  const diagonals = createOverlayGroup(settings.stroke, settings.strokeWidth);
  diagonals.setAttribute("opacity", String(settings.diagonalOpacity));
  for (const segment of octagonDiagonals(settings.outerRadius)) {
    appendSegmentImages(diagonals, segment, warp, leafCells, tracer, renderer, settings.stroke, endpointSolver);
  }
  group.appendChild(diagonals);

  return group;
}

function createOverlayGroup(stroke: string, strokeWidth: number): SVGGElement {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", stroke);
  group.setAttribute("stroke-width", String(strokeWidth));
  group.setAttribute("stroke-linecap", "butt");
  group.setAttribute("stroke-linejoin", "miter");
  group.setAttribute("vector-effect", "non-scaling-stroke");
  return group;
}

function appendOctagon(
  parent: SVGGElement,
  radius: number,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  stroke: string,
  endpointSolver: EndpointSolver,
): void {
  const edgeImages = octagonEdges(radius).map((segment) => traceSegmentImages(
    segment,
    warp,
    leafCells,
    tracer,
    endpointSolver,
  ));
  snapOctagonEdgeJoins(edgeImages);
  snapNearbyOpenEndpoints(edgeImages.flat());

  for (const components of edgeImages) {
    appendComponents(parent, components, renderer, stroke);
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

function appendSegmentImages(
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

  appendComponents(parent, traceSegmentImages(segment, warp, leafCells, tracer, endpointSolver), renderer, stroke);
}

function traceSegmentImages(
  segment: PlaneSegment,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  endpointSolver: EndpointSolver,
): TracedComponent[] {
  const geometry = segmentGeometry(segment);
  if (!geometry) return [];

  const startPoint = endpointSolver.solve(segment.start);
  const endPoint = endpointSolver.solve(segment.end);
  return traceSegmentCandidates(geometry, warp, leafCells, tracer, startPoint, endPoint);
}

function appendComponents(
  parent: SVGGElement,
  components: readonly TracedComponent[],
  renderer: SvgContourRenderer,
  stroke: string,
): void {
  for (const component of components) {
    parent.appendChild(createOverlayPathElement(renderer, component, stroke));
  }
}

function traceSegmentCandidates(
  geometry: SegmentGeometry,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  startPoint: Point | null,
  endPoint: Point | null,
): TracedComponent[] {
  const field = new WarpLinearField(warp, geometry.normal, geometry.lineOffset);
  const candidates: TracedComponent[] = [];

  for (const component of tracer.trace(field, leafCells)) {
    candidates.push(...clipComponentToRange(
      component,
      warp,
      geometry.direction,
      geometry.startParameter,
      geometry.endParameter,
      startPoint,
      endPoint,
    ));
  }

  return candidates;
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
  if (component.closed && component.samples.every((sample) => isParameterInRange(sampleParameter(sample, warp, direction), minParameter, maxParameter))) {
    return [{ closed: true, samples: component.samples.slice() }];
  }

  const samples = component.closed ? [...component.samples, component.samples[0]] : component.samples;
  const runs = collectClipRuns(samples, warp, direction, minParameter, maxParameter);

  const clippedComponents: TracedComponent[] = [];
  for (const run of runs) {
    if (run.samples.length < 2) continue;
    const oriented = orientRun(run, startParameter <= endParameter);
    const snappedStart = chooseSnapPoint(oriented.samples[0], startPoint);
    const snappedEnd = chooseSnapPoint(oriented.samples[oriented.samples.length - 1], endPoint);
    clippedComponents.push({
      closed: false,
      samples: snapRunEndpoints(oriented.samples, snappedStart, snappedEnd),
    });
  }
  return clippedComponents;
}

function collectClipRuns(
  samples: readonly TangentSample[],
  warp: WarpField,
  direction: Point,
  minParameter: number,
  maxParameter: number,
): ClipRun[] {
  const runs: ClipRun[] = [];
  let currentSamples: TangentSample[] = [];
  let currentClippedAtStart = false;
  let sawOutOfRange = false;

  for (const sample of samples) {
    const parameter = sampleParameter(sample, warp, direction);
    const inRange = isParameterInRange(parameter, minParameter, maxParameter);
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
  return runs;
}

function orientRun(run: ClipRun, forward: boolean): ClipRun {
  if (forward) return run;
  return {
    samples: reverseSamples(run.samples),
    clippedAtStart: run.clippedAtEnd,
    clippedAtEnd: run.clippedAtStart,
  };
}

function createOverlayPathElement(renderer: SvgContourRenderer, component: TracedComponent, stroke: string): SVGPathElement {
  const path = renderer.createPathElement(component, stroke);
  path.setAttribute("stroke-linecap", "butt");
  path.setAttribute("stroke-linejoin", component.closed ? "miter" : "bevel");
  return path;
}

function chooseSnapPoint(sample: TangentSample, endpoint: Point | null): Point | null {
  return endpoint !== null && distance(sample, endpoint) <= MAX_ENDPOINT_SNAP_DISTANCE ? endpoint : null;
}

function snapOctagonEdgeJoins(edgeImages: TracedComponent[][]): void {
  for (let edgeIndex = 0; edgeIndex < edgeImages.length; edgeIndex += 1) {
    const previousEdge = edgeImages[(edgeIndex + edgeImages.length - 1) % edgeImages.length];
    const nextEdge = edgeImages[edgeIndex];
    snapAdjacentEdgeImages(previousEdge, nextEdge);
  }
}

function snapAdjacentEdgeImages(previousEdge: TracedComponent[], nextEdge: TracedComponent[]): void {
  const availableStarts = nextEdge
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => !component.closed);

  for (const previous of previousEdge) {
    if (previous.closed) continue;
    const previousEnd = previous.samples[previous.samples.length - 1];
    let bestStartIndex = -1;
    let bestDistance = MAX_RING_JOIN_DISTANCE;

    for (let index = 0; index < availableStarts.length; index += 1) {
      const nextStart = availableStarts[index].component.samples[0];
      const gap = distance(previousEnd, nextStart);
      if (gap < bestDistance) {
        bestDistance = gap;
        bestStartIndex = index;
      }
    }

    if (bestStartIndex < 0) continue;

    const [match] = availableStarts.splice(bestStartIndex, 1);
    const nextStart = match.component.samples[0];
    const sharedPoint = midpoint(previousEnd, nextStart);
    previous.samples[previous.samples.length - 1] = replacePoint(previousEnd, sharedPoint);
    match.component.samples[0] = replacePoint(nextStart, sharedPoint);
  }
}

function snapNearbyOpenEndpoints(components: readonly TracedComponent[]): void {
  const endpoints = collectOpenEndpoints(components);
  const clusters: EndpointReference[][] = [];

  for (const endpoint of endpoints) {
    const cluster = clusters.find((candidate) => candidate.some((clusterEndpoint) => {
      return distance(endpoint.sample(), clusterEndpoint.sample()) <= MAX_RING_ENDPOINT_CLUSTER_DISTANCE;
    }));
    if (cluster) {
      cluster.push(endpoint);
    } else {
      clusters.push([endpoint]);
    }
  }

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const sharedPoint = averageEndpoint(cluster);
    for (const endpoint of cluster) {
      endpoint.replace(sharedPoint);
    }
  }
}

interface EndpointReference {
  sample(): TangentSample;
  replace(point: Point): void;
}

function collectOpenEndpoints(components: readonly TracedComponent[]): EndpointReference[] {
  const endpoints: EndpointReference[] = [];
  for (const component of components) {
    if (component.closed) continue;
    endpoints.push({
      sample: () => component.samples[0],
      replace: (point) => { component.samples[0] = replacePoint(component.samples[0], point); },
    });
    endpoints.push({
      sample: () => component.samples[component.samples.length - 1],
      replace: (point) => {
        const lastIndex = component.samples.length - 1;
        component.samples[lastIndex] = replacePoint(component.samples[lastIndex], point);
      },
    });
  }
  return endpoints;
}

function averageEndpoint(endpoints: readonly EndpointReference[]): Point {
  let x = 0;
  let y = 0;
  for (const endpoint of endpoints) {
    const sample = endpoint.sample();
    x += sample.x;
    y += sample.y;
  }
  return { x: x / endpoints.length, y: y / endpoints.length };
}

function isParameterInRange(parameter: number, minParameter: number, maxParameter: number): boolean {
  return parameter >= minParameter - SEGMENT_RANGE_EPSILON
    && parameter <= maxParameter + SEGMENT_RANGE_EPSILON;
}

function sampleParameter(sample: TangentSample, warp: WarpField, direction: Point): number {
  const warped = warp.valueAt(sample.x, sample.y);
  return direction.x * warped.warpedX + direction.y * warped.warpedY;
}

function reverseSamples(samples: readonly TangentSample[]): TangentSample[] {
  return samples.slice().reverse().map((sample) => ({
    x: sample.x,
    y: sample.y,
    tangent: { x: -sample.tangent.x, y: -sample.tangent.y },
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
  return point ? { x: point.x, y: point.y, tangent: sample.tangent } : sample;
}

function midpoint(first: Point, second: Point): Point {
  return {
    x: 0.5 * (first.x + second.x),
    y: 0.5 * (first.y + second.y),
  };
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

function distance(first: Point, second: Point): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
