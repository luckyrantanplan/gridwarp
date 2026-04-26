/**
 * Local spiral-like warp definition expressed as complex affine coefficients over the plane.
 *
 * For each plane point `z` and time `t`, this returns the local affine pair `(a, b)`
 * such that the full warp evaluates as `w(z) = a * z + b`.
 */
import { complex, type Complex, type ComplexAffinePair } from "./complex.js";

export function createCenteredRadialAffinePair(point: Complex, time: number): ComplexAffinePair {
  const radius = Math.hypot(point.real, point.imag);
  const weight = Math.exp(-0.16 * radius * radius);

  const angle = time * (0.0022 + 0.01 * weight) * weight;

  const pullBase = time * (0.015 + 0.075 * weight);
  const scaleCandidate = 1 + pullBase * weight;
  const softness = 0.2;
  const blend = clamp((scaleCandidate - 3 + softness) / (2 * softness), 0, 1);
  const sigma = scaleCandidate + smootherstepUnit(blend) * (3 - scaleCandidate);

  return {
    a: complex(sigma * Math.cos(angle), sigma * Math.sin(angle)),
    b: complex(0, 0),
  };
}

function smootherstepUnit(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}