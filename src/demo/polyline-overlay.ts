/**
 * Generic traced-overlay helpers for finite line segments, open segment bundles,
 * and closed polygon rings.
 */
import type { ContourTracer } from "./contour-tracer.js";
import type { SvgContourRenderer } from "./svg-contour-renderer.js";
import type { Cell, Point, TangentSample, TracedComponent, WarpField } from "./types.js";
import { WarpLinearField } from "./warp-scalar-fields.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const SEGMENT_RANGE_EPSILON = 1e-6;
const MAX_ENDPOINT_SNAP_DISTANCE = 24;
const MAX_RING_JOIN_DISTANCE = 40;
const CLIP_BOUNDARY_REFINEMENT_ITERATIONS = 20;
const ENDPOINT_SOLVER_TOLERANCE = 1e-3;
const ENDPOINT_SOLVER_MAX_DISPLACEMENT = 48;
const ENDPOINT_SOLVER_ITERATIONS = 60;

export interface PlaneSegment {
  readonly start: Point;
  readonly end: Point;
}

export interface WarpedPolylineOverlaySettings {
  readonly stroke: string;
  readonly strokeWidth: number;
}

export interface WarpedPolylineShape {
  readonly segments: readonly PlaneSegment[];
  readonly closed?: boolean;
  readonly opacity?: number;
}

export interface TracedOverlayGroup {
  readonly components: readonly TracedComponent[];
  readonly opacity?: number;
}

interface OverlayRenderContext {
  readonly warp: WarpField;
  readonly leafCells: readonly Cell[];
  readonly tracer: ContourTracer;
  readonly renderer: SvgContourRenderer | null;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly endpointSolver: EndpointSolver;
}

export function segmentsFromVertices(vertices: readonly Point[], closed = true): PlaneSegment[] {
  if (vertices.length < 2) return [];

  const segments: PlaneSegment[] = [];
  const lastStartIndex = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < lastStartIndex; index += 1) {
    const nextIndex = closed ? (index + 1) % vertices.length : index + 1;
    segments.push({ start: vertices[index], end: vertices[nextIndex] });
  }
  return segments;
}

