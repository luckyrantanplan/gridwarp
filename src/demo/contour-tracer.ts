/**
 * Marching-squares seed extraction and contour tracing of a generic scalar field.
 *
 * Given any `ScalarField`, the tracer extracts seeds from the leaf cells via marching
 * squares, projects each seed onto the zero level set with Newton iteration, and
 * follows the field's tangent direction with a midpoint predictor/corrector until the
 * curve closes or leaves the viewport.
 */
import { PointBucketIndex } from "./point-bucket-index.js";
import type {
  Cell,
  Point,
  ScalarField,
  ScreenNode,
  Segment,
  TangentSample,
  TracedComponent,
} from "./types.js";

/**
 * Stores the numerical thresholds used by the contour tracer.
 */
export interface ContourTracerSettings {
  readonly minGradientNorm: number;
  readonly newtonTolerance: number;
  readonly maxProjectionIterations: number;
  readonly maxNewtonDisplacement: number;
  readonly initialTraceStep: number;
  readonly maxTraceStep: number;
  readonly traceMinStep: number;
  readonly traceTargetCorrection: number;
  readonly maxTraceTurn: number;
  readonly maxTraceSteps: number;
  readonly loopClosureDistance: number;
  readonly minLoopArcLength: number;
  readonly seedDedupDistance: number;
  readonly visitedBucketSize: number;
  readonly visitedSeedDistance: number;
}

/**
 * Extracts traced contour components from any scalar field over adaptive leaf cells.
 */
export class ContourTracer {
  constructor(private readonly settings: ContourTracerSettings) {}

  /**
   * Traces every connected component of the zero level set of `field` over `leafCells`.
   */
  trace(field: ScalarField, leafCells: readonly Cell[]): TracedComponent[] {
    const components: TracedComponent[] = [];
    const seeds = this.collectSeedCandidates(field, leafCells);
    const visitedSeeds = new PointBucketIndex(this.settings.visitedBucketSize);

    for (const seed of seeds) {
      if (visitedSeeds.hasNearby(seed, this.settings.visitedSeedDistance)) continue;
      const component = this.traceComponent(field, seed);
      if (!component) continue;
      for (const sample of component.samples) visitedSeeds.addPoint(sample);
      components.push(component);
    }
    return components;
  }

  private collectSeedCandidates(field: ScalarField, leafCells: readonly Cell[]): Point[] {
    const segments = this.buildSegments(field, leafCells);
    const seedIndex = new PointBucketIndex(this.settings.seedDedupDistance * 2);
    const seeds: Point[] = [];

    for (const [startPoint, endPoint] of segments) {
      const seed = {
        x: 0.5 * (startPoint.x + endPoint.x),
        y: 0.5 * (startPoint.y + endPoint.y),
      };
      if (seedIndex.hasNearby(seed, this.settings.seedDedupDistance)) continue;
      seedIndex.addPoint(seed);
      seeds.push(seed);
    }
    return seeds;
  }

  private buildSegments(field: ScalarField, leafCells: readonly Cell[]): Segment[] {
    const segments: Segment[] = [];
    for (const cell of leafCells) this.pushCellSegments(segments, cell, field);
    return segments;
  }

