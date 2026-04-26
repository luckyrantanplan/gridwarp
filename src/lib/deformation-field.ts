/**
 * Local spiral-like warp definition expressed as complex affine coefficients over the plane.
 */
import {  complex, type Complex, type ComplexAffinePair } from "./complex.js";

 interface RadialCoefficients {
  readonly angle: number;
  readonly sigma: number;
  readonly sigmaROverR: number;
  readonly thetaROverR: number;
}

export function createCenteredRadialAffinePair(point: Complex, time: number): ComplexAffinePair {
  const coefficients = centeredRadialCoefficients(point, time);
  return {
    a: complex(coefficients.sigma * Math.cos(coefficients.angle), coefficients.sigma * Math.sin(coefficients.angle)),
    b: complex(0.0, 0.0),
  };
}


function centeredRadialCoefficients(point: Complex, time: number): RadialCoefficients {
  const radius = Math.hypot(point.real, point.imag);
  const weight = Math.exp(-0.16 * radius * radius);
  const angle = time * (0.0022 + 0.01 * weight) * weight;
  const pullBase = time * (0.015 + 0.075 * weight);
  const scaleCandidate = 1 + pullBase * weight;
  const softness = 0.2;
  const blendRaw = (scaleCandidate - 3 + softness) / (2 * softness);
  const blend = clamp(blendRaw, 0, 1);
  const smoothBlend = smootherstepUnit(blend);
  const sigma = scaleCandidate + smoothBlend * (3 - scaleCandidate);

  const weightROverR = -0.32 * weight;
  const scaleCandidateROverR = weightROverR * time * (0.015 + 0.15 * weight);
  const thetaROverR = weightROverR * time * (0.0022 + 0.02 * weight);

  let sigmaBlendDerivative = 1 - smoothBlend;
  if (blendRaw > 0 && blendRaw < 1) {
    sigmaBlendDerivative += (3 - scaleCandidate) * smootherstepUnitDerivative(blend) / (2 * softness);
  }

  return {
    angle,
    sigma,
    sigmaROverR: scaleCandidateROverR * sigmaBlendDerivative,
    thetaROverR,
  };
}

function smootherstepUnit(value: number): number {
  return value * value * value * (value * (value * 6.0 - 15.0) + 10.0);
}

function smootherstepUnitDerivative(value: number): number {
  return 30 * value * value * (1 - value) * (1 - value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}