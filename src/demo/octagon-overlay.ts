/**
 * SVG overlay drawing the two octagons and four diagonals through the unified
 * contour-tracing pipeline.
 *
 * Each overlay edge is still traced as the preimage of its supporting line, but the
 * finite segment topology is enforced after tracing: only endpoint-to-endpoint runs
 * are renderable, octagon rings are assembled as one coherent cycle, and ring edges
 * snap adjacent endpoints to shared vertices.
 */
import type { ContourTracer } from "./contour-tracer.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, Point, TangentSample, TracedComponent, WarpField } from "./types.js";
import { WarpLinearField } from "./warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEGMENT_RANGE_EPSILON = 1e-6;
const MAX_ENDPOINT_SNAP_DISTANCE = 24;
const RING_JOIN_SCORE_WEIGHT = 20;
const ENDPOINT_SOLVER_TOLERANCE = 1e-3;
const ENDPOINT_SOLVER_MAX_DISPLACEMENT = 48;
const ENDPOINT_SOLVER_ITERATIONS = 60;

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

interface ClipRun {
  readonly samples: TangentSample[];
  readonly clippedAtStart: boolean;
  readonly clippedAtEnd: boolean;
}

interface SegmentCandidate {
  readonly component: TracedComponent;
  readonly length: number;
  readonly start: TangentSample;
  readonly end: TangentSample;
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

  appendOctagon(group, settings.outerRadius, warp, leafCells, tracer, renderer, settings.stroke);
  appendOctagon(group, settings.innerRadius, warp, leafCells, tracer, renderer, settings.stroke);

