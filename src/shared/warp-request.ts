export const OCTAGON_DEMO_SHAPE = "octagon-demo";

export interface WarpGeometry {
  readonly shape: typeof OCTAGON_DEMO_SHAPE;
}

export interface WarpRequest {
  readonly geometry: WarpGeometry;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly time: number;
  readonly sampleGridSize: number;
  readonly gain: number;
  readonly plateau: number;
  readonly gridVisible: boolean;
  readonly diagonalsVisible: boolean;
}

export interface WarpResponse {
  readonly svg: string;
}

export function parseWarpRequest(bodyText: string): WarpRequest {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }

  return validateWarpRequest(parsedBody);
}

export function validateWarpRequest(value: unknown): WarpRequest {
  if (!isRecord(value)) {
    throw new Error("Request body must be a JSON object.");
  }

  const geometry = validateGeometry(value.geometry);
  const renderWidth = validatePositiveFiniteNumber(value.renderWidth, "renderWidth");
  const renderHeight = validatePositiveFiniteNumber(value.renderHeight, "renderHeight");
  const time = validateFiniteNumber(value.time, "time");
  const sampleGridSize = validateFiniteNumber(value.sampleGridSize, "sampleGridSize");
  const gain = validateFiniteNumber(value.gain, "gain");
  const plateau = validateFiniteNumber(value.plateau, "plateau");
  const gridVisible = validateBoolean(value.gridVisible, "gridVisible");
  const diagonalsVisible = validateBoolean(value.diagonalsVisible, "diagonalsVisible");

  return {
    geometry,
    renderWidth,
    renderHeight,
    time,
    sampleGridSize,
    gain,
    plateau,
    gridVisible,
    diagonalsVisible,
  };
}

function validateGeometry(value: unknown): WarpGeometry {
  if (!isRecord(value)) {
    throw new Error("geometry must be an object.");
  }

  if (value.shape !== OCTAGON_DEMO_SHAPE) {
    throw new Error(`geometry.shape must be ${OCTAGON_DEMO_SHAPE}.`);
  }

  return { shape: OCTAGON_DEMO_SHAPE };
}

function validatePositiveFiniteNumber(value: unknown, fieldName: string): number {
  const numericValue = validateFiniteNumber(value, fieldName);
  if (numericValue <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }
  return numericValue;
}

function validateFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
}

function validateBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}