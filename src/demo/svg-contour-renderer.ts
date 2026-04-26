/**
 * SVG path generation for traced contour components.
 */
import type { Point, TangentSample, TracedComponent } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Converts traced contour samples into smooth SVG cubic Bézier paths.
 */
export class SvgContourRenderer {
  constructor(
    private readonly strokeWidth: number,
    private readonly pathDecimals: number,
  ) {}

  createPathElement(component: TracedComponent, stroke: string): SVGPathElement {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", String(this.strokeWidth));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("vector-effect", "non-scaling-stroke");
    path.dataset.closed = String(component.closed);
    path.setAttribute("d", this.createPathData(component));
    return path;
  }

  private createPathData(component: TracedComponent): string {
    const samples = this.preparePathSamples(component);
    if (samples.length < 2) return "";

    let pathData = `M ${this.formatNumber(samples[0].x)} ${this.formatNumber(samples[0].y)}`;
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
      pathData += ` C ${this.formatNumber(control1.x)} ${this.formatNumber(control1.y)} ${this.formatNumber(control2.x)} ${this.formatNumber(control2.y)} ${this.formatNumber(end.x)} ${this.formatNumber(end.y)}`;
    }

    if (component.closed) pathData += " Z";
    return pathData;
  }

  private preparePathSamples(component: TracedComponent): TangentSample[] {
    if (!component.closed) return component.samples;
    const seamIndex = this.chooseClosedPathSeam(component.samples);
    const rotated = rotateSamples(component.samples, seamIndex);
    const first = rotated[0];
    return [
      ...rotated,
      { x: first.x, y: first.y, tangent: { x: first.tangent.x, y: first.tangent.y } },
    ];
  }

  private chooseClosedPathSeam(samples: readonly TangentSample[]): number {
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

  private formatNumber(value: number): string {
    return value.toFixed(this.pathDecimals);
  }
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}