  const diagonals = createOverlayGroup(settings.stroke, settings.strokeWidth);
  diagonals.setAttribute("opacity", String(settings.diagonalOpacity));
  for (const segment of octagonDiagonals(settings.outerRadius)) {
    const component = traceSegment(segment, warp, leafCells, tracer, endpointSolver);
    if (component) diagonals.appendChild(renderer.createPathElement(component, settings.stroke));
  }
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

function appendOctagon(
  parent: SVGGElement,
  radius: number,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  stroke: string,
): void {
  const edgeCandidates = octagonEdges(radius)
    .map(segmentGeometry)
    .filter((geometry): geometry is SegmentGeometry => geometry !== null)
    .map((geometry) => traceSegmentCandidates(geometry, warp, leafCells, tracer, null, null, false));
  const components = selectRingBranches(edgeCandidates);
  snapRingEndpoints(components);
  for (const component of components) {
    if (component) parent.appendChild(renderer.createPathElement(component, stroke));
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

function traceSegment(
  segment: PlaneSegment,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  endpointSolver: EndpointSolver,
): TracedComponent | null {
  const geometry = segmentGeometry(segment);
  if (!geometry) return null;

  const startPoint = endpointSolver.solve(segment.start);
  const endPoint = endpointSolver.solve(segment.end);
  return selectShortestBranch(traceSegmentCandidates(geometry, warp, leafCells, tracer, startPoint, endPoint, true));
}

function traceSegmentCandidates(
  geometry: SegmentGeometry,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  startPoint: Point | null,
  endPoint: Point | null,
  requireEndpointProximity: boolean,
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
      requireEndpointProximity,
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
  requireEndpointProximity: boolean,
): TracedComponent[] {
  const minParameter = Math.min(startParameter, endParameter);
  const maxParameter = Math.max(startParameter, endParameter);
  const samples = component.closed ? [...component.samples, component.samples[0]] : component.samples;
  const runs = collectClipRuns(samples, warp, direction, minParameter, maxParameter);

  const clippedComponents: TracedComponent[] = [];
  for (const run of runs) {
    if (run.samples.length < 2) continue;
    const oriented = orientRun(run, startParameter <= endParameter);
    if (!isEndpointToEndpointRun(oriented)) continue;
    if (requireEndpointProximity && (!isNearEndpoint(oriented.samples[0], startPoint) || !isNearEndpoint(oriented.samples[oriented.samples.length - 1], endPoint))) {
      continue;
    }
    clippedComponents.push({
      closed: false,
      samples: snapRunEndpoints(oriented.samples, oriented.clippedAtStart ? startPoint : null, oriented.clippedAtEnd ? endPoint : null),
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

function isEndpointToEndpointRun(run: ClipRun): boolean {
  return run.clippedAtStart && run.clippedAtEnd;
}

function isNearEndpoint(sample: TangentSample, endpoint: Point | null): boolean {
  return endpoint === null || distance(sample, endpoint) <= MAX_ENDPOINT_SNAP_DISTANCE;
}

function selectShortestBranch(candidates: readonly TracedComponent[]): TracedComponent | null {
  let bestCandidate: TracedComponent | null = null;
  let bestLength = Infinity;
  for (const candidate of candidates) {
    const length = componentLength(candidate);
    if (length < bestLength) {
      bestLength = length;
      bestCandidate = candidate;
    }
  }
  return bestCandidate;
}

function selectRingBranches(edgeCandidates: readonly TracedComponent[][]): (TracedComponent | null)[] {
  const candidateEdges = edgeCandidates.map(toSegmentCandidates);
  if (candidateEdges.some((candidates) => candidates.length === 0)) {
    return edgeCandidates.map((candidates) => selectShortestBranch(candidates));
  }

  let bestSelection: SegmentCandidate[] | null = null;
  let bestScore = Infinity;
  for (const firstCandidate of candidateEdges[0]) {
    const selection = selectRingBranchesFromFirst(candidateEdges, firstCandidate);
    const score = ringSelectionScore(selection);
    if (score < bestScore) {
      bestScore = score;
      bestSelection = selection;
    }
  }

  return bestSelection?.map((candidate) => candidate.component)
    ?? edgeCandidates.map((candidates) => selectShortestBranch(candidates));
}

function selectRingBranchesFromFirst(
  edgeCandidates: readonly SegmentCandidate[][],
  firstCandidate: SegmentCandidate,
): SegmentCandidate[] {
  let states: RingSelectionState[] = [{ components: [firstCandidate], score: firstCandidate.length }];

  for (let edgeIndex = 1; edgeIndex < edgeCandidates.length; edgeIndex += 1) {
    const nextStates: RingSelectionState[] = [];
    for (const candidate of edgeCandidates[edgeIndex]) {
      let bestState: RingSelectionState | null = null;
      let bestScore = Infinity;
      for (const state of states) {
        const previous = state.components[state.components.length - 1];
        const score = state.score + candidate.length + ringJoinScore(previous, candidate);
        if (score < bestScore) {
          bestScore = score;
          bestState = { components: [...state.components, candidate], score };
        }
      }
      if (bestState) nextStates.push(bestState);
    }
    states = nextStates;
  }

  let bestState = states[0];
  let bestScore = Infinity;
  for (const state of states) {
    const score = state.score + ringJoinScore(state.components[state.components.length - 1], firstCandidate);
    if (score < bestScore) {
      bestScore = score;
      bestState = state;
    }
  }
  return bestState.components;
}

interface RingSelectionState {
  readonly components: SegmentCandidate[];
  readonly score: number;
}

function ringSelectionScore(components: readonly SegmentCandidate[]): number {
  let score = 0;
  for (let index = 0; index < components.length; index += 1) {
    const current = components[index];
    const next = components[(index + 1) % components.length];
    score += current.length + ringJoinScore(current, next);
  }
  return score;
}

function ringJoinScore(current: SegmentCandidate, next: SegmentCandidate): number {
  const gap = distance(current.end, next.start);
  return RING_JOIN_SCORE_WEIGHT * gap * gap;
}

function toSegmentCandidates(components: readonly TracedComponent[]): SegmentCandidate[] {
  return components.map((component) => ({
    component,
    length: componentLength(component),
    start: component.samples[0],
    end: component.samples[component.samples.length - 1],
  }));
}

function snapRingEndpoints(components: (TracedComponent | null)[]): void {
  for (let index = 0; index < components.length; index += 1) {
    const current = components[index];
    const next = components[(index + 1) % components.length];
    if (!current || !next) continue;

    const currentEndIndex = current.samples.length - 1;
    const currentEnd = current.samples[currentEndIndex];
    const nextStart = next.samples[0];
    const sharedPoint = {
      x: 0.5 * (currentEnd.x + nextStart.x),
      y: 0.5 * (currentEnd.y + nextStart.y),
    };

    current.samples[currentEndIndex] = replacePoint(currentEnd, sharedPoint);
    next.samples[0] = replacePoint(nextStart, sharedPoint);
  }
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

function componentLength(component: TracedComponent): number {
  let length = 0;
  for (let index = 1; index < component.samples.length; index += 1) {
    length += distance(component.samples[index - 1], component.samples[index]);
  }
  return length;
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