export function regularPolygonVertices(sides: number, radius: number): Point[] {
  const vertices: Point[] = [];
  for (let vertex = 0; vertex < sides; vertex += 1) {
    const angle = vertex * (2 * Math.PI) / sides;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return vertices;
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

interface EdgeImageRef {
  readonly image: SegmentImage;
}

interface SegmentImage extends TracedComponent {
  readonly clippedAtSegmentStart: boolean;
  readonly clippedAtSegmentEnd: boolean;
}

export function createWarpedPolylineOverlay(
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  renderer: SvgContourRenderer,
  shapes: readonly WarpedPolylineShape[],
  settings: WarpedPolylineOverlaySettings,
): SVGGElement {
  const group = createOverlayGroup(settings.stroke, settings.strokeWidth);
  const context: OverlayRenderContext = {
    warp,
    leafCells,
    tracer,
    renderer,
    stroke: settings.stroke,
    strokeWidth: settings.strokeWidth,
    endpointSolver: new EndpointSolver(warp),
  };

  for (const shape of shapes) {
    appendShape(group, shape, context);
  }

  return group;
}

export function traceWarpedPolylineOverlayGroups(
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  shapes: readonly WarpedPolylineShape[],
): TracedOverlayGroup[] {
  const context: OverlayRenderContext = {
    warp,
    leafCells,
    tracer,
    renderer: null,
    stroke: "",
    strokeWidth: 0,
    endpointSolver: new EndpointSolver(warp),
  };
  const groups: TracedOverlayGroup[] = [];

  for (const shape of shapes) {
    const tracedGroup = traceShapeGroup(shape, context);
    if (tracedGroup !== null) {
      groups.push(tracedGroup);
    }
  }

  return groups;
}

function appendShape(
  parent: SVGGElement,
  shape: WarpedPolylineShape,
  context: OverlayRenderContext,
): void {
  const tracedGroup = traceShapeGroup(shape, context);
  if (tracedGroup === null || context.renderer === null) return;

  const target = tracedGroup.opacity === undefined
    ? parent
    : createOverlayGroup(context.stroke, context.strokeWidth);
  if (tracedGroup.opacity !== undefined) {
    target.setAttribute("opacity", String(tracedGroup.opacity));
  }

  appendComponents(target, tracedGroup.components, context.renderer, context.stroke);
  if (target !== parent) parent.appendChild(target);
}

function traceShapeGroup(
  shape: WarpedPolylineShape,
  context: OverlayRenderContext,
): TracedOverlayGroup | null {
  const segmentImages = shape.segments.map((segment) => traceSegmentImages(segment, context));
  const components = shape.closed ? mergeSegmentLoopImages(segmentImages) : segmentImages.flat();
  if (components.length === 0) {
    return null;
  }

  return shape.opacity === undefined
    ? { components }
    : { components, opacity: shape.opacity };
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

function traceSegmentImages(
  segment: PlaneSegment,
  context: OverlayRenderContext,
): SegmentImage[] {
  const geometry = segmentGeometry(segment);
  if (!geometry) return [];

  const startPoint = context.endpointSolver.solve(segment.start);
  const endPoint = context.endpointSolver.solve(segment.end);
  return traceSegmentCandidates(geometry, context.warp, context.leafCells, context.tracer, startPoint, endPoint);
}

function traceSegmentCandidates(
  geometry: SegmentGeometry,
  warp: WarpField,
  leafCells: readonly Cell[],
  tracer: ContourTracer,
  startPoint: Point | null,
  endPoint: Point | null,
): SegmentImage[] {
  const field = new WarpLinearField(warp, geometry.normal, geometry.lineOffset);
  const candidates: SegmentImage[] = [];

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
): SegmentImage[] {
  const minParameter = Math.min(startParameter, endParameter);
  const maxParameter = Math.max(startParameter, endParameter);
  if (component.closed && component.samples.every((sample) => isParameterInRange(sampleParameter(sample, warp, direction), minParameter, maxParameter))) {
    return [createSegmentImage(cloneComponent(component), false, false)];
  }

  const samples = component.closed ? [...component.samples, component.samples[0]] : component.samples;
  const runs = collectClipRuns(samples, warp, direction, minParameter, maxParameter);

  const clippedComponents: SegmentImage[] = [];
  for (const run of runs) {
    if (run.samples.length < 2) continue;
    const oriented = orientRunByParameter(run, warp, direction, startParameter <= endParameter);
    const snappedStart = chooseSnapPoint(oriented.samples[0], startPoint);
    const snappedEnd = chooseSnapPoint(lastSample(oriented.samples), endPoint);
    clippedComponents.push(createSegmentImage(
      { closed: false, samples: snapRunEndpoints(oriented.samples, snappedStart, snappedEnd) },
      oriented.clippedAtStart,
      oriented.clippedAtEnd,
    ));
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
  if (samples.length === 0) return [];

  const runs: ClipRun[] = [];
  let previousSample = samples[0];
  let previousParameter = sampleParameter(previousSample, warp, direction);
  let previousInRange = isParameterInRange(previousParameter, minParameter, maxParameter);
  let currentSamples: TangentSample[] = previousInRange ? [previousSample] : [];
  let currentClippedAtStart = false;

  for (const sample of samples.slice(1)) {
    const parameter = sampleParameter(sample, warp, direction);
    const inRange = isParameterInRange(parameter, minParameter, maxParameter);

    if (previousInRange && inRange) {
      currentSamples.push(sample);
    } else if (previousInRange && !inRange) {
      currentSamples.push(interpolateAtRangeBoundary(previousSample, previousParameter, sample, parameter, warp, direction, minParameter, maxParameter));
      runs.push({ samples: currentSamples, clippedAtStart: currentClippedAtStart, clippedAtEnd: true });
      currentSamples = [];
      currentClippedAtStart = false;
    } else if (!previousInRange && inRange) {
      currentSamples = [
        interpolateAtRangeBoundary(previousSample, previousParameter, sample, parameter, warp, direction, minParameter, maxParameter),
        sample,
      ];
      currentClippedAtStart = true;
    } else {
      const spanningRun = collectSpanningRun(previousSample, previousParameter, sample, parameter, warp, direction, minParameter, maxParameter);
      if (spanningRun) runs.push(spanningRun);
    }

    previousSample = sample;
    previousParameter = parameter;
    previousInRange = inRange;
  }

  if (currentSamples.length > 0) {
    runs.push({ samples: currentSamples, clippedAtStart: currentClippedAtStart, clippedAtEnd: false });
  }
  return runs;
}

function collectSpanningRun(
  start: TangentSample,
  startParameter: number,
  end: TangentSample,
  endParameter: number,
  warp: WarpField,
  direction: Point,
  minParameter: number,
  maxParameter: number,
): ClipRun | null {
  const crossesWholeRange = (startParameter < minParameter && endParameter > maxParameter)
    || (startParameter > maxParameter && endParameter < minParameter);
  if (!crossesWholeRange) return null;

  const firstTarget = startParameter < minParameter ? minParameter : maxParameter;
  const secondTarget = startParameter < minParameter ? maxParameter : minParameter;
  return {
    samples: [
      interpolateAtParameter(start, startParameter, end, endParameter, firstTarget, warp, direction),
      interpolateAtParameter(start, startParameter, end, endParameter, secondTarget, warp, direction),
    ],
    clippedAtStart: true,
    clippedAtEnd: true,
  };
}

function interpolateAtRangeBoundary(
  start: TangentSample,
  startParameter: number,
  end: TangentSample,
  endParameter: number,
  warp: WarpField,
  direction: Point,
  minParameter: number,
  maxParameter: number,
): TangentSample {
  const targetParameter = startParameter < minParameter || endParameter < minParameter ? minParameter : maxParameter;
  return interpolateAtParameter(start, startParameter, end, endParameter, targetParameter, warp, direction);
}

function interpolateAtParameter(
  start: TangentSample,
  startParameter: number,
  end: TangentSample,
  endParameter: number,
  targetParameter: number,
  warp: WarpField,
  direction: Point,
): TangentSample {
  let lowSample = start;
  let lowParameter = startParameter;
  let highSample = end;
  let highParameter = endParameter;

  for (let iteration = 0; iteration < CLIP_BOUNDARY_REFINEMENT_ITERATIONS; iteration += 1) {
    const midpointSample = interpolateSample(lowSample, highSample, 0.5);
    const midpointParameter = sampleParameter(midpointSample, warp, direction);
    if (sameParameterSide(lowParameter, midpointParameter, targetParameter)) {
      lowSample = midpointSample;
      lowParameter = midpointParameter;
    } else {
      highSample = midpointSample;
      highParameter = midpointParameter;
    }
  }

  const denominator = highParameter - lowParameter;
  const amount = Math.abs(denominator) < 1e-12 ? 0.5 : clamp((targetParameter - lowParameter) / denominator, 0, 1);
  return interpolateSample(lowSample, highSample, amount);
}

function sameParameterSide(firstParameter: number, secondParameter: number, targetParameter: number): boolean {
  return (firstParameter - targetParameter) * (secondParameter - targetParameter) >= 0;
}

function interpolateSample(start: TangentSample, end: TangentSample, amount: number): TangentSample {
  return {
    x: mix(start.x, end.x, amount),
    y: mix(start.y, end.y, amount),
    tangent: normalize(mixPoint(start.tangent, end.tangent, amount)) ?? start.tangent,
  };
}

function orientRunByParameter(run: ClipRun, warp: WarpField, direction: Point, increasing: boolean): ClipRun {
  const firstParameter = sampleParameter(run.samples[0], warp, direction);
  const lastParameter = sampleParameter(lastSample(run.samples), warp, direction);
  if ((lastParameter >= firstParameter) === increasing) return run;

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

function mergeSegmentLoopImages(edgeImages: readonly SegmentImage[][]): TracedComponent[] {
  const closedComponents = edgeImages.flatMap((components) => components.filter((component) => component.closed).map(cloneComponent));
  const openRefs = edgeImages.map((components) => components
    .filter((image) => !image.closed)
    .map((image) => ({ image: cloneSegmentImage(image) })));

  const nextRefByRef = new Map<EdgeImageRef, EdgeImageRef>();
  const previousRefByRef = new Map<EdgeImageRef, EdgeImageRef>();
  for (let edgeIndex = 0; edgeIndex < edgeImages.length; edgeIndex += 1) {
    linkAdjacentEdgeImages(
      openRefs[edgeIndex],
      openRefs[(edgeIndex + 1) % edgeImages.length],
      nextRefByRef,
      previousRefByRef,
    );
  }

  const mergedComponents: TracedComponent[] = [];
  const visitedRefs = new Set<EdgeImageRef>();
  for (const ref of openRefs.flat()) {
    if (visitedRefs.has(ref) || previousRefByRef.has(ref)) continue;
    mergedComponents.push(mergeImageChain(ref, nextRefByRef, visitedRefs));
  }
  for (const ref of openRefs.flat()) {
    if (visitedRefs.has(ref)) continue;
    mergedComponents.push(mergeImageChain(ref, nextRefByRef, visitedRefs));
  }

  return [...closedComponents, ...mergedComponents];
}

function linkAdjacentEdgeImages(
  previousEdge: readonly EdgeImageRef[],
  nextEdge: readonly EdgeImageRef[],
  nextRefByRef: Map<EdgeImageRef, EdgeImageRef>,
  previousRefByRef: Map<EdgeImageRef, EdgeImageRef>,
): void {
  const availableNextRefs = nextEdge.filter((ref) => ref.image.clippedAtSegmentStart);

  for (const previousRef of previousEdge) {
    if (!previousRef.image.clippedAtSegmentEnd) continue;
    const previousEnd = lastSample(previousRef.image.samples);
    let bestStartIndex = -1;
    let bestDistance = MAX_RING_JOIN_DISTANCE;

    for (let index = 0; index < availableNextRefs.length; index += 1) {
      const nextStart = availableNextRefs[index].image.samples[0];
      const gap = distance(previousEnd, nextStart);
      if (gap < bestDistance) {
        bestDistance = gap;
        bestStartIndex = index;
      }
    }

    if (bestStartIndex < 0) continue;

    const [nextRef] = availableNextRefs.splice(bestStartIndex, 1);
    nextRefByRef.set(previousRef, nextRef);
    previousRefByRef.set(nextRef, previousRef);
  }
}

function mergeImageChain(
  firstRef: EdgeImageRef,
  nextRefByRef: ReadonlyMap<EdgeImageRef, EdgeImageRef>,
  visitedRefs: Set<EdgeImageRef>,
): TracedComponent {
  const samples = firstRef.image.samples.slice();
  visitedRefs.add(firstRef);
  let closed = false;

  let currentRef = firstRef;
  let nextRef = nextRefByRef.get(currentRef);
  while (nextRef !== undefined && !visitedRefs.has(nextRef)) {
    appendJoinedSamples(samples, nextRef.image.samples);
    visitedRefs.add(nextRef);
    currentRef = nextRef;
    nextRef = nextRefByRef.get(currentRef);
  }

  const closingRef = nextRefByRef.get(currentRef);
  if (closingRef === firstRef) {
    const sharedPoint = midpoint(lastSample(samples), samples[0]);
    replaceLastSample(samples, sharedPoint);
    replaceFirstSample(samples, sharedPoint);
    samples.pop();
    closed = true;
  }

  return { closed, samples };
}

function appendJoinedSamples(samples: TangentSample[], nextSamples: readonly TangentSample[]): void {
  const sharedPoint = midpoint(lastSample(samples), nextSamples[0]);
  replaceLastSample(samples, sharedPoint);
  samples.push(...nextSamples.slice(1));
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

function replaceLastSample(samples: TangentSample[], point: Point): void {
  const lastIndex = samples.length - 1;
  samples[lastIndex] = replacePoint(samples[lastIndex], point);
}

function replaceFirstSample(samples: TangentSample[], point: Point): void {
  samples[0] = replacePoint(samples[0], point);
}

function lastSample(samples: readonly TangentSample[]): TangentSample {
  return samples[samples.length - 1];
}

function cloneComponent(component: TracedComponent): TracedComponent {
  return {
    closed: component.closed,
    samples: component.samples.map(cloneSample),
  };
}

function cloneSample(sample: TangentSample): TangentSample {
  return {
    x: sample.x,
    y: sample.y,
    tangent: { x: sample.tangent.x, y: sample.tangent.y },
  };
}

function cloneSegmentImage(image: SegmentImage): SegmentImage {
  return createSegmentImage(cloneComponent(image), image.clippedAtSegmentStart, image.clippedAtSegmentEnd);
}

function createSegmentImage(
  component: TracedComponent,
  clippedAtSegmentStart: boolean,
  clippedAtSegmentEnd: boolean,
): SegmentImage {
  return {
    ...component,
    clippedAtSegmentStart,
    clippedAtSegmentEnd,
  };
}

function midpoint(first: Point, second: Point): Point {
  return {
    x: 0.5 * (first.x + second.x),
    y: 0.5 * (first.y + second.y),
  };
}

function mixPoint(first: Point, second: Point, amount: number): Point {
  return {
    x: mix(first.x, second.x, amount),
    y: mix(first.y, second.y, amount),
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

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
