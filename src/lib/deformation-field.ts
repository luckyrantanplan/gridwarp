/**
 * Local warp definition expressed as complex affine coefficients over the plane.
 *
 * For each plane point `z` and time `t`, this returns the local affine pair `(a, b)`
 * such that the full warp evaluates as `w(z) = a * z + b`.
 *
 * The active deformation is a translation field `D(z)` masked by a regular outer
 * octagon, formed as the sum of two single-arm CCW spirals whose source points sit
 * symmetrically above and below the centre on the imaginary axis. The two spirals
 * are phase-aligned so their unit vectors superpose at the origin and the magnitude
 * peaks there. Outside the outer octagon the warp is the identity (`a = 1, b = 0`).
 */
import { complex, type Complex, type ComplexAffinePair } from "./complex.js";

/** Geometric parameters in plane units. */
export const OUTER_OCTAGON_RADIUS = 4.0;
export const INNER_OCTAGON_RADIUS = 2.8;
export const SPIRAL_SOURCE_OFFSET = 0.4 * OUTER_OCTAGON_RADIUS;

/** Tightness of the spiral arms (radians of phase per plane unit of radius). */
const WINDING_RATE = Math.PI;
/** Maximum displacement amplitude per spiral; the central peak doubles this. */
const PEAK_DISPLACEMENT_PER_TIME = 0.005;
/**
 * Smootherstep band width (in plane units) across which the boundary mask ramps from 0
 * at the outer octagon boundary up to 1 deep inside. Wider than the geometric edge so the
 * field decays gradually instead of dropping abruptly near the boundary.
 */
const BOUNDARY_TRANSITION_WIDTH = 0.55 * OUTER_OCTAGON_RADIUS;

export function createDualSpiralOctagonAffinePair(point: Complex, time: number): ComplexAffinePair {
  const peakDisplacement = Math.max(PEAK_DISPLACEMENT_PER_TIME * time, 0);
  if (peakDisplacement === 0) return identityPair();

  const mask = octagonInteriorMask(point.real, point.imag, OUTER_OCTAGON_RADIUS, BOUNDARY_TRANSITION_WIDTH);
  if (mask === 0) return identityPair();

  // Phase shifts β so the two spiral unit vectors align at the origin.
  const upper = spiralUnitVector(point.real, point.imag, 0, SPIRAL_SOURCE_OFFSET, Math.PI / 2);
  const lower = spiralUnitVector(point.real, point.imag, 0, -SPIRAL_SOURCE_OFFSET, -Math.PI / 2);

  const scale = mask * peakDisplacement;
  return {
    a: complex(1, 0),
    b: complex(scale * (upper.x + lower.x), scale * (upper.y + lower.y)),
  };
}

function spiralUnitVector(
  x: number,
  y: number,
  sourceX: number,
  sourceY: number,
  phaseShift: number,
): { readonly x: number; readonly y: number } {
  const dx = x - sourceX;
  const dy = y - sourceY;
  const radius = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx);
  const theta = phi + WINDING_RATE * radius + phaseShift;
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

/**
 * Smooth interior mask for a regular octagon centred at the origin.
 *
 * Returns exactly 0 on the boundary and on its outside, and ramps via smootherstep
 * to 1 once the signed distance to the boundary reaches `transitionWidth` inside.
 */
function octagonInteriorMask(x: number, y: number, circumradius: number, transitionWidth: number): number {
  const signed = signedDistanceToRegularOctagon(x, y, circumradius);
  return smootherstep(0, transitionWidth, signed);
}

/** Signed distance to a regular octagon centred at the origin (positive inside). */
function signedDistanceToRegularOctagon(x: number, y: number, circumradius: number): number {
  const apothem = circumradius * Math.cos(Math.PI / 8);
  let minSigned = Infinity;
  for (let edgeIndex = 0; edgeIndex < 8; edgeIndex += 1) {
    const normalAngle = Math.PI / 8 + edgeIndex * Math.PI / 4;
    const projection = x * Math.cos(normalAngle) + y * Math.sin(normalAngle);
    const signed = apothem - projection;
    if (signed < minSigned) minSigned = signed;
  }
  return minSigned;
}

function identityPair(): ComplexAffinePair {
  return { a: complex(1, 0), b: complex(0, 0) };
}

function smootherstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}