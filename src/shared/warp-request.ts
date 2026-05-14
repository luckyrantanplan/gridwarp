export const WARP_GEOMETRY_FORMAT = "svg-polyline-overlay/v1";
export const MAX_SAMPLES_PER_UNIT = 10.0;

export const WARP_GEOMETRY_GROUPS = {
  outerBoundary: "outer-boundary",
  innerBoundary: "inner-boundary",
  horizontalGrid: "horizontal-grid",
  verticalGrid: "vertical-grid",
  diagonals: "diagonals",
} as const;

export interface WarpGeometryPresentation {
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly strokeLineCap: string;
  readonly strokeLineJoin: string;
  readonly vectorEffect: string;
  readonly opacity?: number;
}

export const WARP_GEOMETRY_PRESENTATION: Record<string, WarpGeometryPresentation> = {
  [WARP_GEOMETRY_GROUPS.outerBoundary]: {
    stroke: "#161616",
    strokeWidth: 1.6,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    vectorEffect: "non-scaling-stroke",
  },
  [WARP_GEOMETRY_GROUPS.innerBoundary]: {
    stroke: "#161616",
    strokeWidth: 1.6,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    vectorEffect: "non-scaling-stroke",
  },
  [WARP_GEOMETRY_GROUPS.horizontalGrid]: {
    stroke: "#d4372f",
    strokeWidth: 2.2,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    vectorEffect: "non-scaling-stroke",
  },
  [WARP_GEOMETRY_GROUPS.verticalGrid]: {
    stroke: "#148a45",
    strokeWidth: 2.2,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    vectorEffect: "non-scaling-stroke",
  },
  [WARP_GEOMETRY_GROUPS.diagonals]: {
    stroke: "#161616",
    strokeWidth: 1.6,
    strokeLineCap: "butt",
    strokeLineJoin: "miter",
    vectorEffect: "non-scaling-stroke",
    opacity: 0.55,
  },
};

export interface WarpGeometry {
  readonly format: typeof WARP_GEOMETRY_FORMAT;
  readonly svg: string;
}

export interface WarpRequest {
  readonly geometry: WarpGeometry;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly time: number;
  readonly samplesPerUnit: number;
  readonly gain: number;
  readonly plateau: number;
}

export interface WarpResponse {
  readonly svg: string;
}

export class WarpRequestError extends Error {}

export function parseWarpRequest(bodyText: string): WarpRequest {
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText) as unknown;
  } catch {
    throw new WarpRequestError("Request body must be valid JSON.");
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
  const samplesPerUnit = validateSamplesPerUnit(value.samplesPerUnit);
  const gain = validatePositiveFiniteNumber(value.gain, "gain");
  const plateau = validatePositiveFiniteNumber(value.plateau, "plateau");

  return {
    geometry,
    renderWidth,
    renderHeight,
    time,
    samplesPerUnit,
    gain,
    plateau,
  };
}

function validateGeometry(value: unknown): WarpGeometry {
  if (!isRecord(value)) {
    throw new WarpRequestError("geometry must be an object.");
  }

  if (value.format !== WARP_GEOMETRY_FORMAT) {
    throw new WarpRequestError(`geometry.format must be ${WARP_GEOMETRY_FORMAT}.`);
  }

  if (typeof value.svg !== "string" || value.svg.trim() === "") {
    throw new WarpRequestError("geometry.svg must be a non-empty string.");
  }

  return {
    format: WARP_GEOMETRY_FORMAT,
    svg: value.svg,
  };
}

function validatePositiveFiniteNumber(value: unknown, fieldName: string): number {
  const numericValue = validateFiniteNumber(value, fieldName);
  if (numericValue <= 0) {
    throw new WarpRequestError(`${fieldName} must be a positive number.`);
  }
  return numericValue;
}

function validateFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WarpRequestError(`${fieldName} must be a finite number.`);
  }
  return value;
}

function validateSamplesPerUnit(value: unknown): number {
  const samplesPerUnit = validatePositiveFiniteNumber(value, "samplesPerUnit");
  if (samplesPerUnit > MAX_SAMPLES_PER_UNIT) {
    throw new WarpRequestError(`samplesPerUnit must be less than or equal to ${String(MAX_SAMPLES_PER_UNIT)}.`);
  }
  return samplesPerUnit;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}