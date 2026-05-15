import {
  type NoiseBooleanParameterKey,
  type NoiseEditableParameterValues,
  type NoiseNumericParameterKey,
  validatePartialNoiseEditableParameters,
} from "./noise-parameters.js";

export type { NoiseBooleanParameterKey, NoiseEditableParameterValues, NoiseNumericParameterKey } from "./noise-parameters.js";

export type NoiseParameterValues = NoiseEditableParameterValues;

export interface NoiseParameterGroup {
  readonly key: string;
  readonly label: string;
  readonly description: string;
}

export interface NoiseNumericParameterDefinition {
  readonly group: string;
  readonly key: NoiseNumericParameterKey;
  readonly label: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly integer: boolean;
}

export interface NoiseSeedParameterDefinition {
  readonly group: string;
  readonly key: "randomSeed";
  readonly label: string;
  readonly description: string;
}

export interface NoiseBooleanParameterDefinition {
  readonly group: string;
  readonly key: NoiseBooleanParameterKey;
  readonly label: string;
  readonly description: string;
}

export type NoiseParameterDefinition =
  | NoiseNumericParameterDefinition
  | NoiseBooleanParameterDefinition
  | NoiseSeedParameterDefinition;

export interface NoisePreviewSchemaResponse {
  readonly defaultParameters: NoiseEditableParameterValues;
  readonly parameterGroups: readonly NoiseParameterGroup[];
  readonly parameterDefinitions: readonly NoiseParameterDefinition[];
}

export interface NoisePreviewGeometry {
  readonly format: "svg-polyline-overlay/v1";
  readonly svg: string;
}

export interface NoisePreviewRequest {
  readonly geometry: NoisePreviewGeometry;
  readonly parameters: Partial<NoiseEditableParameterValues>;
}

export interface NoisePreviewResponse {
  readonly parameters: NoiseEditableParameterValues;
  readonly svg: string;
}

export class NoisePreviewRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoisePreviewRequestError";
  }
}

export function parseNoisePreviewRequest(body: string): NoisePreviewRequest {
  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(body);
  } catch {
    throw new NoisePreviewRequestError("Noise preview request body must be valid JSON.");
  }

  if (!isObjectRecord(parsedBody)) {
    throw new NoisePreviewRequestError("Noise preview request body must be a JSON object.");
  }

  const geometry = validateNoisePreviewGeometry(parsedBody.geometry);
  let requestParameters: Partial<NoiseEditableParameterValues>;

  try {
    requestParameters = validatePartialNoiseEditableParameters(parsedBody.parameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Noise preview parameters are invalid.";
    throw new NoisePreviewRequestError(message);
  }

  return {
    geometry,
    parameters: requestParameters,
  };
}

function validateNoisePreviewGeometry(value: unknown): NoisePreviewGeometry {
  if (!isObjectRecord(value)) {
    throw new NoisePreviewRequestError("Noise preview request must include a geometry object.");
  }

  if (value.format !== "svg-polyline-overlay/v1") {
    throw new NoisePreviewRequestError("geometry.format must be svg-polyline-overlay/v1.");
  }

  if (typeof value.svg !== "string" || value.svg.trim() === "") {
    throw new NoisePreviewRequestError("geometry.svg must be a non-empty string.");
  }

  return {
    format: "svg-polyline-overlay/v1",
    svg: value.svg,
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}