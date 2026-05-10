import { satur } from "../lib/saturation.js";

export interface TransferCurveSample {
  readonly x: number;
  readonly y: number;
}

export interface PlotBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface PlotFrame {
  readonly width: number;
  readonly height: number;
  readonly paddingLeft: number;
  readonly paddingRight: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}

export function sampleTransferCurve(gain: number, plateau: number, sampleCount: number): TransferCurveSample[] {
  if (!Number.isFinite(gain) || gain <= 0.0) {
    throw new Error("Transfer curve gain must be positive and finite.");
  }
  if (!Number.isFinite(plateau) || plateau <= 0.0) {
    throw new Error("Transfer curve plateau must be positive and finite.");
  }
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new Error("Transfer curve sample count must be an integer of at least 2.");
  }

  const samples: TransferCurveSample[] = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const x = sampleIndex / (sampleCount - 1);
    samples.push({ x, y: satur(gain * x, plateau) });
  }
  return samples;
}

export function transferCurvePathData(
  samples: readonly TransferCurveSample[],
  bounds: PlotBounds,
  frame: PlotFrame,
): string {
  if (samples.length === 0) {
    return "";
  }

  return samples
    .map((sample, sampleIndex) => {
      const point = mapPlotPoint(sample, bounds, frame);
      const command = sampleIndex === 0 ? "M" : "L";
      return `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    })
    .join(" ");
}

export function mapPlotPoint(sample: TransferCurveSample, bounds: PlotBounds, frame: PlotFrame): TransferCurveSample {
  validatePlotBounds(bounds);
  validatePlotFrame(frame);
  const normalizedX = (sample.x - bounds.minX) / (bounds.maxX - bounds.minX);
  const normalizedY = (sample.y - bounds.minY) / (bounds.maxY - bounds.minY);

  return {
    x: frame.paddingLeft + normalizedX * (frame.width - frame.paddingLeft - frame.paddingRight),
    y: frame.height - frame.paddingBottom - normalizedY * (frame.height - frame.paddingTop - frame.paddingBottom),
  };
}

function validatePlotBounds(bounds: PlotBounds): void {
  if (!(Number.isFinite(bounds.minX) && Number.isFinite(bounds.maxX) && bounds.minX < bounds.maxX)) {
    throw new Error("Plot bounds x range must be finite and strictly increasing.");
  }
  if (!(Number.isFinite(bounds.minY) && Number.isFinite(bounds.maxY) && bounds.minY < bounds.maxY)) {
    throw new Error("Plot bounds y range must be finite and strictly increasing.");
  }
}

function validatePlotFrame(frame: PlotFrame): void {
  if (!Number.isFinite(frame.width) || frame.width <= 0.0 || !Number.isFinite(frame.height) || frame.height <= 0.0) {
    throw new Error("Plot frame dimensions must be positive and finite.");
  }
  if (frame.paddingLeft < 0.0 || frame.paddingRight < 0.0 || frame.paddingTop < 0.0 || frame.paddingBottom < 0.0) {
    throw new Error("Plot frame padding must be non-negative.");
  }
}