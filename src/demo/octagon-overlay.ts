/**
 * Forward-warped SVG overlay showing the two octagons and their four main diagonals.
 *
 * Each plane-space curve is sampled densely; every sample is pushed through the warp
 * (in screen space) and the resulting points are joined into an SVG path. The outer
 * octagon is unaffected because the field vanishes on its boundary, while the inner
 * octagon and the four diagonals deform with the field.
 */
import type { WarpField } from "./types.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface OctagonOverlaySettings {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly diagonalOpacity: number;
  /** Number of intermediate samples placed between every pair of curve control points. */
  readonly samplesPerSegment: number;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Builds an SVG group containing the warped outer octagon, inner octagon, and four diagonals.
 */
export function createWarpedOctagonOverlay(
  width: number,
  height: number,
  warp: WarpField,
  settings: OctagonOverlaySettings,
): SVGGElement {
  const planeScale = height / 10;
  const centreX = width * 0.5;
  const centreY = height * 0.5;

  const planeToScreen = (real: number, imag: number): ScreenPoint => ({
    x: centreX + real * planeScale,
    y: centreY - imag * planeScale,
  });

  const projectThroughWarp = (real: number, imag: number): ScreenPoint => {
    const source = planeToScreen(real, imag);
    const value = warp.valueAt(source.x, source.y);
    return planeToScreen(value.warpedX, value.warpedY);
  };

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("fill", "none");
  group.setAttribute("stroke", settings.stroke);
  group.setAttribute("stroke-width", String(settings.strokeWidth));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");
  group.setAttribute("vector-effect", "non-scaling-stroke");

  group.appendChild(warpedOctagonPath(settings.outerRadius, settings.samplesPerSegment, projectThroughWarp));
  group.appendChild(warpedOctagonPath(settings.innerRadius, settings.samplesPerSegment, projectThroughWarp));

  const diagonals = document.createElementNS(SVG_NS, "g");
  diagonals.setAttribute("opacity", String(settings.diagonalOpacity));
  for (let index = 0; index < 4; index += 1) {
    diagonals.appendChild(
      warpedDiagonalPath(index * Math.PI / 4, settings.outerRadius, settings.samplesPerSegment, projectThroughWarp),
    );
  }
  group.appendChild(diagonals);

  return group;
}

function warpedOctagonPath(
  radius: number,
  samplesPerSegment: number,
  project: (real: number, imag: number) => ScreenPoint,
): SVGPathElement {
  const points: ScreenPoint[] = [];
  for (let vertex = 0; vertex < 8; vertex += 1) {
    const angleStart = vertex * Math.PI / 4;
    const angleEnd = (vertex + 1) * Math.PI / 4;
    const xStart = Math.cos(angleStart) * radius;
    const yStart = Math.sin(angleStart) * radius;
    const xEnd = Math.cos(angleEnd) * radius;
    const yEnd = Math.sin(angleEnd) * radius;
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      points.push(project(xStart + (xEnd - xStart) * t, yStart + (yEnd - yStart) * t));
    }
  }
  return polylinePath(points, true);
}

function warpedDiagonalPath(
  angle: number,
  outerRadius: number,
  samplesPerSegment: number,
  project: (real: number, imag: number) => ScreenPoint,
): SVGPathElement {
  const totalSamples = samplesPerSegment * 4;
  const points: ScreenPoint[] = [];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let step = 0; step <= totalSamples; step += 1) {
    const radius = outerRadius * (-1 + (2 * step) / totalSamples);
    points.push(project(cos * radius, sin * radius));
  }
  return polylinePath(points, false);
}

function polylinePath(points: readonly ScreenPoint[], closed: boolean): SVGPathElement {
  const path = document.createElementNS(SVG_NS, "path");
  let pathData = "";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    pathData += `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)} `;
  }
  if (closed) pathData += "Z";
  path.setAttribute("d", pathData.trimEnd());
  return path;
}