  private pushCellSegments(segments: Segment[], cell: Cell, field: ScalarField): void {
    const { tl, tr, br, bl } = cell;
    const vTL = field.valueAtNode(tl);
    const vTR = field.valueAtNode(tr);
    const vBR = field.valueAtNode(br);
    const vBL = field.valueAtNode(bl);

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
        const centreValue = field.value(cx, cy);
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
        const centreValue = field.value(cx, cy);
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

  private traceComponent(field: ScalarField, seed: Point): TracedComponent | null {
    const projectedSeed = this.projectToContour(field, seed);
    if (!projectedSeed) return null;

    const seedGradient = field.gradient(projectedSeed.x, projectedSeed.y);
    if (Math.hypot(seedGradient.x, seedGradient.y) < this.settings.minGradientNorm) return null;

    const seedTangent = tangentFromGradient(seedGradient, null);
    if (!seedTangent) return null;

    const seedSample: TangentSample = { x: projectedSeed.x, y: projectedSeed.y, tangent: seedTangent };
    const forward = this.traceDirection(field, seedSample, 1);
    if (forward.closed) return { closed: true, samples: [seedSample, ...forward.samples] };

    const backward = this.traceDirection(field, seedSample, -1);
    if (backward.closed) return { closed: true, samples: [seedSample, ...backward.samples] };

    const samples = [...reverseSamples(backward.samples), seedSample, ...forward.samples];
    return samples.length > 1 ? { closed: false, samples } : null;
  }

  private traceDirection(field: ScalarField, seedSample: TangentSample, direction: number): TracedComponent {
    const seedDirectionTangent = {
      x: seedSample.tangent.x * direction,
      y: seedSample.tangent.y * direction,
    };
    let current: TangentSample = {
      x: seedSample.x,
      y: seedSample.y,
      tangent: seedDirectionTangent,
    };
    let step = this.settings.initialTraceStep;
    let arcLength = 0;
    const samples: TangentSample[] = [];

    for (let iteration = 0; iteration < this.settings.maxTraceSteps; iteration += 1) {
      let attempt = step;
      let accepted: TangentSample | null = null;

      while (attempt >= this.settings.traceMinStep) {
        const midpointGuess = {
          x: current.x + current.tangent.x * attempt * 0.5,
          y: current.y + current.tangent.y * attempt * 0.5,
        };
        const projectedMidpoint = this.projectToContour(field, midpointGuess);
        if (!projectedMidpoint) { attempt *= 0.5; continue; }

        const midpointGradient = field.gradient(projectedMidpoint.x, projectedMidpoint.y);
        if (Math.hypot(midpointGradient.x, midpointGradient.y) < this.settings.minGradientNorm) { attempt *= 0.5; continue; }

        const midpointTangent = tangentFromGradient(midpointGradient, current.tangent);
        if (!midpointTangent) { attempt *= 0.5; continue; }

        const predicted = {
          x: current.x + midpointTangent.x * attempt,
          y: current.y + midpointTangent.y * attempt,
        };
        const projected = this.projectToContour(field, predicted);
        if (!projected) { attempt *= 0.5; continue; }

        const gradient = field.gradient(projected.x, projected.y);
        if (Math.hypot(gradient.x, gradient.y) < this.settings.minGradientNorm) { attempt *= 0.5; continue; }

        const tangent = tangentFromGradient(gradient, current.tangent);
        if (!tangent) { attempt *= 0.5; continue; }

        const correction = distance(predicted, projected);
        const turn = Math.acos(clamp(dot(current.tangent, tangent), -1, 1));
        if (turn > this.settings.maxTraceTurn || correction > this.settings.traceTargetCorrection * 3) {
          attempt *= 0.5;
          continue;
        }

        accepted = { x: projected.x, y: projected.y, tangent };
        const safeCorrection = Math.max(correction, this.settings.traceTargetCorrection * 0.01);
        const stepFactor = clamp(Math.sqrt(this.settings.traceTargetCorrection / safeCorrection), 0.3, 2);
        step = clamp(attempt * stepFactor, this.settings.traceMinStep, this.settings.maxTraceStep);
        break;
      }

      if (!accepted) return { samples, closed: false };

      arcLength += distance(current, accepted);
      if (
        arcLength > this.settings.minLoopArcLength
        && distance(accepted, seedSample) < this.settings.loopClosureDistance
        && dot(accepted.tangent, seedDirectionTangent) > 0.5
      ) {
        return { samples, closed: true };
      }

      samples.push(accepted);
      current = accepted;

      if (isOnBoundary(current, field) && arcLength > this.settings.initialTraceStep) {
        return { samples, closed: false };
      }
    }

    return { samples, closed: false };
  }

  private projectToContour(field: ScalarField, point: Point): Point | null {
    let x = point.x;
    let y = point.y;

    for (let iteration = 0; iteration < this.settings.maxProjectionIterations; iteration += 1) {
      const value = field.value(x, y);
      if (Math.abs(value) < this.settings.newtonTolerance) return { x, y };

      const gradient = field.gradient(x, y);
      const normSquared = gradient.x * gradient.x + gradient.y * gradient.y;
      if (normSquared < this.settings.minGradientNorm * this.settings.minGradientNorm) return null;

      let dx = -value * gradient.x / normSquared;
      let dy = -value * gradient.y / normSquared;
      const displacement = Math.hypot(dx, dy);
      if (displacement > this.settings.maxNewtonDisplacement) {
        const scale = this.settings.maxNewtonDisplacement / displacement;
        dx *= scale;
        dy *= scale;
      }

      x = clamp(x + dx, 0, field.width);
      y = clamp(y + dy, 0, field.height);
    }

    return Math.abs(field.value(x, y)) < this.settings.newtonTolerance * 4 ? { x, y } : null;
  }
}

function interpolateZero(nodeA: ScreenNode, valueA: number, nodeB: ScreenNode, valueB: number): Point {
  const amount = Math.abs(valueA - valueB) < 1e-6 ? 0.5 : clamp(valueA / (valueA - valueB), 0, 1);
  return {
    x: mix(nodeA.screenX, nodeB.screenX, amount),
    y: mix(nodeA.screenY, nodeB.screenY, amount),
  };
}

function tangentFromGradient(gradient: Point, previousTangent: Point | null): Point | null {
  const tangent = normalize({ x: -gradient.y, y: gradient.x });
  if (!tangent) return null;
  if (previousTangent && dot(tangent, previousTangent) < 0) {
    return { x: -tangent.x, y: -tangent.y };
  }
  return tangent;
}

function isOnBoundary(point: Point, field: ScalarField): boolean {
  return point.x <= 0.5
    || point.x >= field.width - 0.5
    || point.y <= 0.5
    || point.y >= field.height - 0.5;
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

function normalize(vector: Point): Point | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-9) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function distance(pointA: Point, pointB: Point): number {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function dot(vectorA: Point, vectorB: Point): number {
  return vectorA.x * vectorB.x + vectorA.y * vectorB.y;
}

function mix(start: number, end: number, amount: number): number {
  return start * (1 - amount) + end * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}